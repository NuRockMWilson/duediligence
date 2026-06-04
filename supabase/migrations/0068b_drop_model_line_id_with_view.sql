-- =============================================================================
-- Migration 0068b — Drop dm_gl_to_schedule_map view's dependency on
--                   cost_account_map.model_line_id, then drop the column.
-- =============================================================================
-- Supersedes 0068, which failed with:
--   ERROR: 2BP01 cannot drop column model_line_id of table cost_account_map
--   because other objects depend on it
--   DETAIL: view dm_gl_to_schedule_map depends on column model_line_id ...
--
-- The dm_gl_to_schedule_map view was originally derived from
-- cost_account_map.model_line_id joined to dm_draw_schedule_lines via the
-- schedule line's metadata->>'source_line_id'. After Phase 7.1.1 the canonical
-- source of UL→GL mappings is dm_underwriting_line_gl (many-to-one). The view
-- needs to be rewritten to read from there.
--
-- Strategy: DROP the view, recreate it with the new JOIN, then ALTER TABLE
-- DROP COLUMN. Same column shape (deal_id, draw_schedule_line_id, gl_account,
-- notes, schedule_id) so consumers in src/app/.../page.tsx and
-- src/app/.../actions.ts continue to work without code change.
--
-- Note: the new view may return MORE rows for GLs that had multiple ULs
-- mapped to the same GL (the legacy column was 1:1 — last write wins). This
-- is a strict correctness improvement; downstream readers already handle
-- many-to-one (active draw rollup, schedule rollup, etc.).
-- =============================================================================

BEGIN;

-- 1. Pre-flight: warn if a row will be lost
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
    RAISE NOTICE 'WARNING: % cost_account_map rows have model_line_id values not present in dm_underwriting_line_gl — these mappings will be lost on drop. Review before applying.', v_orphan_count;
  ELSE
    RAISE NOTICE 'OK: every model_line_id value is also present in dm_underwriting_line_gl. Safe to drop.';
  END IF;
END;
$$;

-- 2. Drop the view that depends on the column
DROP VIEW IF EXISTS dm_gl_to_schedule_map;

-- 3. Drop the column
ALTER TABLE cost_account_map DROP COLUMN IF EXISTS model_line_id;

-- 4. Recreate the view using dm_underwriting_line_gl as the join basis.
-- Same column shape consumers already use:
--   gl_account, draw_schedule_line_id, deal_id, schedule_id, notes
-- DISTINCT keeps the row count sensible if multiple ULs map to one GL
-- and target the same draw_schedule_line (rare but possible).
CREATE OR REPLACE VIEW dm_gl_to_schedule_map AS
SELECT DISTINCT
  ulg.gl_account,
  dsl.id           AS draw_schedule_line_id,
  dsl.deal_id,
  dsl.schedule_id,
  dsl.notes
FROM dm_underwriting_line_gl ulg
JOIN dm_draw_schedule_lines dsl
  ON dsl.metadata->>'source_line_id' = ulg.source_line_id;

-- 5. Public RLS — the original view was likely accessible via PostgREST.
-- Views inherit RLS from their underlying tables in Supabase, but PostgREST
-- still needs the role GRANT to expose the view via the data API.
GRANT SELECT ON dm_gl_to_schedule_map TO anon, authenticated, service_role;

COMMIT;

-- =============================================================================
-- Rollback (NOT run automatically — copy/paste into psql if needed)
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
--       dsl.notes
--     FROM cost_account_map cam
--     JOIN dm_draw_schedule_lines dsl
--       ON dsl.metadata->>'source_line_id' = cam.model_line_id;
--   GRANT SELECT ON dm_gl_to_schedule_map TO anon, authenticated, service_role;
-- COMMIT;
