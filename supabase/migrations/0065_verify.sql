-- Verify: line_type column + check constraint
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_name = 'nurock_standard_schedule_lines' AND column_name = 'line_type';

-- Verify: members table + PUBLIC RLS policy (no roles)
SELECT polname, polroles::regrole[] AS roles
FROM pg_policy
WHERE polrelid = 'nurock_schedule_line_members'::regclass;

-- All existing lines defaulted to 'detail'
SELECT line_type, count(*) AS lines
FROM nurock_standard_schedule_lines
GROUP BY line_type;
