-- =============================================================================
-- 0068_verify.sql — Run AFTER applying 0068
-- =============================================================================

-- 1. Confirm column is gone
SELECT
  CASE
    WHEN COUNT(*) = 0 THEN '✅ model_line_id column dropped'
    ELSE '❌ model_line_id still present — apply 0068 again'
  END AS status
FROM information_schema.columns
WHERE table_name = 'cost_account_map'
  AND column_name = 'model_line_id';

-- 2. Confirm dm_underwriting_line_gl is still the canonical source of truth
SELECT
  COUNT(DISTINCT source_line_id)                                    AS distinct_ul,
  COUNT(DISTINCT gl_account)                                        AS distinct_gl,
  COUNT(*)                                                          AS mappings,
  COUNT(*) - COUNT(DISTINCT gl_account)                             AS extra_when_many_to_one,
  ROUND(AVG(t::numeric), 2)                                         AS avg_uls_per_gl
FROM dm_underwriting_line_gl,
LATERAL (
  SELECT COUNT(*) AS t
    FROM dm_underwriting_line_gl x
   WHERE x.gl_account = dm_underwriting_line_gl.gl_account
) sub;

-- 3. Spot-check: every GL on cost_account_map either has at least one UL in
-- dm_underwriting_line_gl OR is intentionally unmapped (orphan GL).
SELECT
  cam.gl_account,
  cam.account_description,
  COUNT(ulg.source_line_id) AS mapped_uls
FROM cost_account_map cam
LEFT JOIN dm_underwriting_line_gl ulg ON ulg.gl_account = cam.gl_account
GROUP BY cam.gl_account, cam.account_description
ORDER BY mapped_uls ASC, cam.gl_account
LIMIT 20;
-- Read: rows with mapped_uls = 0 are GLs with no UW lines pointing at them.
-- That's normal (the chart has GLs not used by every deal). What MUST be
-- nonzero is the GLs that show up in v_inserted reports / draw schedules.
