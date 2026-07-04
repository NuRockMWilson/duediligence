// =============================================================================
// Diligence audit logging (brief item 6)
// =============================================================================
// Best-effort, append-only event writer for dm_diligence_audit_log (migration
// 0098). Deliberately non-fatal: an audit-log failure (including the table not
// existing yet, before the user runs the migration) must never break the
// underlying action — errors are logged to the server console and swallowed.
// =============================================================================

export type DiligenceAuditEventType =
  | "status_changed"
  | "signoff_recorded"
  | "signoff_cleared"
  | "document_linked"
  | "document_unlinked"
  | "template_imported"
  | "packet_attached"
  | "packet_removed";

export interface DiligenceAuditEvent {
  /** Null for org-level events (e.g. template imports in Settings). */
  dealId: string | null;
  dealItemId?: string | null;
  actorUserId?: string | null;
  eventType: DiligenceAuditEventType;
  /** Human-readable one-liner shown in the audit viewer. */
  summary: string;
  detail?: Record<string, unknown>;
}

// The diligence actions use loosely-typed clients (AnySb); accept the same.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

export async function logDiligenceEvent(
  sb: AnyClient,
  event: DiligenceAuditEvent
): Promise<void> {
  try {
    const { error } = await sb.from("dm_diligence_audit_log").insert({
      deal_id: event.dealId ?? null,
      deal_item_id: event.dealItemId ?? null,
      actor_user_id: event.actorUserId ?? null,
      event_type: event.eventType,
      summary: event.summary,
      detail: event.detail ?? {},
    });
    if (error) {
      console.warn("[diligence-audit] insert failed:", error.message);
    }
  } catch (e) {
    console.warn("[diligence-audit] insert threw:", (e as Error).message);
  }
}
