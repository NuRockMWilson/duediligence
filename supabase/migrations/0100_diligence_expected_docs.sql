-- =============================================================================
-- Migration 0100 — Expected-document slots per checklist item
-- =============================================================================
-- Gives require-all / require-any real semantics (they were a no-op while a
-- link's existence was the only signal):
--
--   * Each deal item can declare named expected-document slots
--     (e.g. "EIN Letter", "W-9").
--   * A slot is FILLED when a document linked to the item is assigned to it.
--   * Approver gate, mode 'all':  every slot filled (no slots -> >=1 linked doc).
--   * Approver gate, mode 'any':  >=1 linked document (slots are advisory).
--
-- document_id references the shared library (0081); assignment is only valid
-- while that document is also linked to the item — unlinking clears it.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS dm_diligence_expected_docs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id text NOT NULL,
  deal_item_id uuid NOT NULL REFERENCES dm_diligence_deal_items(id) ON DELETE CASCADE,
  label text NOT NULL,
  document_id uuid REFERENCES dm_diligence_documents(id) ON DELETE SET NULL,
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dm_diligence_expected_docs_item
  ON dm_diligence_expected_docs (deal_item_id, position);

-- Permissive RLS, matching the diligence module convention.
ALTER TABLE dm_diligence_expected_docs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dm_diligence_expected_docs_select" ON dm_diligence_expected_docs;
CREATE POLICY "dm_diligence_expected_docs_select"
  ON dm_diligence_expected_docs FOR SELECT USING (true);

DROP POLICY IF EXISTS "dm_diligence_expected_docs_write" ON dm_diligence_expected_docs;
CREATE POLICY "dm_diligence_expected_docs_write"
  ON dm_diligence_expected_docs FOR ALL USING (true) WITH CHECK (true);

COMMIT;
