// =============================================================================
// Cross-app notification dispatch
// =============================================================================
// sendNotification ALWAYS writes an in-app row (dm_notifications). If
// RESEND_API_KEY + RESEND_FROM are set, it also fires an email — but email is
// a graceful enhancement: the in-app feed works without it. Designed to be
// called from any server context (server actions, route handlers, RSCs).
// =============================================================================

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

// Known kinds — keep this in sync with new triggers as we add them.
export type NotificationKind =
  | "pm_handoff"
  | "cfo_handoff"
  | "lender_approval"
  | "draw_funded"
  | "draw_rejected"
  | "coi_expiring"
  | "missing_lien_waiver"
  | "uw_drift"
  | "diligence_assigned"
  | "diligence_outstanding"
  | "system";

export interface NotificationInput {
  recipientUserId: string;
  dealId?: string | null;
  kind: NotificationKind;
  subject: string;
  body?: string | null;
  href?: string | null; // in-app path, prefixed with the public URL for email
  metadata?: Record<string, unknown>;
}

/**
 * Inserts the in-app row (always) and best-effort emails the recipient if the
 * Resend env vars are configured. Failures are logged, never thrown — a
 * notification should never break the parent action.
 *
 * Side effects (in order):
 *   1. INSERT into dm_notifications. The realtime subscription (migration
 *      0069) pushes the row to subscribed clients — bells light up live.
 *   2. revalidatePath('/', 'layout') so the next SERVER render of any page
 *      (post-navigation, post-refresh) sees the fresh row in the bell's
 *      initialItems even if the user's tab was offline / missed the realtime
 *      push. Wrapped in try/catch because revalidatePath throws when called
 *      from non-server-action contexts (cron jobs, scripts); we don't want
 *      that to break notification dispatch.
 *   3. Optional Resend email if RESEND_API_KEY + RESEND_FROM are set.
 *
 * Callers don't need to revalidate themselves — this function handles it.
 */
export async function sendNotification(input: NotificationInput): Promise<void> {
  const supabase = await createClient();

  const { error: insertErr } = await supabase.from("dm_notifications").insert({
    recipient_user_id: input.recipientUserId,
    deal_id: input.dealId ?? null,
    kind: input.kind,
    subject: input.subject,
    body: input.body ?? null,
    href: input.href ?? null,
    // Supabase's generated Json type doesn't accept `unknown`-valued records
    // directly; runtime is fine since jsonb just serializes the object.
    metadata: (input.metadata ?? {}) as never,
  });
  if (insertErr) {
    console.error("[notifications] in-app insert failed:", insertErr.message);
    return;
  }

  // The NotificationsBell lives in (app)/layout.tsx and re-fetches when the
  // layout revalidates. Inline this here so EVERY call site automatically
  // refreshes the server-rendered bell without callers having to remember.
  try {
    revalidatePath("/", "layout");
  } catch (e) {
    // Non-server-action contexts (cron, script) throw — log and continue.
    console.warn(
      "[notifications] revalidatePath skipped:",
      (e as Error).message
    );
  }

  // Email path — no-op until IT finishes Resend domain setup.
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!apiKey || !from) return;

  const { data: appUser } = await supabase
    .from("app_users")
    .select("email, display_name")
    .eq("user_id", input.recipientUserId)
    .maybeSingle();
  if (!appUser?.email) return;

  const linkBase = process.env.NEXT_PUBLIC_DEVMGMT_URL ?? "";
  const linkHref = input.href ? `${linkBase}${input.href}` : linkBase || null;
  const greeting = appUser.display_name
    ? `Hi ${appUser.display_name},`
    : "Hi,";
  const html = `
    <div style="font-family: Inter, sans-serif; color: #101828; max-width: 560px;">
      <h2 style="color: #164576; font-family: Oswald, sans-serif; font-weight: 600; margin: 0 0 12px;">
        ${escapeHtml(input.subject)}
      </h2>
      <p style="font-size: 14px; line-height: 1.5; color: #475467;">${greeting}</p>
      ${input.body ? `<p style="font-size: 14px; line-height: 1.5;">${escapeHtml(input.body)}</p>` : ""}
      ${
        linkHref
          ? `<p style="margin-top: 24px;"><a href="${linkHref}" style="display: inline-block; padding: 10px 16px; background: #164576; color: white; text-decoration: none; border-radius: 4px; font-size: 14px;">Open in NuRock</a></p>`
          : ""
      }
      <p style="font-size: 11px; color: #667085; margin-top: 32px;">NuRock Companies — Development Management</p>
    </div>
  `;

  try {
    // Dynamic import so the Resend dependency isn't pulled into bundles that
    // don't email (and so a missing peer doesn't fail the in-app path).
    const { Resend } = await import("resend");
    const resend = new Resend(apiKey);
    await resend.emails.send({
      from,
      to: appUser.email,
      subject: `[NuRock] ${input.subject}`,
      html,
      text: `${input.subject}\n\n${input.body ?? ""}\n\n${linkHref ?? ""}`.trim(),
    });
  } catch (e) {
    console.error(
      "[notifications] email send failed:",
      (e as Error).message
    );
  }
}

/**
 * Fan out a notification to every team member matching a role.
 *   "cfo"  — is_cfo = true
 *   "pm"   — is_pm = true
 *   "team" — is_pm OR is_cfo (everyone on the deal team)
 */
export async function sendNotificationToRole(
  role: "cfo" | "pm" | "team",
  payload: Omit<NotificationInput, "recipientUserId">
): Promise<void> {
  const supabase = await createClient();
  const base = supabase.from("app_users").select("user_id");
  const { data: users } =
    role === "cfo"
      ? await base.eq("is_cfo", true)
      : role === "pm"
        ? await base.eq("is_pm", true)
        : await base.or("is_pm.eq.true,is_cfo.eq.true");
  if (!users) return;
  await Promise.all(
    users.map((u) =>
      sendNotification({ ...payload, recipientUserId: u.user_id })
    )
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
