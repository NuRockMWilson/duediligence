import { createClient } from "@/lib/supabase/server";
import { RemindersForm } from "./_components/reminders-form";

// ============================================================================
// /settings/reminders — emailed due-diligence reminders, per user
// ============================================================================
// force-dynamic: this reads the signed-in user's own preference row, so a
// cached render would show one person's setting to another.
// ============================================================================

export const dynamic = "force-dynamic";

export default async function RemindersPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  const { data: pref } = user
    ? await sb
        .from("dm_diligence_reminder_prefs")
        .select("cadence, scope, last_sent_at")
        .eq("user_id", user.id)
        .maybeSingle()
    : { data: null };

  const row = (pref ?? null) as {
    cadence: "off" | "daily" | "weekly" | "monthly";
    scope: "mine" | "all";
    last_sent_at: string | null;
  } | null;

  // WHETHER DELIVERY IS ACTUALLY POSSIBLE, read on the server and passed down.
  // Resend is gated on two env vars that IT has not finished provisioning, and
  // this feature spent months reporting success while sending nothing — so the
  // page says plainly whether an email can leave the building rather than
  // implying the setting is enough.
  const emailConfigured = Boolean(
    process.env.RESEND_API_KEY && process.env.RESEND_FROM
  );

  return (
    <div className="px-8 py-6 max-w-[760px] space-y-6">
      <div>
        <h1 className="font-display text-2xl text-nurock-black">
          Due-Diligence Reminders
        </h1>
        <p className="text-xs text-nurock-slate-light mt-1">
          Get emailed a summary of the diligence items you are working on or
          responsible for, on the interval you choose.
        </p>
      </div>
      <RemindersForm
        initialCadence={row?.cadence ?? "off"}
        initialScope={row?.scope ?? "mine"}
        lastSentAt={row?.last_sent_at ?? null}
        emailConfigured={emailConfigured}
      />
    </div>
  );
}
