-- =============================================================================
-- REBALANCE ALL DEFERRED DEVELOPER FEES — portfolio-wide stored-value cleanup
-- =============================================================================
-- The DDF is the sources/uses plug. dev-mgmt now computes it LIVE for display
-- (lib/finance/deferred-dev-fee.ts), so every deal's UI already balances. This
-- script brings the STORED dm_funding_sources values in line too, so raw-table
-- consumers (exports, cost cert) match what the UI shows.
--
-- The portfolio audit (A4) flagged:
--   Westview Landing  stored DDF $5,861,175.01 → should be $5,839,009.01 ($22,166 high)
--   Blossom Trail     stored DDF $8,514,278.25 → should be $8,512,797.25 ($ 1,481 high)
--   (Foxcroft already corrected via the earlier Option-B run.)
--
-- For each deal it sets:
--   DDF.commitment_amount = max(0, net_uses − other_net_sources)
-- where:
--   net_uses          = Σ revised_budget on the live schedule (item < 10000,
--                       NuRock Standard format)
--   other_net_sources = Σ commitment_amount of sources that stay in the
--                       permanent stack (excludes construction_loan, which is
--                       paid off at perm, and the DDF itself).
--
-- SAFETY:
--   - DDF is never drawn against during construction, so changing its
--     commitment doesn't affect any draw allocation math.
--   - Balances stored sources to the CURRENT stored schedule. If a deal's
--     schedule is itself stale vs the UW model (audit A3), re-realign that
--     deal FIRST, then re-run this so the DDF balances to the corrected uses.
--   - Run the PREVIEW first; only run the UPDATE if the previewed
--     ddf_should_be values look right.
-- =============================================================================

-- ----- PREVIEW: every deal's current vs should-be DDF -----
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
    SUM(CASE WHEN kind = 'deferred_dev_fee' THEN commitment_amount ELSE 0 END) AS stored_ddf,
    SUM(CASE WHEN kind NOT IN ('construction_loan','deferred_dev_fee')
             THEN commitment_amount ELSE 0 END) AS other_net,
    COUNT(*) FILTER (WHERE kind = 'deferred_dev_fee') AS has_ddf
  FROM dm_funding_sources
  GROUP BY deal_id
)
SELECT
  d.name                                               AS deal_name,
  u.deal_id,
  u.net_uses,
  src.other_net,
  src.stored_ddf,
  ROUND(GREATEST(u.net_uses - src.other_net, 0), 2)    AS ddf_should_be,
  ROUND(src.stored_ddf - GREATEST(u.net_uses - src.other_net, 0), 2) AS ddf_gap
FROM uses u
JOIN src ON src.deal_id = u.deal_id
LEFT JOIN deals d ON d.id = u.deal_id
WHERE src.has_ddf > 0
  AND ABS(ROUND(src.stored_ddf - GREATEST(u.net_uses - src.other_net, 0), 2)) > 0.50
ORDER BY ABS(ROUND(src.stored_ddf - GREATEST(u.net_uses - src.other_net, 0), 2)) DESC;

-- ----- APPLY: rebalance every stale DDF to the plug -----
WITH uses AS (
  SELECT deal_id, SUM(revised_budget) AS net_uses
  FROM dm_draw_schedule_lines
  WHERE item_number < 10000
    AND format_id = '250bd7b0-acc0-4fef-8294-b5dc7e89a1ee'
  GROUP BY deal_id
),
other AS (
  SELECT deal_id,
         SUM(CASE WHEN kind NOT IN ('construction_loan','deferred_dev_fee')
                  THEN commitment_amount ELSE 0 END) AS other_net
  FROM dm_funding_sources
  GROUP BY deal_id
),
target AS (
  SELECT u.deal_id,
         GREATEST(u.net_uses - o.other_net, 0) AS ddf_target
  FROM uses u JOIN other o ON o.deal_id = u.deal_id
)
UPDATE dm_funding_sources fs
SET commitment_amount = ROUND(t.ddf_target, 2)
FROM target t
WHERE fs.deal_id = t.deal_id
  AND fs.kind = 'deferred_dev_fee'
  AND ROUND(fs.commitment_amount, 2) <> ROUND(t.ddf_target, 2)
RETURNING fs.deal_id, fs.name, fs.commitment_amount;

-- ----- VERIFY: every deal's stored sources now balance to uses -----
WITH uses AS (
  SELECT deal_id, SUM(revised_budget) AS net_uses
  FROM dm_draw_schedule_lines
  WHERE item_number < 10000
    AND format_id = '250bd7b0-acc0-4fef-8294-b5dc7e89a1ee'
  GROUP BY deal_id
),
src AS (
  SELECT deal_id,
         SUM(commitment_amount) AS gross,
         SUM(CASE WHEN kind = 'construction_loan' THEN commitment_amount ELSE 0 END) AS payoff
  FROM dm_funding_sources
  GROUP BY deal_id
)
SELECT
  d.name AS deal_name,
  u.deal_id,
  src.gross - src.payoff AS net_sources,
  u.net_uses,
  ROUND((src.gross - src.payoff) - u.net_uses, 2) AS sources_minus_uses
FROM uses u
JOIN src ON src.deal_id = u.deal_id
LEFT JOIN deals d ON d.id = u.deal_id
ORDER BY ABS(ROUND((src.gross - src.payoff) - u.net_uses, 2)) DESC;
-- Expect sources_minus_uses ≈ 0.00 for every deal.
