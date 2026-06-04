-- Verify: format_id column on dm_draw_schedule_lines (NOT NULL, default = nurock-standard)
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'dm_draw_schedule_lines' AND column_name = 'format_id';

-- Verify: widened uniqueness key exists, old one gone
SELECT conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid = 'dm_draw_schedule_lines'::regclass AND contype = 'u';

-- Verify: deals.active_format_id exists, NOT NULL, FK present, all deals populated
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'deals' AND column_name = 'active_format_id';

SELECT id, name, active_format_id
FROM deals
ORDER BY name;

-- Verify: no rows left without a format_id
SELECT count(*) AS null_format_rows
FROM dm_draw_schedule_lines
WHERE format_id IS NULL;

-- Verify: rows per (deal_id, format_id). Pre-realign every deal sits on the
-- default format only; after a multi-format realign the realigned deal shows
-- both NuRock Standard (32) and FHFC DFCC (85).
SELECT dsl.deal_id, f.slug AS format, count(*) AS lines
FROM dm_draw_schedule_lines dsl
JOIN nurock_schedule_formats f ON f.id = dsl.format_id
WHERE dsl.item_number < 10000
GROUP BY dsl.deal_id, f.slug
ORDER BY dsl.deal_id, f.slug;

-- Dry-run the multi-format realign on Foxcroft (writes nothing). Expect rows
-- for both nurock-standard and fhfc_dfcc, distinguished by source_basis.
SELECT * FROM realign_deal_to_excel_format('deal_1776803116365_s1juio', TRUE, FALSE, FALSE);
