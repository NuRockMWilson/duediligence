// =============================================================================
// Outstanding-items digest — emailed reminders on a per-user cadence
// =============================================================================
// Sends each opted-in user one email summarising the required diligence items
// they are working (assignee) or owe (responsible party) and have not completed.
// Invoked by /api/cron/diligence-digest; also callable manually.
//
// "Outstanding" = required item not yet approved / waived / na. That definition
// lives in the SQL function now, not here, and deliberately mirrors the rollup
// so the digest counts match what the checklist shows.
//
// -----------------------------------------------------------------------------
// REWRITTEN 2026-09-04. THE OLD VERSION COULD NOT WRITE, AND SAID IT DID.
// -----------------------------------------------------------------------------
// Vercel Cron sends no cookies, so createClient() here yields `anon`. Anon
// writes were revoked schema-wide on 2026-08-08 and app_users.email is not even
// READABLE by anon, so the previous implementation could neither look up an
// address nor insert a notification. It nonetheless returned ok:true with a
// count of assignees it INTENDED to notify — reporting success while delivering
// nothing, for months. dm_notifications still holds exactly one row in the whole
// platform.
//
// So everything now goes through two SECURITY DEFINER functions
// (20260904_diligence_reminder_digest.sql):
//
//   app_diligence_due_digests(secret)       who is due, and what to tell them
//   app_diligence_mark_digest_sent(secret,) recorded ONLY after a send succeeds
//
// Both verify a secret against a table nothing else can read, and neither
// accepts a recipient, subject or body from the caller — otherwise granting
// EXECUTE to anon would make this a public endpoint that leaks every user's email
// and workload, which is worse than the feature is worth.
//
// TWO CALLS, NOT ONE, is the whole anti-lie mechanism: a person is marked
// notified only after Resend accepts their message. A failure leaves
// last_sent_at untouched, so they are picked up on the next run instead of being
// silently skipped for an interval.
//
// EMAIL ONLY, no in-app row. The in-app feed is written by user-initiated
// actions, which have a session; adding an RPC so an anonymous cron could also
// insert notification rows would widen the surface for a second delivery channel
// nobody asked for. Michael asked to be emailed.
// =============================================================================

import { createClient } from "@/lib/supabase/server";

export interface DigestResult {
  /** Emails Resend accepted. */
  assigneesNotified: number;
  /** Attempted and failed. Non-zero means the digest did NOT do its job. */
  assigneesFailed: number;
  itemsCovered: number;
  /**
   * Set when the digest could not run at all, rather than running and finding
   * nobody. "0 sent because nothing was due" and "0 sent because email is not
   * configured" are different facts and the old version conflated them.
   */
  skipped?: "no-cron-secret" | "no-resend-config" | "rpc-unavailable";
  /** The database's own words when the RPC refuses, so a misconfiguration is legible. */
  error?: string;
}

interface DueRow {
  user_id: string;
  email: string;
  display_name: string | null;
  scope: "mine" | "all";
  outstanding_total: number;
  overdue_total: number;
  deal_count: number;
  deal_names: string | null;
}

