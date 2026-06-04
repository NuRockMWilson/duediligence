-- Verify: dm_deal_formats exists with PUBLIC RLS policy (no roles / TO clause)
SELECT polname, polroles::regrole[] AS roles, pg_get_expr(polqual, polrelid) AS using_expr
FROM pg_policy
WHERE polrelid = 'dm_deal_formats'::regclass;

-- Verify: every deal seeded with NuRock Standard (and any other inclusions)
SELECT df.deal_id, f.slug AS included_format
FROM dm_deal_formats df
JOIN nurock_schedule_formats f ON f.id = df.format_id
ORDER BY df.deal_id, f.sort_order;

-- Verify: deals.active_format_id is gone
SELECT count(*) AS active_format_id_still_present
FROM information_schema.columns
WHERE table_name = 'deals' AND column_name = 'active_format_id';

-- Foxcroft dry-run: with only NuRock Standard included, expect 32 rows only.
SELECT * FROM realign_deal_to_excel_format('deal_1776803116365_s1juio', TRUE, FALSE, FALSE);

-- To test multi-format: include FHFC DFCC for Foxcroft, then dry-run again
-- (should now show NuRock 32 + FHFC DFCC rows). Uncomment to run:
-- INSERT INTO dm_deal_formats (deal_id, format_id)
-- VALUES ('deal_1776803116365_s1juio', '752ec5ac-d105-415c-af5f-049fe008ce17')
-- ON CONFLICT DO NOTHING;
-- SELECT * FROM realign_deal_to_excel_format('deal_1776803116365_s1juio', TRUE, FALSE, FALSE);
