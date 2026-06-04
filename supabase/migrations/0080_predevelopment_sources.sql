-- =============================================================================
-- Migration 0080 — deal-scoped pre-development sources on dm_affiliates
-- =============================================================================
-- "Paid By" on an invoice points at a dm_affiliates row. Until now those rows
-- were org-wide only (NuRock Development / NuRock Construction). This adds a
-- nullable deal_id so a deal can register its own PRE-DEVELOPMENT SOURCES —
-- principals, partners, or third parties who fronted pre-dev costs and must be
-- reimbursed at closing.
--
--   deal_id IS NULL  → org-wide affiliate, available on every deal.
--   deal_id = <deal> → deal-specific pre-development source.
--
-- These appear in the invoice "Paid By" picker (grouped under "Pre-Development
-- Sources") and roll up on the Payables tab as "who's owed at close" via the
-- existing reimbursement_date column (blank = still owed).
--
-- Additive + idempotent. No backfill: existing rows keep deal_id = NULL, so the
-- org affiliates behave exactly as before.
-- =============================================================================

BEGIN;

-- deals.id is TEXT (not uuid), so deal_id must be TEXT for the FK to match.
ALTER TABLE dm_affiliates
  ADD COLUMN IF NOT EXISTS deal_id text REFERENCES deals(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_dm_affiliates_deal_id ON dm_affiliates(deal_id);

COMMENT ON COLUMN dm_affiliates.deal_id IS
  'NULL = org-wide affiliate (e.g. NuRock Development/Construction). Non-NULL = deal-specific pre-development source, reimbursed at close.';

COMMIT;
