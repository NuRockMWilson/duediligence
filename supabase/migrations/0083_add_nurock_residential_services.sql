-- =============================================================================
-- Migration 0083 — add "NuRock Residential Services" org affiliate
-- =============================================================================
-- Adds NuRock Residential Services alongside NuRock Development / NuRock
-- Construction as an org-wide "Paid By" affiliate (deal_id NULL → available on
-- every deal) for tracking pre-development costs it fronts. Idempotent.
-- =============================================================================

BEGIN;

INSERT INTO dm_affiliates (name, is_active, sort_order)
SELECT 'NuRock Residential Services', true, 3
WHERE NOT EXISTS (
  SELECT 1 FROM dm_affiliates WHERE name = 'NuRock Residential Services'
);

COMMIT;