export async function runDiligenceDigest(): Promise<DigestResult> {
  const empty: DigestResult = {
    assigneesNotified: 0,
    assigneesFailed: 0,
    itemsCovered: 0,
  };

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Without it the RPC cannot be called at all. Reported rather than treated
    // as "nothing to do".
    return { ...empty, skipped: "no-cron-secret" };
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!apiKey || !from) {
    // STOP BEFORE READING ANYTHING. Fetching the due list and then discarding it
    // would mean querying every user's email address for no purpose, and the
    // temptation next time would be to mark them sent anyway.
    return { ...empty, skipped: "no-resend-config" };
  }

  const supabase = await createClient();
  const { data, error } = await (
    supabase as unknown as {
      rpc: (
        fn: string,
        args: Record<string, unknown>
      ) => Promise<{ data: DueRow[] | null; error: { message: string } | null }>;
    }
  ).rpc("app_diligence_due_digests", { p_secret: secret });

  if (error) {
    console.error("[digest] app_diligence_due_digests refused:", error.message);
    return { ...empty, skipped: "rpc-unavailable", error: error.message };
  }

  const due = data ?? [];
  if (due.length === 0) return empty;

  const { Resend } = await import("resend");
  const resend = new Resend(apiKey);
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";

  const sent: string[] = [];
  let failed = 0;
  let itemsCovered = 0;

  // SEQUENTIAL, not Promise.all. A parallel burst against Resend risks rate
  // limiting the whole batch, and a partial failure is much harder to attribute
  // when everything fires at once — the point of the two-call design is knowing
  // exactly who received one.
  for (const r of due) {
    itemsCovered += r.outstanding_total;
    const overduePart = r.overdue_total > 0 ? ` (${r.overdue_total} overdue)` : "";
    const subject = `${r.outstanding_total} open due-diligence item${
      r.outstanding_total === 1 ? "" : "s"
    }${overduePart}`;
    const dealPart =
      r.deal_count === 1
        ? `on ${r.deal_names ?? "a deal"}`
        : `across ${r.deal_count} deals${r.deal_names ? `: ${r.deal_names}` : ""}`;
    const scopeLine =
      r.scope === "all"
        ? "This is the current status of the whole list."
        : "These are items assigned to you, or that you are responsible for, which are not yet complete.";

    const html = `
      <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; color: #101828; max-width: 560px;">
        <p style="font-size: 15px;">${
          r.display_name ? `Hello ${r.display_name},` : "Hello,"
        }</p>
        <p style="font-size: 15px;">You have <strong>${r.outstanding_total}</strong> outstanding
        due-diligence item${r.outstanding_total === 1 ? "" : "s"}${overduePart} ${dealPart}.</p>
        <p style="font-size: 13px; color: #475467;">${scopeLine}</p>
        ${
          baseUrl
            ? `<p style="margin-top: 24px;"><a href="${baseUrl}/deals" style="display: inline-block; padding: 10px 16px; background: #164576; color: white; text-decoration: none; border-radius: 4px; font-size: 14px;">Open due diligence</a></p>`
            : ""
        }
        <p style="font-size: 11px; color: #667085; margin-top: 32px;">
          NuRock Companies — Due Diligence. You are receiving this because you
          turned on reminders; change the interval or switch them off in Settings.
        </p>
      </div>
    `;

    try {
      await resend.emails.send({
        from,
        to: r.email,
        subject: `[NuRock] ${subject}`,
        html,
        text: `${subject}\n\n${r.outstanding_total} outstanding item(s) ${dealPart}.\n${scopeLine}`,
      });
      sent.push(r.user_id);
    } catch (e) {
      // Counted, never thrown, and NOT marked sent — so this person is picked up
      // again next run rather than losing their turn.
      failed++;
      console.error(
        `[digest] send failed for ${r.user_id}:`,
        (e as Error).message
      );
    }
  }

  // Only now, and only for the ones that landed.
  if (sent.length > 0) {
    const { error: markErr } = await (
      supabase as unknown as {
        rpc: (
          fn: string,
          args: Record<string, unknown>
        ) => Promise<{ error: { message: string } | null }>;
      }
    ).rpc("app_diligence_mark_digest_sent", {
      p_secret: secret,
      p_user_ids: sent,
    });
    if (markErr) {
      // The emails DID go out. Failing to record that means some people get a
      // duplicate next run — annoying, and strictly better than the alternative
      // of marking sends that never happened.
      console.error(
        "[digest] emails sent but last_sent_at not recorded:",
        markErr.message
      );
      return {
        assigneesNotified: sent.length,
        assigneesFailed: failed,
        itemsCovered,
        error: `Sent ${sent.length}, but could not record it: ${markErr.message}`,
      };
    }
  }

  return {
    assigneesNotified: sent.length,
    assigneesFailed: failed,
    itemsCovered,
  };
}
