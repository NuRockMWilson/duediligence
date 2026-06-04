-- =============================================================================
-- Migration 0070 — Eligibility taxonomy for interim cost auto-calc
-- =============================================================================
-- Phase 5 r1 of the LIHTC eligible-basis automation. The current Invoice
-- Ledger lets users type eligible_amount / ineligible_amount manually.
-- Per CFO methodology (Foxcroft Cove Development Workbook → Interim Costs
-- tab), four interim-cost categories carry deterministic eligibility math
-- that should be auto-calculated rather than typed:
--
--   interest   — construction-loan interest payments. Per-month formula:
--                eligible = payment × percent_under_construction(month).
--
--   re_taxes   — property tax bills. Period-spread formula: total bill is
--                pro-rated over [period_start, period_end] at a monthly
--                rate of total / ((end-start)/30); for each month in the
--                covered period:
--                  if month ≤ closingDate: 100% eligible
--                  else: eligible = monthly_alloc × percent_under_construction
--
--   loan_fees  — construction loan fees / commitment fees. Same
--                period-spread formula as RE taxes.
--
--   insurance  — builder's-risk / property insurance premiums. Same
--                period-spread formula as RE taxes.
--
-- The "% under construction" curve comes from the deal's keyDates: months
-- before the Final CO date count as 100% under construction for a
-- single-building deal; after Final CO it's 0%. Multi-building phased
-- deals will need per-building CO data (deferred to Phase 5 r5+).
--
-- This migration adds:
--   1. cost_account_map.interim_cost_type — enum-like text column that
--      flags WHICH of the four categories each GL account falls into.
--      Used to look up which calc to fire when an invoice line is saved.
--      NULL = no auto-calc; user enters eligible_amount manually.
--
--   2. dm_invoice_lines.eligibility_period_start / _end — DATE columns
--      capturing the period a tax/loan/insurance line covers. Required
--      input for the period-spread calc. Interest lines leave these
--      NULL (single-month, derived from invoice_date).
--
--   3. dm_invoice_lines.eligibility_auto_computed — boolean flag set to
--      TRUE when the auto-calc wrote eligible_amount. FALSE means a user
--      manually overrode the calc. The Invoice Ledger uses this to
--      decide whether to recalculate on save vs preserve the override.
-- =============================================================================

BEGIN;

-- 1. Interim-cost classifier on GL accounts.
-- Constrained to the four valid values; NULL = "no auto-calc, manual only".
ALTER TABLE cost_account_map
  ADD COLUMN IF NOT EXISTS interim_cost_type TEXT
  CHECK (interim_cost_type IN ('interest', 're_taxes', 'loan_fees', 'insurance'));

COMMENT ON COLUMN cost_account_map.interim_cost_type IS
  'Phase 5 r1: classifies GL accounts whose invoice lines get auto-calculated '
  'eligibility. interest = per-month payment × % under construction; '
  're_taxes / loan_fees / insurance = period-spread, with months ≤ closingDate '
  'at 100% and later months × % under construction. NULL = no auto-calc.';

-- 2. Period coverage on invoice lines (for tax/insurance/loan fee bills
--    that cover a multi-month period — e.g., "2026 Q3 property taxes"
--    covering Jul 1 → Sep 30).
ALTER TABLE dm_invoice_lines
  ADD COLUMN IF NOT EXISTS eligibility_period_start DATE,
  ADD COLUMN IF NOT EXISTS eligibility_period_end DATE;

COMMENT ON COLUMN dm_invoice_lines.eligibility_period_start IS
  'Phase 5 r1: start of the period this line covers. Used by re_taxes / '
  'loan_fees / insurance calcs to spread the amount over months. Interest '
  'lines leave NULL — single-month, derived from invoice_date.';
COMMENT ON COLUMN dm_invoice_lines.eligibility_period_end IS
  'Phase 5 r1: end of the period this line covers. Paired with '
  'eligibility_period_start.';

-- 3. Auto-vs-manual flag. Defaults FALSE so existing manually-entered
--    eligible_amount values keep their override status until explicitly
--    recalculated.
ALTER TABLE dm_invoice_lines
  ADD COLUMN IF NOT EXISTS eligibility_auto_computed BOOLEAN
  NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN dm_invoice_lines.eligibility_auto_computed IS
  'Phase 5 r1: TRUE when eligible_amount + ineligible_amount were written '
  'by the auto-calc; FALSE when manually entered/overridden. Calc engine '
  'preserves manually-set values on subsequent saves until the user '
  'explicitly clears the override.';

-- 4. Period-end ≥ period-start sanity check. Allows NULL on both sides
--    so manually-entered lines aren't required to populate them.
ALTER TABLE dm_invoice_lines
  ADD CONSTRAINT dm_invoice_lines_eligibility_period_chk
  CHECK (
    eligibility_period_start IS NULL
    OR eligibility_period_end IS NULL
    OR eligibility_period_end >= eligibility_period_start
  );

COMMIT;
