-- =============================================================================
-- 0067_verify.sql — Run after applying 0067_realign_dynamic_parking_offset.sql
-- =============================================================================
-- Confirms the fix is live and that re-promoting Foxcroft succeeds.
--
-- IMPORTANT: Run query 1 FIRST to confirm the function body contains the
-- v11-dynamic-park-offset signature. THEN run query 2 (dry-run) to see what
-- would happen on Foxcroft. THEN run query 3 only if you want to actually
-- apply the realign — that mutates dm_draw_schedule_lines.
-- =============================================================================

-- 1. Confirm function is updated (look for "v11-dynamic-park-offset" string)
SELECT
  proname,
  CASE
    WHEN pg_get_functiondef(oid) LIKE '%v11-dynamic-park-offset%'
      THEN '✅ updated'
    ELSE '❌ still old version — apply 0067 again'
  END AS status
FROM pg_proc
WHERE proname = 'realign_deal_to_excel_format';

-- 2. Pre-flight: how many parked rows exist for Foxcroft right now?
-- Expect: some (the leftover ones that caused the duplicate-key bug).
SELECT
  format_id,
  COUNT(*) FILTER (WHERE item_number < 10000) AS live_rows,
  COUNT(*) FILTER (WHERE item_number >= 10000) AS parked_rows,
  MAX(item_number) AS max_item_number
FROM dm_draw_schedule_lines
WHERE deal_id = 'deal_1776803116365_s1juio'
GROUP BY format_id;

-- 3. Dry-run the realign to confirm no errors thrown.
-- Output: 32 rows showing the computed schedule (no DB writes).
SELECT * FROM realign_deal_to_excel_format(
  'deal_1776803116365_s1juio',
  TRUE,  -- p_dry_run
  FALSE, -- p_zero_unmapped
  FALSE  -- p_force
);

-- 4. (Optional) Apply for real — only run after verifying step 3 looks right.
-- Output: same 32 rows, plus the rows are actually written to the table.
-- The NOTICE lines in the function will show "Parked N rows with offset +X"
-- where X is dynamically computed (NOT a fixed 10000).
--
-- SELECT * FROM realign_deal_to_excel_format(
--   'deal_1776803116365_s1juio',
--   FALSE, -- p_dry_run (apply)
--   FALSE, -- p_zero_unmapped
--   FALSE  -- p_force
-- );

-- 5. Post-apply: confirm no duplicate item_numbers
SELECT
  format_id,
  item_number,
  COUNT(*) AS row_count
FROM dm_draw_schedule_lines
WHERE deal_id = 'deal_1776803116365_s1juio'
GROUP BY format_id, item_number
HAVING COUNT(*) > 1;
-- Expect: 0 rows (no duplicates)
