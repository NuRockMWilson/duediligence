-- =============================================================================
-- PORTFOLIO STALENESS AUDIT — all deals, all three failure modes
-- =============================================================================
-- Read-only. Run in the Supabase SQL editor. Surfaces every deal that may
-- need attention after the Foxcroft reconciliation work, across the three
-- issues we found:
--
--   1. Duplicate parked rows      (item_number >= 10000)  — should be ZERO
--      everywhere after migration 0071, but this confirms it.
--   2. Stale schedule             (stored revised_budget ≠ what a fresh
--      realign would compute from the current UW model)
--   3. Sources/Uses imbalance     (net sources ≠ net uses — usually a stale
--      Deferred Developer Fee snapshot; the live-plug fix corrects the UI,
--      this flags deals whose STORED data is still off for exports/cost-cert)
--
-- Each section returns one row per affected deal. An all-empty result = the
-- whole portfolio is clean.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- A1. Duplicate parked rows (item_number >= 10000) — expect EMPTY post-0071
-- ----------------------------------------------------------------------------
SELECT
  d.name                                   AS deal_name,
  dsl.deal_id,
  COUNT(*)                                 AS parked_rows,
  SUM(dsl.revised_budget)                  AS parked_dollars
FROM dm_draw_schedule_lines dsl
JOIN deals d ON d.id = dsl.deal_id
WHERE dsl.item_number >= 10000
GROUP BY d.name, dsl.deal_id
ORDER BY parked_dollars DESC;

-- ----------------------------------------------------------------------------
-- A2. Manual adjustments per deal (revised ≠ original)
-- ----------------------------------------------------------------------------
-- Deals listed here have change-order / manual budget revisions. They are NOT
-- broken — but they're the deals where a blind re-realign WOULD wipe COs, so
-- treat them carefully (re-sync via promote with intent, not a bulk realign).
SELECT
  d.name                                          AS deal_name,
  dsl.deal_id,
  COUNT(*)                                        AS adjusted_lines,
  ROUND(SUM(dsl.revised_budget - dsl.original_budget), 2) AS net_adjustment
FROM dm_draw_schedule_lines dsl
JOIN deals d ON d.id = dsl.deal_id
WHERE dsl.item_number < 10000
  AND dsl.format_id = '250bd7b0-acc0-4fef-8294-b5dc7e89a1ee'
  AND ROUND(dsl.revised_budget - dsl.original_budget, 2) <> 0
GROUP BY d.name, dsl.deal_id
ORDER BY ABS(ROUND(SUM(dsl.revised_budget - dsl.original_budget), 2)) DESC;

-- ----------------------------------------------------------------------------
-- A3. Stale schedule — stored revised total vs UW model TDC
-- ----------------------------------------------------------------------------
-- For each deal: the live schedule total vs the sum of the UW model's
-- constructionBudget. A non-zero `variance` means the stored schedule drifted
-- from the current UW model (stale promote/realign). Deals with adjustments
-- (A2) will legitimately differ — cross-reference. A clean deal with a
-- non-zero variance here is a candidate for a re-realign.
WITH sched AS (
  SELECT deal_id, SUM(revised_budget) AS schedule_total
  FROM dm_draw_schedule_lines
  WHERE item_number < 10000
    AND format_id = '250bd7b0-acc0-4fef-8294-b5dc7e89a1ee'
  GROUP BY deal_id
),
uw AS (
  SELECT d.id AS deal_id,
         SUM(COALESCE((elem->>'amount')::NUMERIC, 0)) AS uw_tdc
  FROM deals d, LATERAL jsonb_array_elements(d.model->'constructionBudget') elem
  WHERE elem->>'id' IS NOT NULL
  GROUP BY d.id
)
SELECT
  dn.name                                              AS deal_name,
  COALESCE(s.deal_id, u.deal_id)                       AS deal_id,
  s.schedule_total,
  u.uw_tdc,
  ROUND(COALESCE(s.schedule_total,0) - COALESCE(u.uw_tdc,0), 2) AS variance
FROM sched s
FULL OUTER JOIN uw u ON u.deal_id = s.deal_id
LEFT JOIN deals dn ON dn.id = COALESCE(s.deal_id, u.deal_id)
WHERE ABS(ROUND(COALESCE(s.schedule_total,0) - COALESCE(u.uw_tdc,0), 2)) > 0.50
ORDER BY ABS(ROUND(COALESCE(s.schedule_total,0) - COALESCE(u.uw_tdc,0), 2)) DESC;

-- ----------------------------------------------------------------------------
-- A4. Sources/Uses imbalance — STORED data (pre-live-plug)
-- ----------------------------------------------------------------------------
-- Net sources vs net uses per deal. The live-plug DDF fix makes the UI always
-- balance, but the STORED dm_funding_sources DDF may still be off — which
-- matters for anything reading the raw table (exports, cost cert). `ddf_gap`
-- is what a re-promote (or the Option-B SQL) would correct. Deals with a
-- non-zero `sources_minus_uses` AND a deferred_dev_fee row are candidates.
WITH uses AS (
  SELECT deal_id, SUM(revised_budget) AS net_uses
  FROM dm_draw_schedule_lines
  WHERE item_number < 10000
    AND format_id = '250bd7b0-acc0-4fef-8294-b5dc7e89a1ee'
  GROUP BY deal_id
),
src AS (
  SELECT
    deal_id,
    SUM(commitment_amount) AS gross,
    SUM(CASE WHEN kind = 'construction_loan' THEN commitment_amount ELSE 0 END) AS payoff,
    SUM(CASE WHEN kind = 'deferred_dev_fee' THEN commitment_amount ELSE 0 END)  AS stored_ddf,
    SUM(CASE WHEN kind NOT IN ('construction_loan','deferred_dev_fee')
             THEN commitment_amount ELSE 0 END)                                 AS other_net
  FROM dm_funding_sources
  GROUP BY deal_id
)
SELECT
  d.name                                               AS deal_name,
  COALESCE(u.deal_id, src.deal_id)                     AS deal_id,
  src.gross - src.payoff                               AS net_sources,
  u.net_uses,
  ROUND((src.gross - src.payoff) - u.net_uses, 2)      AS sources_minus_uses,
  src.stored_ddf,
  ROUND(GREATEST(u.net_uses - src.other_net, 0), 2)    AS ddf_should_be,
  ROUND(src.stored_ddf - GREATEST(u.net_uses - src.other_net, 0), 2) AS ddf_gap
FROM src
JOIN uses u ON u.deal_id = src.deal_id
LEFT JOIN deals d ON d.id = src.deal_id
WHERE ABS(ROUND((src.gross - src.payoff) - u.net_uses, 2)) > 0.50
ORDER BY ABS(ROUND((src.gross - src.payoff) - u.net_uses, 2)) DESC;
