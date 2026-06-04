-- Verify 0085 — amount_paid + partial payment status
-- Run after applying 0085_invoice_partial_payment.sql.

-- 1. amount_paid column exists, numeric, NOT NULL, default 0.
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'dm_invoices' AND column_name = 'amount_paid';

-- 2. payment_status CHECK now allows partial (definition should list all three).
SELECT conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid = 'dm_invoices'::regclass
  AND contype = 'c'
  AND pg_get_constraintdef(oid) ILIKE '%payment_status%';

-- 3. 'partial' is accepted (expect success), a bogus value rejected (expect 23514).
-- UPDATE dm_invoices SET payment_status='partial' WHERE id = '<someId>';   -- ok
-- UPDATE dm_invoices SET payment_status='half'    WHERE id = '<someId>';   -- must fail

-- 4. Backfill correctness — no fully-paid invoice left with amount_paid 0
--    (unless its gross is 0). Expect 0 rows.
SELECT count(*) AS paid_with_zero_amount_paid
FROM dm_invoices
WHERE payment_status = 'paid' AND amount_paid = 0 AND gross_amount <> 0;

-- 5. Distribution sanity.
SELECT payment_status, count(*),
       sum(gross_amount) AS gross,
       sum(amount_paid)  AS paid,
       sum(gross_amount - amount_paid) AS outstanding
FROM dm_invoices
GROUP BY payment_status
ORDER BY payment_status;
