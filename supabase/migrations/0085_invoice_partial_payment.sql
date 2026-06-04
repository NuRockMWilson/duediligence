-- =============================================================================
-- Migration 0085 — partial invoice payments (amount_paid + 'partial' status)
-- =============================================================================
-- payment_status was binary (unpaid | paid), so an invoice that was only
-- partially paid had to be miscoded as one or the other. This adds:
--
--   amount_paid    numeric NOT NULL DEFAULT 0  — dollars actually paid so far
--   payment_status now allows 'partial' (unpaid | partial | paid)
--
-- Outstanding everywhere becomes gross_amount − amount_paid (clamped at 0):
--   unpaid  → amount_paid 0        → outstanding = gross
--   partial → 0 < amount_paid < gr → outstanding = gross − amount_paid
--   paid    → amount_paid = gross  → outstanding = 0
--
-- Backfill: paid rows get amount_paid = gross_amount (so existing fully-paid
-- invoices keep outstanding 0); everything else stays 0. Additive + idempotent.
-- =============================================================================

BEGIN;

-- 1. amount_paid column.
ALTER TABLE dm_invoices
  ADD COLUMN IF NOT EXISTS amount_paid numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN dm_invoices.amount_paid IS
  'Dollars paid so far. outstanding = gross_amount - amount_paid. For status=paid this equals gross_amount; for partial it is between 0 and gross.';

-- 2. Widen the payment_status CHECK to include 'partial'. The original
--    constraint name is unknown across environments, so drop any CHECK on this
--    table that references payment_status, then add a deterministically-named one.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'dm_invoices'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%payment_status%'
  LOOP
    EXECUTE format('ALTER TABLE dm_invoices DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE dm_invoices
  ADD CONSTRAINT dm_invoices_payment_status_check
  CHECK (payment_status IN ('unpaid', 'partial', 'paid'));

-- 3. Backfill: fully-paid invoices have paid their full gross.
UPDATE dm_invoices
   SET amount_paid = gross_amount
 WHERE payment_status = 'paid'
   AND amount_paid = 0;

COMMIT;
