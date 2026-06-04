-- Verify: table + PUBLIC ALL policy (no roles / TO clause)
SELECT polname, polcmd, polroles::regrole[] AS roles
FROM pg_policy
WHERE polrelid = 'dm_notifications'::regclass;

-- Verify: indexes
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'dm_notifications';

-- Sanity: empty on first apply
SELECT count(*) AS rows FROM dm_notifications;
