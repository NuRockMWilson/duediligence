-- =============================================================================
-- ⚠️  SUPERSEDED — DO NOT RUN. Use migration 0071_realign_merge_in_place.sql.
-- =============================================================================
-- This Foxcroft-only fix has been replaced by migration 0071, which does the
-- same parked-row collapse for ALL deals (PART A) AND refactors the realign
-- function so the duplication can't recur (PART B). Running 0071 makes this
-- script a no-op (it finds no parked rows left). Kept only for historical
-- reference of how the bug was first isolated on Foxcroft.
-- =============================================================================
--
-- FIX — Foxcroft Cove draw-schedule duplicate-row reconciliation
-- =============================================================================
-- Paired with foxcroft-schedule-reconciliation.sql (the diagnostic).
--
-- Confirmed bug (from diagnostic Query B2):
--   Six dm_draw_schedule_lines rows for Foxcroft exist at BOTH a "live"
--   item_number (1–32) AND a "parked" item_number (10005…10026) because
--   the realign function's `MIGRATION 0067` parking logic preserved
--   FK-bearing parked rows that the next realign duplicated. The 6
--   parked rows total ~$5,482,415 — matches the $5,485,511 dev-mgmt
--   vs UW variance the CFO observed (within rounding).
--
--   Affected descriptions (live, parked):
--     Land/Seller Payments                       (26, 10026)  $3,600,000
--     Permits/Utility Conn. Fees/Impact Fee      ( 5, 10005)  $1,028,215
--     Legal Fees                                 (11, 10011)  $  363,000
--     Predevelopment Costs                       (17, 10017)  $  296,200
--     Title and Recording Insurance/Loan Repay   (15, 10015)  $  150,000
--     Property Taxes                             (13, 10013)  $   45,000
--
-- What this script does:
--   1. Verifies state before mutating (RAISE NOTICE).
--   2. For each parked row (item_number >= 10000), finds the matching
--      LIVE row by description.
--   3. Re-points any dm_draw_lines.draw_schedule_line_id from the parked
--      row to the live row so no draw-line data is lost.
--   4. Deletes the parked row.
--   5. Verifies state after — Total Uses should now equal UW TDC within
--      rounding ($43,459,835 ish).
--
-- Safety:
--   - Wrapped in a single BEGIN/COMMIT so a mid-flight failure rolls
--     back. Reads are emitted as NOTICE for audit.
--   - Idempotent — re-running after the fix has no effect (no rows
--     match item_number >= 10000 anymore).
--   - Does NOT touch the realign function. The duplicate root cause
--     is the realign's park-and-reinsert pattern preserving parked
--     rows that have FK refs; refactoring that is a separate task.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_foxcroft_id   TEXT;
  v_format_id     UUID := '250bd7b0-acc0-4fef-8294-b5dc7e89a1ee';
  v_total_before  NUMERIC;
  v_total_after   NUMERIC;
  v_parked_count  INT;
  v_repointed     INT := 0;
  v_deleted       INT := 0;
  rec             RECORD;
  v_live_id       UUID;
  v_n_lines       INT;
