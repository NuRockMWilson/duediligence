-- =============================================================================
-- DIAGNOSTIC — Foxcroft residual variance (run AFTER applying 0071)
-- =============================================================================
-- Read-only. Pinpoints the ~$3,096 that remains after migration 0071 removes
-- the $5.48M of duplicate parked rows.
--
--   Pre-0071 variance:  $5,485,511  (dev-mgmt $48,945,346 vs UW $43,459,835)
--   Parked-row dups:    $5,482,415  (removed by 0071)
--   Residual:           $    3,096  (this script finds where it lives)
--
-- Uses realign_deal_to_excel_format(..., p_dry_run := TRUE) — the function's
-- dry-run returns the EXACT per-line amounts it would write from the UW model
-- via the GL path, WITHOUT mutating anything. Comparing those to the stored
-- revised_budget shows which line(s) drifted.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- Q1. Realign-computed total vs UW model total
-- ----------------------------------------------------------------------------
-- If `gap` ≈ 0: the GL mapping is complete — every UW dollar has a schedule
--   home. The residual is then stored-vs-computed drift (Q2 shows where), and
--   re-running realign (non-dry) would zero it.
-- If `gap` ≈ $3,096: a real mapping issue — a UW line whose GL split fractions
--   don't sum to 1.0, or a GL with no schedule home. Q3 helps locate it.
WITH computed AS (
  SELECT computed_amount
  FROM realign_deal_to_excel_format(
    (SELECT id FROM deals WHERE name ILIKE '%foxcroft%' LIMIT 1),
    TRUE   -- p_dry_run: read-only
  )
),
uw AS (
  SELECT SUM(COALESCE((elem->>'amount')::NUMERIC, 0)) AS uw_total
  FROM deals d, LATERAL jsonb_array_elements(d.model->'constructionBudget') elem
  WHERE d.name ILIKE '%foxcroft%'
    AND elem->>'id' IS NOT NULL
)
SELECT
  (SELECT SUM(computed_amount) FROM computed) AS realign_computed_total,
  (SELECT uw_total FROM uw)                   AS uw_model_total,
  (SELECT SUM(computed_amount) FROM computed) - (SELECT uw_total FROM uw) AS gap;

-- ----------------------------------------------------------------------------
-- Q2. Per-line: stored revised_budget vs realign-computed amount
-- ----------------------------------------------------------------------------
-- Only rows where they differ. The SUM of `revised_minus_computed` across all
-- rows is the residual variance. This is the definitive line-by-line answer to
-- "where is the $3,096?".
WITH computed AS (
  SELECT item_number, description, computed_amount
  FROM realign_deal_to_excel_format(
    (SELECT id FROM deals WHERE name ILIKE '%foxcroft%' LIMIT 1),
    TRUE
  )
)
SELECT
  COALESCE(d.item_number, c.item_number)              AS item_number,
  COALESCE(d.description, c.description)               AS description,
  d.original_budget,
  d.revised_budget,
  c.computed_amount                                   AS realign_computed,
  ROUND(COALESCE(d.revised_budget, 0) - COALESCE(c.computed_amount, 0), 2)
                                                      AS revised_minus_computed,
  ROUND(COALESCE(d.revised_budget, 0) - COALESCE(d.original_budget, 0), 2)
                                                      AS revised_minus_original
FROM computed c
FULL OUTER JOIN dm_draw_schedule_lines d
  ON  d.item_number = c.item_number
  AND d.deal_id  = (SELECT id FROM deals WHERE name ILIKE '%foxcroft%' LIMIT 1)
  AND d.format_id = '250bd7b0-acc0-4fef-8294-b5dc7e89a1ee'
  AND d.item_number < 10000
WHERE ROUND(COALESCE(d.revised_budget, 0) - COALESCE(c.computed_amount, 0), 2) <> 0
ORDER BY ABS(ROUND(COALESCE(d.revised_budget, 0) - COALESCE(c.computed_amount, 0), 2)) DESC;

-- ----------------------------------------------------------------------------
-- Q3. Lines with a manual adjustment (revised ≠ original)
-- ----------------------------------------------------------------------------
-- If the residual lines in Q2 also show up here with a matching delta, the
-- $3,096 is a legitimate change-order / manual revision — NOT an error. In
-- that case the right action is to leave it and (optionally) raise the
-- banner's $0.50 amber threshold so immaterial revisions don't trip it.
SELECT
  item_number,
  description,
  original_budget,
  revised_budget,
  ROUND(revised_budget - original_budget, 2) AS adjustment,
  (metadata->>'budget_manually_overridden')  AS manually_overridden
