-- =============================================================================
-- FIX — Foxcroft Sources vs Uses balance (stale Deferred Developer Fee)
-- =============================================================================
-- After the schedule reconciliation (0071 + re-realign), Foxcroft's Uses =
-- $43,459,835 but Net Sources to Project = $43,472,454 → +$12,619 over-sourced.
--
-- Root cause: dm_funding_sources is a stale snapshot from an earlier UW model
-- promote. The Deferred Developer Fee is the PLUG (UW's buildSourcesUses sets
-- ddfPermanent = uses − all other sources). When the UW model's uses dropped,
-- the recomputed DDF should be $5,001,550.29 but the dm snapshot still holds
-- the old $5,014,169.29. The $12,619 difference is exactly the over-source.
--
--   Net uses (schedule):              $43,459,835.00
--   Other net sources (1st mtg +
--     LIHTC equity + Capital Magnet): $38,458,284.71
--   DDF should be (plug):             $ 5,001,550.29
--   DDF stored (stale):               $ 5,014,169.29
--   Over-source:                      $    12,619.00
--
-- TWO WAYS TO FIX — pick one:
--
--   OPTION A (preferred, durable): re-promote Foxcroft from the UW app.
--     The promote smart-merge re-runs buildSourcesUses on the CURRENT model
--     and updates the DDF funding source to the live ddfPermanent. This keeps
--     dev-mgmt mirroring the UW model exactly. Requires the UW NOT be locked
--     (post-closing lock blocks promote — if so, use Option B).
--
--   OPTION B (surgical SQL, below): set the DDF commitment to the balancing
--     plug directly. Produces the same value the UW computes (DDF is always
--     uses − other sources), but does it in dev-mgmt without a re-promote.
--     Safe because equity / first mortgage / Capital Magnet are fixed
--     commitments (not plugs) — the $12,619 lands entirely on the DDF.
--
-- Run the SELECT first to preview; then the UPDATE.
-- =============================================================================

-- ----- PREVIEW: what the DDF should be -----
WITH net_uses AS (
  SELECT SUM(revised_budget) AS u
  FROM dm_draw_schedule_lines
  WHERE deal_id = (SELECT id FROM deals WHERE name ILIKE '%foxcroft%' LIMIT 1)
    AND format_id = '250bd7b0-acc0-4fef-8294-b5dc7e89a1ee'
    AND item_number < 10000
),
other_net_sources AS (
  -- Everything that stays in the permanent capital stack EXCEPT the DDF plug.
  -- construction_loan sources are paid off at perm (net 0 to project).
  SELECT COALESCE(SUM(commitment_amount), 0) AS s
  FROM dm_funding_sources
  WHERE deal_id = (SELECT id FROM deals WHERE name ILIKE '%foxcroft%' LIMIT 1)
    AND kind NOT IN ('construction_loan', 'deferred_dev_fee')
)
SELECT
  (SELECT u FROM net_uses)                                AS net_uses,
  (SELECT s FROM other_net_sources)                       AS other_net_sources,
  (SELECT u FROM net_uses) - (SELECT s FROM other_net_sources) AS ddf_should_be,
  (SELECT commitment_amount FROM dm_funding_sources
    WHERE deal_id = (SELECT id FROM deals WHERE name ILIKE '%foxcroft%' LIMIT 1)
      AND kind = 'deferred_dev_fee')                      AS ddf_stored;
-- Expect ddf_should_be = 5,001,550.29, ddf_stored = 5,014,169.29.
-- IMPORTANT: cross-check ddf_should_be against the UW app's Sources & Uses
-- tab Deferred Developer Fee. If they match, Option B is exactly right. If
-- the UW shows a different DDF, the UW model itself is imbalanced — fix it
-- in the UW app and re-promote (Option A) instead of running the UPDATE.

-- ----- OPTION B: rebalance the DDF plug -----
WITH net_uses AS (
  SELECT SUM(revised_budget) AS u
  FROM dm_draw_schedule_lines
  WHERE deal_id = (SELECT id FROM deals WHERE name ILIKE '%foxcroft%' LIMIT 1)
    AND format_id = '250bd7b0-acc0-4fef-8294-b5dc7e89a1ee'
    AND item_number < 10000
),
other_net_sources AS (
  SELECT COALESCE(SUM(commitment_amount), 0) AS s
  FROM dm_funding_sources
  WHERE deal_id = (SELECT id FROM deals WHERE name ILIKE '%foxcroft%' LIMIT 1)
    AND kind NOT IN ('construction_loan', 'deferred_dev_fee')
)
UPDATE dm_funding_sources
SET commitment_amount = (SELECT u FROM net_uses) - (SELECT s FROM other_net_sources)
WHERE deal_id = (SELECT id FROM deals WHERE name ILIKE '%foxcroft%' LIMIT 1)
  AND kind = 'deferred_dev_fee'
RETURNING name, kind, commitment_amount;
-- After this, Net Sources to Project = Net Uses = $43,459,835.

-- ----- VERIFY: sources now balance to uses -----
WITH src AS (
  SELECT
    SUM(commitment_amount) AS gross,
    SUM(CASE WHEN kind = 'construction_loan' THEN commitment_amount ELSE 0 END) AS payoff
  FROM dm_funding_sources
  WHERE deal_id = (SELECT id FROM deals WHERE name ILIKE '%foxcroft%' LIMIT 1)
),
uses AS (
  SELECT SUM(revised_budget) AS net_uses
  FROM dm_draw_schedule_lines
  WHERE deal_id = (SELECT id FROM deals WHERE name ILIKE '%foxcroft%' LIMIT 1)
    AND format_id = '250bd7b0-acc0-4fef-8294-b5dc7e89a1ee'
    AND item_number < 10000
)
SELECT
  src.gross - src.payoff                       AS net_sources,
  uses.net_uses,
  (src.gross - src.payoff) - uses.net_uses     AS sources_minus_uses  -- expect 0.00
FROM src, uses;
