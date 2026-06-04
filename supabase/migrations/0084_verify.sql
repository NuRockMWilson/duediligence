-- Verify 0084 — dm_affiliate_reimbursements
-- Run after applying 0084_affiliate_reimbursements.sql.

-- 1. Table + columns exist with the right types (deal_id must be TEXT to match
--    deals.id; affiliate_id uuid; amount numeric; reimbursement_date date).
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'dm_affiliate_reimbursements'
ORDER BY ordinal_position;

-- 2. FK to deals(id) is present and typed text→text (no 42804 mismatch).
SELECT
  tc.constraint_name,
  kcu.column_name,
  ccu.table_name  AS references_table,
  ccu.column_name AS references_column
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.table_name = 'dm_affiliate_reimbursements'
  AND tc.constraint_type = 'FOREIGN KEY';

-- 3. RLS enabled + policy present.
SELECT relrowsecurity FROM pg_class WHERE relname = 'dm_affiliate_reimbursements';
SELECT polname FROM pg_policy
WHERE polrelid = 'dm_affiliate_reimbursements'::regclass;

-- 4. CHECK (amount > 0) rejects non-positive amounts (expect ERROR on the 2nd).
-- INSERT INTO dm_affiliate_reimbursements (deal_id, affiliate_name, amount, reimbursement_date)
--   VALUES ('<dealId>', 'Test', 100, current_date);          -- ok
-- INSERT INTO dm_affiliate_reimbursements (deal_id, affiliate_name, amount, reimbursement_date)
--   VALUES ('<dealId>', 'Test', 0, current_date);            -- must fail (23514)

-- 5. In the realtime publication.
SELECT tablename FROM pg_publication_tables
WHERE pubname = 'supabase_realtime' AND tablename = 'dm_affiliate_reimbursements';
