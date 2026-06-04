-- =============================================================================
-- Migration 0083 — Multi-approver sign-off (DD module — Increment 3)
-- =============================================================================
-- Increments 1-2 used the single approved_at/approved_by columns on
-- dm_diligence_deal_items for a one-approver sign-off. Some deals need a chain:
-- a preparer assembles the item, a reviewer checks it, an approver signs it
-- off. This append-style log records each role's decision; the item's headline
-- status flips to 'approved' when the approver approves (handled in the action,
-- keeping deal-items the single source of truth for coverage).
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS dm_diligence_signoffs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id       text NOT NULL,
  deal_item_id  uuid NOT NULL REFERENCES dm_diligence_deal_items(id) ON DELETE CASCADE,
  role          text NOT NULL CHECK (role IN ('preparer','reviewer','approver')),
  decision      text NOT NULL CHECK (decision IN ('approved','rejected')),
  actor_user_id uuid NOT NULL,
  comment       text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  -- Each role signs once per item; re-signing upserts on this key.
  UNIQUE (deal_item_id, role)
);

CREATE INDEX IF NOT EXISTS idx_dm_diligence_signoffs_item
  ON dm_diligence_signoffs (deal_item_id);
CREATE INDEX IF NOT EXISTS idx_dm_diligence_signoffs_deal
  ON dm_diligence_signoffs (deal_id);

ALTER TABLE dm_diligence_signoffs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dm_diligence_signoffs_all ON dm_diligence_signoffs;
CREATE POLICY dm_diligence_signoffs_all ON dm_diligence_signoffs
  FOR ALL USING (true) WITH CHECK (true);

-- set_updated_at() exists from 0072/0081.
DROP TRIGGER IF EXISTS trg_dm_diligence_signoffs_updated_at ON dm_diligence_signoffs;
CREATE TRIGGER trg_dm_diligence_signoffs_updated_at
  BEFORE UPDATE ON dm_diligence_signoffs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
