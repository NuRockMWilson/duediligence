-- Verify 0082 — Due-Diligence crosswalk

-- 1. Table + columns exist with the expected constraints.
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'nurock_diligence_crosswalk'
ORDER BY ordinal_position;

-- 2. PUBLIC RLS policy (no roles).
SELECT polname, polroles::regrole[] AS roles
FROM pg_policy
WHERE polrelid = 'nurock_diligence_crosswalk'::regclass;

-- 3. Constraints: unique pair, mode check, weight check, no-self.
SELECT conname, contype
FROM pg_constraint
WHERE conrelid = 'nurock_diligence_crosswalk'::regclass
ORDER BY conname;

-- 4. Sanity: no crosswalk rows yet (until a template is imported + mapped).
SELECT count(*) AS crosswalk_rows FROM nurock_diligence_crosswalk;
