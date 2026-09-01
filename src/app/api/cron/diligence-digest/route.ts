import { NextRequest, NextResponse } from "next/server";
import { runDiligenceDigest } from "@/lib/diligence/digest";

// =============================================================================
// Scheduled outstanding-items digest (Increment 2)
//
// ⚠️ THE SCHEDULE IS DISABLED as of 2026-09-01, on the CFO's instruction. The
// route itself is left intact and manually invokable.
// =============================================================================
// WHY IT WAS DISABLED RATHER THAN FIXED.
//
// This job could not write. Vercel Cron sends no cookies, so `createClient()`
// here yields the `anon` role, and `has_table_privilege('anon',
// 'dm_notifications', 'insert')` measured FALSE on 2026-09-01 — anon writes were
// revoked schema-wide on 2026-08-08. Every insert this job attempted was refused.
//
// It did not fail visibly. `sendNotification` logged the error and returned, and
// this route reported `ok: true` with a non-zero `assigneesNotified` count taken
// from the number of assignees it INTENDED to notify. So the digest has been
// reporting success while posting nothing, for an unknown period.
//
// Corroborating evidence: `dm_notifications` contains exactly ONE row in the
// entire platform — a `pm_handoff` from 2026-05-28. Nothing digest-shaped has
// ever been delivered. Nobody reported it missing, which is why disabling was
// chosen over building it a write path: there is no evidence the feature is
// wanted, and speculative infrastructure for an unexercised feature is the wrong
// trade.
//
// TO RE-ENABLE, two things are needed and the ORDER MATTERS:
//
//   1. Give it a legitimate write path. It needs one, and a `service_role` key
//      is the WRONG answer — there is no service-role client anywhere in any of
//      the three NuRock apps, and RLS is consequently the entire access control
//      model. Introducing the first bypass for the least important feature would
//      undo that. The right mechanism is a SECURITY DEFINER function that this
//      route calls by RPC, with EXECUTE granted to `anon`.
//      ⚠️ THAT FUNCTION MUST TAKE NO RECIPIENT, SUBJECT OR BODY FROM THE CALLER.
//      It computes all of that internally from deal state (which the digest
//      already does). Otherwise it is an open notification-injection endpoint
//      reachable by anyone — the same defect as the unguarded
//      nudgeDiligenceAssignee action, in a worse place.
//
//   2. Restore the schedule in vercel.json, which was:
//        { "crons": [ { "path": "/api/cron/diligence-digest",
//                       "schedule": "0 13 * * 1" } ] }
//      (Mondays at 13:00 UTC.)
//
// The reporting lie is fixed regardless: runDiligenceDigest now counts sends
// that actually landed and returns `assigneesFailed`, so a manual invocation
// tells the truth about what happened.
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
