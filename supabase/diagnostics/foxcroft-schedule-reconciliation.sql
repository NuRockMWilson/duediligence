-- =============================================================================
-- DIAGNOSTIC — Foxcroft Cove draw-schedule vs UW model reconciliation
-- =============================================================================
-- Read-only. Paste into the Supabase SQL editor and run.
-- Compatible with both the web SQL editor and psql (no client meta-commands).
--
-- Background:
--   CFO observed:
--     - UW model TDC:       $43,459,835
--     - Draw Schedule total: $48,945,346
--     - Variance:           +$5,485,511 (draw is higher)
--     - Banner says 3 UW lines have no Excel home: Land, Land Extension
--       Fees, Land Loan Fees and Interest.
--   Visual evidence on the Draw Schedule shows a literal duplicate row:
--     - Item 26 "Land/Seller Payments" = $3,600,000
--     - Item 38 "Land/Seller Payments" = $3,600,000
--
-- This script answers 4 questions to scope the fix. Each section is an
-- independent query — the Supabase web editor will return them as separate
-- result sets, or you can run one block at a time.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- A. Duplicates inside the NuRock Standard template itself
-- ----------------------------------------------------------------------------
-- Expectation: ZERO rows for a clean template. If "Land/Seller Payments"
-- appears with n_copies=2, the duplicate is baked into the template and
-- every realigned deal will inherit it.
SELECT
  description,
  COUNT(*)                                          AS n_copies,
  array_agg(line_number ORDER BY line_number)       AS at_line_numbers,
  array_agg(section ORDER BY line_number)           AS sections
FROM nurock_standard_schedule_lines
WHERE format_id = '250bd7b0-acc0-4fef-8294-b5dc7e89a1ee'
GROUP BY description
HAVING COUNT(*) > 1
ORDER BY description;

-- ----------------------------------------------------------------------------
-- B1. Foxcroft's draw schedule — row-by-row
-- ----------------------------------------------------------------------------
-- The sum at the bottom should equal $48,945,346 (the dev-mgmt total the CFO
-- sees). Look for: (1) any item_number >= 10000 (orphaned parked rows from
-- a prior realign that still have FK references), and (2) duplicate
-- descriptions inside the live range.
SELECT
  item_number,
  description,
  section,
  original_budget,
  revised_budget,
  CASE
    WHEN item_number >= 10000 THEN 'PARKED (FK-bearing orphan)'
    ELSE 'live'
  END AS row_kind
FROM dm_draw_schedule_lines
WHERE deal_id = (
  SELECT id FROM deals WHERE name ILIKE '%foxcroft%' LIMIT 1
)
  AND format_id = '250bd7b0-acc0-4fef-8294-b5dc7e89a1ee'
ORDER BY item_number;

-- ----------------------------------------------------------------------------
-- B2. Foxcroft's draw schedule — duplicate summary (the smoking gun)
-- ----------------------------------------------------------------------------
SELECT
  description,
  COUNT(*)                                       AS n_copies,
  array_agg(item_number ORDER BY item_number)    AS at_item_numbers,
  SUM(original_budget)                           AS total_original,
  SUM(revised_budget)                            AS total_revised
FROM dm_draw_schedule_lines
WHERE deal_id = (
  SELECT id FROM deals WHERE name ILIKE '%foxcroft%' LIMIT 1
)
  AND format_id = '250bd7b0-acc0-4fef-8294-b5dc7e89a1ee'
GROUP BY description
HAVING COUNT(*) > 1
ORDER BY total_original DESC;

