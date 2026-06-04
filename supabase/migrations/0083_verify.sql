-- Verify 0083 — Multi-approver sign-off

-- 1. Table + columns.
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'dm_diligence_signoffs'
ORDER BY ordinal_position;

-- 2. PUBLIC RLS policy.
SELECT polname, polroles::regrole[] AS roles
FROM pg_policy WHERE polrelid = 'dm_diligence_signoffs'::regclass;

-- 3. Constraints (role check, decision check, unique role-per-item).
SELECT conname, contype
FROM pg_constraint
WHERE conrelid = 'dm_diligence_signoffs'::regclass
ORDER BY conname;