BEGIN
  SELECT id INTO v_foxcroft_id
  FROM deals WHERE name ILIKE '%foxcroft%' LIMIT 1;
  IF v_foxcroft_id IS NULL THEN
    RAISE EXCEPTION 'No Foxcroft deal found';
  END IF;
  RAISE NOTICE 'Foxcroft deal_id: %', v_foxcroft_id;

  -- ----- BEFORE state ------------------------------------------------------
  SELECT COALESCE(SUM(original_budget), 0)
    INTO v_total_before
  FROM dm_draw_schedule_lines
  WHERE deal_id = v_foxcroft_id AND format_id = v_format_id;

  SELECT COUNT(*)
    INTO v_parked_count
  FROM dm_draw_schedule_lines
  WHERE deal_id = v_foxcroft_id
    AND format_id = v_format_id
    AND item_number >= 10000;

  RAISE NOTICE '=== BEFORE ===';
  RAISE NOTICE '  Total original_budget: $%',
    to_char(v_total_before, 'FM999,999,999.00');
  RAISE NOTICE '  Parked rows (item_number >= 10000): %', v_parked_count;

  -- ----- For each parked row, find live twin + re-point dm_draw_lines -----
  FOR rec IN
    SELECT
      id           AS parked_id,
      item_number  AS parked_item,
      description,
      original_budget
    FROM dm_draw_schedule_lines
    WHERE deal_id = v_foxcroft_id
      AND format_id = v_format_id
      AND item_number >= 10000
    ORDER BY item_number
  LOOP
    -- Find the live twin (same description, item < 10000).
    SELECT id INTO v_live_id
    FROM dm_draw_schedule_lines
    WHERE deal_id = v_foxcroft_id
      AND format_id = v_format_id
      AND item_number < 10000
      AND LOWER(TRIM(description)) = LOWER(TRIM(rec.description))
    LIMIT 1;

    IF v_live_id IS NULL THEN
      RAISE WARNING '  parked %: "%" has no live twin — skipping',
        rec.parked_item, rec.description;
      CONTINUE;
    END IF;

    -- Count + repoint any draw_lines pointing at the parked row.
    SELECT COUNT(*) INTO v_n_lines
    FROM dm_draw_lines
    WHERE draw_schedule_line_id = rec.parked_id;

    IF v_n_lines > 0 THEN
      UPDATE dm_draw_lines
         SET draw_schedule_line_id = v_live_id
       WHERE draw_schedule_line_id = rec.parked_id;
      v_repointed := v_repointed + v_n_lines;
      RAISE NOTICE '  parked %: "%" — repointed % draw_lines → live row',
        rec.parked_item, rec.description, v_n_lines;
    ELSE
      RAISE NOTICE '  parked %: "%" — 0 draw_lines, clean delete',
        rec.parked_item, rec.description;
    END IF;

    -- Delete the parked row.
    DELETE FROM dm_draw_schedule_lines WHERE id = rec.parked_id;
    v_deleted := v_deleted + 1;
  END LOOP;

  -- ----- AFTER state -------------------------------------------------------
  SELECT COALESCE(SUM(original_budget), 0)
    INTO v_total_after
  FROM dm_draw_schedule_lines
  WHERE deal_id = v_foxcroft_id AND format_id = v_format_id;

  RAISE NOTICE '=== AFTER ===';
  RAISE NOTICE '  Total original_budget: $%',
    to_char(v_total_after, 'FM999,999,999.00');
  RAISE NOTICE '  Parked rows repointed: % draw_lines', v_repointed;
  RAISE NOTICE '  Parked rows deleted:   %', v_deleted;
  RAISE NOTICE '  Variance recovered:    $%',
    to_char(v_total_before - v_total_after, 'FM999,999,999.00');
  RAISE NOTICE '=== Compare to UW model TDC: $43,459,835.00 ===';

  -- Sanity check — sum should be close to UW TDC within rounding.
  IF ABS(v_total_after - 43459835.00) > 100.00 THEN
    RAISE WARNING 'AFTER total $% differs from UW TDC by more than $100 — review',
      to_char(v_total_after, 'FM999,999,999.00');
  END IF;
END;
$$;

-- ----- POST-CHECK queries (read-only, return rowsets) ---------------------

-- Should return ZERO rows (no more duplicates).
SELECT
  description,
  COUNT(*)                                    AS n_copies,
  array_agg(item_number ORDER BY item_number) AS at_item_numbers,
  SUM(original_budget)                        AS total_original
FROM dm_draw_schedule_lines
WHERE deal_id = (SELECT id FROM deals WHERE name ILIKE '%foxcroft%' LIMIT 1)
  AND format_id = '250bd7b0-acc0-4fef-8294-b5dc7e89a1ee'
GROUP BY description
HAVING COUNT(*) > 1
ORDER BY total_original DESC;

-- New total — compare to UW TDC $43,459,835.
SELECT
  COUNT(*)                          AS n_lines,
  SUM(original_budget)              AS total_original,
  SUM(revised_budget)               AS total_revised
FROM dm_draw_schedule_lines
WHERE deal_id = (SELECT id FROM deals WHERE name ILIKE '%foxcroft%' LIMIT 1)
  AND format_id = '250bd7b0-acc0-4fef-8294-b5dc7e89a1ee';

COMMIT;

-- =============================================================================
-- ROLLBACK INSTRUCTIONS
-- =============================================================================
-- If anything looks wrong AFTER running this, the script is wrapped in
-- BEGIN/COMMIT so a single error rolls everything back automatically.
-- If you want to roll back AFTER a successful run (because the numbers
-- don't match), there's no undo — the parked rows are gone. Restore from
-- a Supabase backup if needed. (The parked rows ARE just duplicates so
-- the data loss is purely the duplicate rows themselves; the draw_lines
-- now point at the live rows with identical descriptions.)
-- =============================================================================
