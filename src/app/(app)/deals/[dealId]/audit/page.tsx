import { ScrollText, AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Card, Badge } from "@/components/nurock-ui";

// =============================================================================
// Audit trail (brief item 6) — /deals/[dealId]/audit
// =============================================================================
// Newest-first event log from dm_diligence_audit_log (migration 0098): status
// changes, sign-off decisions/undos, document links/unlinks, template imports
// (org-level, tagged), and packet attach/remove. Degrades to a
// migration-required notice when the table doesn't exist yet.
// =============================================================================

export const dynamic = "force-dynamic";

const EVENT_TONE: Record<string, "navy" | "tan" | "green" | "slate"> = {
  status_changed: "navy",
  signoff_recorded: "green",
  signoff_cleared: "tan",
  document_linked: "navy",
  document_unlinked: "tan",
  template_imported: "slate",
  packet_attached: "green",
  packet_removed: "tan",
};

const EVENT_LABEL: Record<string, string> = {
  status_changed: "Status",
  signoff_recorded: "Sign-off",
  signoff_cleared: "Sign-off undone",
  document_linked: "Document linked",
  document_unlinked: "Document unlinked",
  template_imported: "Template import",
  packet_attached: "Packet attached",
  packet_removed: "Packet removed",
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "numeric",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function AuditPage({
  params,
}: {
  params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await params;
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const [{ data: events, error }, { data: users }, { data: itemsData }] =
    await Promise.all([
      sb
        .from("dm_diligence_audit_log")
        .select(
          "id, deal_id, deal_item_id, actor_user_id, event_type, summary, detail, created_at"
        )
        .or(`deal_id.eq.${dealId},deal_id.is.null`)
        .order("created_at", { ascending: false })
        .limit(300),
      sb.from("app_users").select("user_id, display_name, email"),
      sb
        .from("dm_diligence_deal_items")
        .select("id, nurock_diligence_items ( title )")
        .eq("deal_id", dealId),
    ]);

  if (error) {
    return (
      <div className="px-6 py-6 max-w-[900px]">
        <h1 className="font-display text-2xl text-nurock-black mb-3">Audit Trail</h1>
        <Card className="p-5 border-amber-300 bg-amber-50">
          <div className="flex items-start gap-2 text-[13px] text-amber-900">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
            <div>
              The audit log isn&apos;t available yet — run migration{" "}
              <code className="font-mono text-[12px]">
                0098_diligence_audit_log.sql
              </code>{" "}
              in the Supabase SQL editor, then reload. Events are recorded
              best-effort from that point forward.
              <div className="mt-1 text-amber-800/80">({error.message})</div>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  const nameByUser = new Map<string, string>(
    (
      (users ?? []) as Array<{
        user_id: string;
        display_name: string | null;
        email: string | null;
      }>
    ).map((u) => [u.user_id, u.display_name ?? u.email ?? "Team member"])
  );
  const titleByItem = new Map<string, string>(
    (
      (itemsData ?? []) as Array<{
        id: string;
        nurock_diligence_items: { title: string } | null;
      }>
    ).map((r) => [r.id, r.nurock_diligence_items?.title ?? ""])
  );

  type Row = {
    id: string;
    deal_id: string | null;
    deal_item_id: string | null;
    actor_user_id: string | null;
    event_type: string;
    summary: string;
    created_at: string;
  };
  const rows = (events ?? []) as Row[];

  return (
    <div className="px-6 py-6 max-w-[900px] space-y-4">
      <div className="flex items-center gap-3">
        <div className="bg-nurock-navy/5 rounded-md p-2 border border-nurock-navy/10">
          <ScrollText className="w-5 h-5 text-nurock-navy" />
        </div>
        <div>
          <h1 className="font-display text-2xl text-nurock-black">Audit Trail</h1>
          <p className="text-xs text-nurock-slate-light mt-0.5">
            Every status change, sign-off decision, document link, import, and
            packet event — newest first ({rows.length} shown, max 300).
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <Card className="p-10 text-center border-dashed border-2">
          <p className="text-sm text-nurock-slate-light">
            No events recorded yet. Actions on the diligence checklist (status
            changes, sign-offs, document links…) appear here as they happen.
          </p>
        </Card>
      ) : (
        <Card className="bg-white overflow-hidden">
          <ul className="divide-y divide-nurock-border/60">
            {rows.map((e) => {
              const itemTitle = e.deal_item_id
                ? titleByItem.get(e.deal_item_id)
                : null;
              return (
                <li key={e.id} className="px-4 py-2.5 flex items-start gap-3">
                  <Badge tone={EVENT_TONE[e.event_type] ?? "slate"}>
                    {EVENT_LABEL[e.event_type] ?? e.event_type}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] text-nurock-black leading-snug">
                      {e.summary}
                      {itemTitle ? (
                        <span className="text-nurock-slate-light">
                          {" "}
                          · {itemTitle}
                        </span>
                      ) : null}
                      {e.deal_id === null && (
                        <span className="ml-1.5 text-[10px] uppercase tracking-wider text-nurock-slate-light">
                          org-level
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-nurock-slate-light mt-0.5">
                      {e.actor_user_id
                        ? nameByUser.get(e.actor_user_id) ?? "Unknown user"
                        : "System"}{" "}
                      · {formatWhen(e.created_at)}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