FROM dm_draw_schedule_lines
WHERE deal_id = (SELECT id FROM deals WHERE name ILIKE '%foxcroft%' LIMIT 1)
  AND format_id = '250bd7b0-acc0-4fef-8294-b5dc7e89a1ee'
  AND item_number < 10000
  AND ROUND(revised_budget - original_budget, 2) <> 0
ORDER BY ABS(ROUND(revised_budget - original_budget, 2)) DESC;

-- ----------------------------------------------------------------------------
-- Q4. Whole-deal totals (post-0071 sanity)
-- ----------------------------------------------------------------------------
SELECT
  COUNT(*)              AS n_lines,
  SUM(original_budget)  AS total_original,
  SUM(revised_budget)   AS total_revised
FROM dm_draw_schedule_lines
WHERE deal_id = (SELECT id FROM deals WHERE name ILIKE '%foxcroft%' LIMIT 1)
  AND format_id = '250bd7b0-acc0-4fef-8294-b5dc7e89a1ee'
  AND item_number < 10000;
-- Expect n_lines = 32, total_revised ≈ UW TDC ± the residual Q2 explains.

-- ----------------------------------------------------------------------------
-- Q5. Split-fraction audit — THE culprit finder for the +$3,096 residual
-- ----------------------------------------------------------------------------
-- Q4 confirmed: 32 lines, original == revised (no manual adjustments), total
-- $43,462,931 vs UW TDC $43,459,835 → schedule is +$3,096 OVER the UW model.
--
-- realign computes each schedule line as SUM(uw_amount × split_fraction) over
-- the GL path. For a clean 1:1 mapping, the split fractions applied to each UW
-- line should sum to EXACTLY 1.0 — so the schedule total equals the UW total.
-- A line that's OVER-allocated (sum > 1.0) double-counts; UNDER (sum < 1.0)
-- drops dollars. This query lists every UW line whose applied split ≠ 1.0 and
-- the resulting over/under dollars. The SUM of `over_under_allocation` should
-- equal the +$3,096 residual, and the top row is almost certainly the culprit
-- (a UW line mapped to two GLs, or a GL split fraction that doesn't sum to 1).
WITH foxcroft AS (
  SELECT id, model FROM deals WHERE name ILIKE '%foxcroft%' LIMIT 1
),
uw AS (
  SELECT
    elem->>'id'          AS uw_id,
    elem->>'description'  AS uw_desc,
    COALESCE((elem->>'amount')::NUMERIC, 0) AS uw_amount
  FROM foxcroft d, LATERAL jsonb_array_elements(d.model->'constructionBudget') elem
  WHERE elem->>'id' IS NOT NULL
)
SELECT
  u.uw_id,
  u.uw_desc,
  u.uw_amount,
  COUNT(DISTINCT ulg.gl_account)                       AS n_gl_accounts,
  COALESCE(SUM(gtfl.split_fraction), 0)                AS total_split_applied,
  ROUND(u.uw_amount * (COALESCE(SUM(gtfl.split_fraction), 0) - 1), 2)
                                                       AS over_under_allocation
FROM uw u
LEFT JOIN dm_underwriting_line_gl ulg ON ulg.source_line_id = u.uw_id
LEFT JOIN gl_to_format_line gtfl
  ON  gtfl.gl_account = ulg.gl_account
  AND gtfl.format_id  = '250bd7b0-acc0-4fef-8294-b5dc7e89a1ee'
WHERE u.uw_amount > 0
GROUP BY u.uw_id, u.uw_desc, u.uw_amount
HAVING ROUND(COALESCE(SUM(gtfl.split_fraction), 0), 4) <> 1.0000
ORDER BY ABS(ROUND(u.uw_amount * (COALESCE(SUM(gtfl.split_fraction), 0) - 1), 2)) DESC;
-- Rows where total_split_applied > 1.0 → over-counted (raises schedule total).
-- Rows where total_split_applied < 1.0 → under-counted (drops dollars).
-- Rows where total_split_applied = 0   → the line maps to a GL with no
--   schedule home (a true orphan) — would show as UNDER by its full amount.
-- The net of all over_under_allocation = the residual variance.
