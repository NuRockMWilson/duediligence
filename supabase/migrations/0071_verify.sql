-- =============================================================================
-- Migration 0071 verify — Realign merge-in-place
-- =============================================================================
-- Run AFTER applying 0071_realign_merge_in_place.sql. Confirms:
--   1. No parked rows (item_number >= 10000) remain in ANY deal.
--   2. No deal has duplicate descriptions in its live schedule.
--   3. Each deal's draw-schedule total now reconciles to its UW model TDC.
--   4. The realign function is at version v12-merge-in-place.
-- =============================================================================

-- 1. Parked rows across ALL deals — must be ZERO.
SELECT
  deal_id,
  COUNT(*) AS parked_rows
FROM dm_draw_schedule_lines
WHERE item_number >= 10000
GROUP BY deal_id
ORDER BY parked_rows DESC;
-- (Empty result = clean.)

-- 2. Duplicate descriptions in the live range, across ALL deals — ZERO.
SELECT
  deal_id,
  description,
  COUNT(*)                                       AS n_copies,
  array_agg(item_number ORDER BY item_number)    AS at_item_numbers
FROM dm_draw_schedule_lines
WHERE item_number < 10000
GROUP BY deal_id, description
HAVING COUNT(*) > 1
ORDER BY deal_id, description;
-- (Empty result = clean.)

-- 3. Per-deal schedule total vs UW model TDC. The `variance` column should
--    be near $0 for every deal (small rounding only). Large positive
--    variances would indicate a deal still carrying duplicates or an
--    unmapped-line issue separate from this bug.
WITH sched AS (
  SELECT
    deal_id,
    SUM(original_budget) AS schedule_total
  FROM dm_draw_schedule_lines
  WHERE item_number < 10000
    AND format_id = '250bd7b0-acc0-4fef-8294-b5dc7e89a1ee'
  GROUP BY deal_id
),
uw AS (
  SELECT
    d.id AS deal_id,
    SUM(COALESCE((elem->>'amount')::NUMERIC, 0)) AS uw_tdc
  FROM deals d, LATERAL jsonb_array_elements(d.model->'constructionBudget') AS elem
  WHERE elem->>'id' IS NOT NULL
  GROUP BY d.id
)
SELECT
  COALESCE(s.deal_id, u.deal_id)                       AS deal_id,
  dn.name                                              AS deal_name,
  s.schedule_total,
  u.uw_tdc,
  ROUND(COALESCE(s.schedule_total, 0) - COALESCE(u.uw_tdc, 0), 2) AS variance
FROM sched s
FULL OUTER JOIN uw u ON u.deal_id = s.deal_id
LEFT JOIN deals dn ON dn.id = COALESCE(s.deal_id, u.deal_id)
ORDER BY ABS(ROUND(COALESCE(s.schedule_total, 0) - COALESCE(u.uw_tdc, 0), 2)) DESC;
-- NOTE: a deal can still show a NON-zero variance for legitimate reasons
-- unrelated to this bug — e.g. UW lines with no GL mapping (Land Extension
-- Fees, Land Loan Fees, Construction Loan Interest etc. that have no Excel
-- home). Those are a SEPARATE reconciliation item. What this migration
-- guarantees is that NO part of the variance is from duplicate parked rows.

-- 4. Confirm the function carries the new version stamp. Realign any deal
--    in dry-run mode and check the metadata version on its rows, OR inspect
--    the function source directly:
SELECT
  proname,
  CASE
    WHEN prosrc LIKE '%v12-merge-in-place%' THEN 'v12-merge-in-place (NEW)'
    WHEN prosrc LIKE '%v11-dynamic-park-offset%' THEN 'v11-dynamic-park-offset (OLD — migration did not apply!)'
    ELSE 'unknown version'
  END AS realign_version,
  CASE
    WHEN prosrc LIKE '%item_number + v_park_offset%'
      OR prosrc LIKE '%item_number + 10000%'
    THEN 'STILL PARKS — bug present'
    ELSE 'merge-in-place — no parking'
  END AS strategy
FROM pg_proc
WHERE proname = 'realign_deal_to_excel_format';
-- Expect: realign_version = 'v12-merge-in-place (NEW)', strategy =
-- 'merge-in-place — no parking'.