-- ----------------------------------------------------------------------------
-- C1. UW lines with NO GL mapping (the "no Excel home" lines)
-- ----------------------------------------------------------------------------
-- These are the construction-budget items in the UW model that have no
-- corresponding row in dm_underwriting_line_gl. They contribute to UW TDC
-- but cannot flow into the dev-mgmt draw schedule via realign.
WITH foxcroft AS (
  SELECT id, model FROM deals WHERE name ILIKE '%foxcroft%' LIMIT 1
),
uw_lines AS (
  SELECT
    elem->>'id'         AS uw_id,
    elem->>'description' AS uw_desc,
    elem->>'category'    AS uw_category,
    COALESCE((elem->>'amount')::NUMERIC, 0) AS uw_amount
  FROM foxcroft d, LATERAL jsonb_array_elements(d.model->'constructionBudget') AS elem
  WHERE elem->>'id' IS NOT NULL
    AND elem->>'id' <> ''
)
SELECT
  u.uw_id,
  u.uw_desc,
  u.uw_category,
  u.uw_amount,
  CASE
    WHEN ulg.gl_account IS NULL THEN 'UNMAPPED (no GL)'
    WHEN gtfl.schedule_line_id IS NULL THEN 'UNMAPPED (GL has no schedule home)'
    ELSE 'mapped → ' || gtfl.schedule_line_id::text
  END AS mapping_status
FROM uw_lines u
LEFT JOIN dm_underwriting_line_gl ulg ON ulg.source_line_id = u.uw_id
LEFT JOIN gl_to_format_line gtfl
       ON gtfl.gl_account = ulg.gl_account
      AND gtfl.format_id  = '250bd7b0-acc0-4fef-8294-b5dc7e89a1ee'
WHERE u.uw_amount > 0
  AND (ulg.gl_account IS NULL OR gtfl.schedule_line_id IS NULL)
ORDER BY u.uw_amount DESC;

-- ----------------------------------------------------------------------------
-- C2. Sum of unmapped UW lines (compare to the $5,485,511 variance)
-- ----------------------------------------------------------------------------
WITH foxcroft AS (
  SELECT id, model FROM deals WHERE name ILIKE '%foxcroft%' LIMIT 1
),
uw_lines AS (
  SELECT
    elem->>'id' AS uw_id,
    COALESCE((elem->>'amount')::NUMERIC, 0) AS uw_amount
  FROM foxcroft d, LATERAL jsonb_array_elements(d.model->'constructionBudget') AS elem
  WHERE elem->>'id' IS NOT NULL
)
SELECT
  COUNT(*)         AS n_unmapped_lines,
  SUM(u.uw_amount) AS sum_unmapped_amount
FROM uw_lines u
LEFT JOIN dm_underwriting_line_gl ulg ON ulg.source_line_id = u.uw_id
LEFT JOIN gl_to_format_line gtfl
       ON gtfl.gl_account = ulg.gl_account
      AND gtfl.format_id  = '250bd7b0-acc0-4fef-8294-b5dc7e89a1ee'
WHERE u.uw_amount > 0
  AND (ulg.gl_account IS NULL OR gtfl.schedule_line_id IS NULL);

-- ----------------------------------------------------------------------------
-- D1. Sources vs Uses balance on the per-deal sources table — by source
-- ----------------------------------------------------------------------------
-- The CFO observed Net Sources ($43,472,454) ≠ Net Uses ($48,945,346).
-- Confirm what's stored in dm_funding_sources for Foxcroft so we know
-- which side needs adjusting.
SELECT
  name,
  kind,
  position,
  commitment_amount,
  drawn_amount,
  CASE
    WHEN kind = 'construction' THEN 'paid off at perm'
    ELSE 'stays in cap stack'
  END AS net_treatment
FROM dm_funding_sources
WHERE deal_id = (
  SELECT id FROM deals WHERE name ILIKE '%foxcroft%' LIMIT 1
)
ORDER BY position NULLS LAST, name;

-- ----------------------------------------------------------------------------
-- D2. Sources vs Uses balance — totals
-- ----------------------------------------------------------------------------
SELECT
  SUM(commitment_amount)                                                AS gross_sources,
  SUM(CASE WHEN kind = 'construction' THEN commitment_amount ELSE 0 END) AS construction_payoff,
  SUM(CASE WHEN kind = 'construction' THEN 0 ELSE commitment_amount END) AS net_sources_to_project
FROM dm_funding_sources
WHERE deal_id = (
  SELECT id FROM deals WHERE name ILIKE '%foxcroft%' LIMIT 1
);
