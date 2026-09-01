// =============================================================================
// Outstanding-items digest (Increment 2)
// =============================================================================
// Builds a per-assignee summary of open diligence items across all deals and
// sends each assignee one notification (which emails them too when Resend is
// configured). Invoked by the scheduled cron route; also callable manually.
//
// "Outstanding" = required item not yet approved/waived/na. Mirrors the rollup
// definition so the digest counts match what the checklist shows.
// =============================================================================

import { createClient } from "@/lib/supabase/server";
import { sendNotification } from "@/lib/notifications";

interface OutstandingRow {
  assignee_user_id: string;
  deal_id: string;
  status: string;
  is_required: boolean;
  due_date: string | null;
}

export interface DigestResult {
  assigneesNotified: number;
  /** Sends that were attempted and failed. Non-zero means the digest did NOT do its job. */
  assigneesFailed: number;
  itemsCovered: number;
}

const OUTSTANDING = new Set(["not_started", "in_progress", "submitted"]);

export async function runDiligenceDigest(): Promise<DigestResult> {
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const { data } = await sb
    .from("dm_diligence_deal_items")
    .select("assignee_user_id, deal_id, status, is_required, due_date")
    .not("assignee_user_id", "is", null);

  const rows = ((data ?? []) as OutstandingRow[]).filter(
    (r) => r.is_required && OUTSTANDING.has(r.status)
  );
  if (rows.length === 0) return { assigneesNotified: 0, assigneesFailed: 0, itemsCovered: 0 };

  const todayIso = new Date().toISOString().slice(0, 10);

  // assignee → { total, overdue, dealIds:Set }
  const byAssignee = new Map<
    string,
    { total: number; overdue: number; deals: Set<string> }
  >();
  for (const r of rows) {
    const e =
      byAssignee.get(r.assignee_user_id) ?? {
        total: 0,
        overdue: 0,
        deals: new Set<string>(),
      };
    e.total++;
    e.deals.add(r.deal_id);
    if (r.due_date && r.due_date < todayIso) e.overdue++;
    byAssignee.set(r.assignee_user_id, e);
  }

  // Deal names for the body (one fetch).
  const dealIds = Array.from(new Set(rows.map((r) => r.deal_id)));
  const { data: deals } = await supabase
    .from("deals")
    .select("id, name")
    .in("id", dealIds);
  const dealName = new Map(
    ((deals ?? []) as Array<{ id: string; name: string }>).map((d) => [
      d.id,
      d.name,
    ])
  );

  let itemsCovered = 0;
  // One notification per assignee. Deep-link to the deal when it's a single
  // deal; otherwise leave generic (the in-app feed lists per-deal links).
  const sendResults = await Promise.all(
    Array.from(byAssignee.entries()).map(([userId, e]) => {
      itemsCovered += e.total;
      const dealList = Array.from(e.deals)
        .map((id) => dealName.get(id) ?? "a deal")
        .slice(0, 6)
        .join(", ");
      const overduePart =
        e.overdue > 0 ? ` (${e.overdue} overdue)` : "";
      const onlyDeal = e.deals.size === 1 ? Array.from(e.deals)[0] : null;
      return sendNotification({
        recipientUserId: userId,
        dealId: onlyDeal,
        kind: "diligence_outstanding",
        subject: `${e.total} open due-diligence item${
          e.total === 1 ? "" : "s"
        }${overduePart}`,
        body: `You have ${e.total} outstanding diligence item${
          e.total === 1 ? "" : "s"
        } across ${e.deals.size} deal${
          e.deals.size === 1 ? "" : "s"
        }: ${dealList}. Please upload documents and update their status.`,
        href: onlyDeal ? `/deals/${onlyDeal}/diligence` : `/deals`,
      });
    })
  );

  // COUNT WHAT ACTUALLY LANDED, not what was attempted.
  //
  // This previously returned byAssignee.size — the number of assignees the
  // digest INTENDED to notify. sendNotification swallowed its insert error and
  // returned void, so when the cron lost write access to dm_notifications the
  // job kept reporting a healthy non-zero count while posting nothing at all.
  // Measured 2026-09-01: has_table_privilege(anon, dm_notifications, insert) is
  // FALSE, and Vercel Cron sends no cookies, so every send here has been failing
  // silently. A job that reports success while doing nothing is worse than one
  // that fails, because nobody goes looking.
  const notified = sendResults.filter(Boolean).length;
  const failed = sendResults.length - notified;
  if (failed > 0) {
    console.error(
      "[diligence-digest] " +
        failed +
        " of " +
        sendResults.length +
        " notification(s) could not be written. The most likely cause is that " +
        "this request has no authenticated session: Vercel Cron sends no " +
        "cookies, so the Supabase client runs as 'anon', which holds no INSERT " +
        "on dm_notifications."
    );
  }

  return { assigneesNotified: notified, assigneesFailed: failed, itemsCovered };
}
