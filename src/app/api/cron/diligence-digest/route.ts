import { NextRequest, NextResponse } from "next/server";
import { runDiligenceDigest } from "@/lib/diligence/digest";

// =============================================================================
// Scheduled outstanding-items digest
// =============================================================================
// RE-ENABLED 2026-09-04, on Michael's instruction to wire emailed reminders.
//
// IT WAS DISABLED ON 2026-09-01 FOR TWO REASONS, and both are now addressed.
//
//   1. IT COULD NOT WRITE. Vercel Cron sends no cookies, so createClient() here
//      yields `anon`; anon writes were revoked schema-wide on 2026-08-08 and
//      app_users.email is not even READABLE by anon. Every insert was refused.
//   2. IT LIED ABOUT IT. The route reported ok:true with a count of assignees it
//      INTENDED to notify, so it claimed success while delivering nothing for
//      months. dm_notifications still holds exactly one row in the platform.
//
// It was disabled rather than fixed because there was no evidence the feature was
// wanted. Michael asking for it is that evidence.
//
// HOW THE WRITE PATH WORKS NOW, and why it is not a service_role key: there is no
// service-role client in any of the three NuRock apps, which is exactly why RLS
// is the whole access-control model — introducing the first bypass for the least
// critical feature would undo that. Instead, two SECURITY DEFINER functions
// (20260904_diligence_reminder_digest.sql) compute everything internally:
//
//     app_diligence_due_digests(secret)          who is due, and what to tell them
//     app_diligence_mark_digest_sent(secret, [])  recorded ONLY after a send lands
//
// Both verify a secret against dm_cron_secrets — a table with RLS on, no policies
// and no grants, so only a definer function can read it — and NEITHER takes a
// recipient, subject or body from the caller. That last part is what keeps
// EXECUTE-to-anon from being a public endpoint that leaks every user's address
// and workload, which is the same defect class as the unguarded
// nudgeDiligenceAssignee action this program already closed.
//
// THE REPORTING NO LONGER OVERSTATES. runDiligenceDigest counts sends Resend
// ACCEPTED, returns assigneesFailed separately, and distinguishes "ran and found
// nobody due" from "could not run" via a `skipped` reason. If Resend is not
// configured it stops before reading anything and says so.
//
// SCHEDULE: daily at 13:00 UTC. Daily is the CRON frequency, not the user's —
// each person's cadence (off / daily / weekly / monthly) lives in
// dm_diligence_reminder_prefs and the SQL function only returns those whose
// interval has elapsed. A weekly cron could not deliver a daily preference, so
// the job runs at the finest granularity any user can choose.
//
// MICHAEL MUST STILL DO TWO THINGS or this delivers nothing (and says so):
//   * INSERT the digest secret into dm_cron_secrets, matching CRON_SECRET;
//   * set RESEND_API_KEY and RESEND_FROM once IT finishes the domain.
// =============================================================================
// When CRON_SECRET is set, the request must carry
// `Authorization: Bearer <CRON_SECRET>`, which also permits manual triggering.
// =============================================================================

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const result = await runDiligenceDigest();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 }
    );
  }
}
