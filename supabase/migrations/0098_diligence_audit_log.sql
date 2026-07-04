-- =============================================================================
-- Migration 0098 — Diligence audit trail (brief item 6)
-- =============================================================================
-- Append-only event log for the diligence module. The "Audit" nav item was a
-- coming-soon stub while the sign-off chain, status changes, document links,
-- imports, and packet adoption were already generating exactly the events an
-- audit trail should capture. Server actions write best-effort rows here; the
-- /deals/[dealId]/audit page reads them newest-first.
--
-- event_type vocabulary (extend freely; the viewer renders unknown types
-- generically):
--   status_changed      — item status set directly (detail: from/to, bulk size)
--   signoff_recorded    — chain decision (detail: role, decision, comment)
--   signoff_cleared     — chain undo (detail: roles cleared)
--   document_linked     — upload/link (detail: document name, item)
--   document_unlinked   — unlink (detail: document id, item)
--   template_imported   — checklist import (detail: template name, item count)
--   packet_attached     — template adopted onto a deal
--   packet_removed      — template unadopted from a deal
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS dm_diligence_audit_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Nullable: org-level events (template imports in Settings) have no deal;
  -- the per-deal viewer includes them tagged as org-level.
  deal_id       text,
  -- Nullable: template-level events (imports) aren't tied to a deal item.
  deal_item_id  uuid REFERENCES dm_diligence_deal_items(id) ON DELETE SET NULL,
  actor_user_id uuid,
  event_type    text NOT NULL,
  -- Human-readable one-liner, denormalized so the viewer needs no joins.
  summary       text NOT NULL,
  -- Structured payload for drill-down / future filtering.
  detail        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dm_diligence_audit_deal
  ON dm_diligence_audit_log (deal_id, created_at DESC);

ALTER TABLE dm_diligence_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dm_diligence_audit_log_all ON dm_diligence_audit_log;
CREATE POLICY dm_diligence_audit_log_all ON dm_diligence_audit_log
  FOR ALL USING (true) WITH CHECK (true);

COMMIT;
