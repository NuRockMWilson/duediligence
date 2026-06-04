-- =============================================================================
-- Migration 0082 — per-invoice-line interim cost designation
-- =============================================================================
-- The eligible/ineligible breakout is now captured per invoice line in the edit
-- drawer, and the user must say whether each line is an INTERIM cost (interest /
-- real-estate taxes / insurance / loan fees) so the cost certification can
-- amortize it against the construction period.
--
-- Until now interim status lived only on cost_account_map (the GL level). This
-- adds a per-line designation so it can differ from the GL default and be a
-- required, line-level decision.
--
--   interim_cost_type IS NULL  → not yet selected (blocks save unless the line
--                                is left fully blank to finish later)
--   'none'                     → explicitly NOT an interim cost
--   'interest' | 're_taxes' | 'loan_fees' | 'insurance' → interim, amortized in
--                                the cost certification
--
-- Additive + idempotent. Existing rows keep NULL; the app seeds the selector
-- from the GL default when a line is opened, so nothing is forced retroactively.
-- =============================================================================

BEGIN;

ALTER TABLE dm_invoice_lines
  ADD COLUMN IF NOT EXISTS interim_cost_type text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dm_invoice_lines_interim_cost_type_chk'
  ) THEN
    ALTER TABLE dm_invoice_lines
      ADD CONSTRAINT dm_invoice_lines_interim_cost_type_chk
      CHECK (interim_cost_type IS NULL OR interim_cost_type IN
        ('none','interest','re_taxes','loan_fees','insurance'));
  END IF;
END;
$$;

COMMENT ON COLUMN dm_invoice_lines.interim_cost_type IS
  'Per-line interim cost designation: NULL=unselected, none=not interim, or interest/re_taxes/loan_fees/insurance (amortized in cost cert).';

COMMIT;
