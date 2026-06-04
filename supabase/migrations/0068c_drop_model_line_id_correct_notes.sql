-- =============================================================================
-- Migration 0068c — Drop model_line_id, correctly recreate dm_gl_to_schedule_map
-- =============================================================================
-- Supersedes 0068b, which failed with:
--   ERROR: 42703 column dsl.notes does not exist
--
-- My 0068b assumed `notes` came from dm_draw_schedule_lines. It actually
-- comes from cost_account_map. The legacy view's column was:
--   cam.notes  (chart-of-accounts annotation per GL)
-- not
--   dsl.notes  (which doesn't exist).
--
-- 0068b ran inside BEGIN/COMMIT, so the failure rolled back the entire
-- transaction. The model_line_id column was NOT dropped, and the view was
-- NOT changed. State is exactly as before 0068b ran.
--
-- This migration:
--   1. DROPs the view (depends on model_line_id)
--   2. DROPs the model_line_id column
--   3. CREATEs the new view using dm_underwriting_line_gl as the UL→GL
--      mapping source, LEFT JOIN cost_account_map for cam.notes
--   4. GRANTs read access
--
-- The LEFT JOIN to cost_account_map is intentional: a GL listed in
-- dm_underwriting_line_gl should appear in the view even if cost_account_map
-- doesn't have an annotation row (notes is null in that case).
-- =============================================================================

BEGIN;

-- 1. Pre-flight sanity check (re-run from 0068b — still valid)
DO $$
DECLARE
  v_orphan_count INT;
BEGIN
  SELECT COUNT(*)
    INTO v_orphan_count
    FROM cost_account_map cam
   WHERE cam.model_line_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM dm_underwriting_line_gl ulg
        WHERE ulg.source_line_id = cam.model_line_id
          AND ulg.gl_account = cam.gl_account
     );
  IF v_orphan_count > 0 THEN
    RAISE NOTICE 'WARNING: % cost_account_map rows have model_line_id values not in dm_underwriting_line_gl — these mappings will be lost on drop. Review before applying.', v_orphan_count;
  ELSE
    RAISE NOTICE 'OK: every model_line_id is also in dm_underwriting_line_gl. Safe to drop.';
  END IF;
END;
$$;

-- 2. Drop the view (depends on model_line_id)
DROP VIEW IF EXISTS dm_gl_to_schedule_map;

-- 3. Drop the column
ALTER TABLE cost_account_map DROP COLUMN IF EXISTS model_line_id;

-- 4. Recreate the view with the correct column sources.
-- Shape matches what consumers SELECT and what database.types.ts encodes:
--   gl_account, draw_schedule_line_id, deal_id, schedule_id, notes
CREATE OR REPLACE VIEW dm_gl_to_schedule_map AS
SELECT DISTINCT
  ulg.gl_account,
  dsl.id           AS draw_schedule_line_id,
  dsl.deal_id,
  dsl.schedule_id,
  cam.notes
FROM dm_underwriting_line_gl ulg
JOIN dm_draw_schedule_lines dsl
  ON dsl.metadata->>'source_line_id' = ulg.source_line_id
LEFT JOIN cost_account_map cam
  ON cam.gl_account = ulg.gl_account;

-- 5. Public access (Supabase PostgREST exposure)
GRANT SELECT ON dm_gl_to_schedule_map TO anon, authenticated, service_role;

COMMIT;

-- =============================================================================
-- Verification (run as separate statement after the BEGIN/COMMIT above)
-- =============================================================================
--   SELECT COUNT(*) FROM dm_gl_to_schedule_map;  -- expect > 0 if any UL→GL maps exist
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name = 'cost_account_map' AND column_name = 'model_line_id';
--   -- Expect 0 rows (column dropped)
--
-- =============================================================================
-- Rollback (NOT run automatically)
-- =============================================================================
-- BEGIN;
--   DROP VIEW IF EXISTS dm_gl_to_schedule_map;
--   ALTER TABLE cost_account_map ADD COLUMN model_line_id text;
--   UPDATE cost_account_map cam
--      SET model_line_id = (
--        SELECT source_line_id FROM dm_underwriting_line_gl ulg
--         WHERE ulg.gl_account = cam.gl_account
--         LIMIT 1
--      );
--   CREATE OR REPLACE VIEW dm_gl_to_schedule_map AS
--     SELECT DISTINCT
--       cam.gl_account,
--       dsl.id AS draw_schedule_line_id,
--       dsl.deal_id,
--       dsl.schedule_id,
--       cam.notes
--     FROM cost_account_map cam
--     JOIN dm_draw_schedule_lines dsl
--       ON dsl.metadata->>'source_line_id' = cam.model_line_id;
--   GRANT SELECT ON dm_gl_to_schedule_map TO anon, authenticated, service_role;
-- COMMIT;
