-- Verify: dm_report_schedule_lines exists with a PUBLIC RLS policy (no roles)
SELECT polname, polroles::regrole[] AS roles, pg_get_expr(polqual, polrelid) AS using_expr
FROM pg_policy
WHERE polrelid = 'dm_report_schedule_lines'::regclass;

-- Verify: dm_draw_schedule_lines now holds ONLY the default (NuRock) format
SELECT f.slug AS format, count(*) AS lines
FROM dm_draw_schedule_lines d
JOIN nurock_schedule_formats f ON f.id = d.format_id
WHERE d.item_number < 10000
GROUP BY f.slug
ORDER BY f.slug;

-- Verify: rows now living in the report table, per deal + format
SELECT r.deal_id, f.slug AS format, count(*) AS lines
FROM dm_report_schedule_lines r
JOIN nurock_schedule_formats f ON f.id = r.format_id
GROUP BY r.deal_id, f.slug
ORDER BY r.deal_id, f.slug;

-- End-to-end: include FHFC DFCC for Foxcroft, regenerate reports, inspect.
-- Operational dm_draw_schedule_lines must be UNCHANGED by this (32 NuRock rows).
INSERT INTO dm_deal_formats (deal_id, format_id)
VALUES ('deal_1776803116365_s1juio', '752ec5ac-d105-415c-af5f-049fe008ce17')
ON CONFLICT DO NOTHING;

SELECT regenerate_report_schedule_lines('deal_1776803116365_s1juio');

SELECT f.slug AS format, count(*) AS report_lines, sum(r.revised_budget) AS total
FROM dm_report_schedule_lines r
JOIN nurock_schedule_formats f ON f.id = r.format_id
WHERE r.deal_id = 'deal_1776803116365_s1juio'
GROUP BY f.slug;

-- Confirm operational table untouched (still 32 NuRock rows for Foxcroft)
SELECT count(*) AS foxcroft_operational_lines
FROM dm_draw_schedule_lines
WHERE deal_id = 'deal_1776803116365_s1juio' AND item_number < 10000;
