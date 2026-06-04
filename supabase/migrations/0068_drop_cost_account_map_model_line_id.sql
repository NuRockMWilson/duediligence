-- =============================================================================
-- Migration 0068 — Drop legacy cost_account_map.model_line_id column
-- =============================================================================
-- Background:
--   `cost_account_map.model_line_id` was a 1:1 column mapping each GL to a
--   single underwriting line. It was superseded by `dm_underwriting_line_gl`
--   (many-to-one: many UW lines can share a GL) but kept as a parallel-write
--   shadow column "for legacy readers."
--
-- Audit of code as of Phase 1 platform consolidation:
--   - All readers (budget-actuals.ts, invoices/page.tsx, invoices-shell.tsx)
--     selected the column but never USED it downstream — purely carried as
--     metadata that no consumer read.
--   - The lone writer (schedule/edit/actions.ts upsertGlMapping/deleteGl-
--     Mapping) wrote it in parallel to the canonical dm_underwriting_line_gl
--     write.
--
--   All three readers + both writes are removed in the application-code
--   commit that ships with this migration. With nothing reading or writing
--   it anymore, the column is safe to drop.
--
-- Why drop rather than leave it:
--   - Eliminates a 1:1 view of a many-to-one relationship (was strictly broken
--     when multiple ULs mapped to one GL — "last write wins" silently lost
--     data on the legacy column).
--   - Removes the temptation to read/write it again in future code.
--   - Removes the parallel-write footgun (forget to update both → silent
--     drift between canonical + legacy state).
--
-- Reversibility:
--   - This column held only derived data (always equal to one of the
--     dm_underwriting_line_gl.source_line_ids for the matching gl_account).
--   - If reverted, the column can be rebuilt from dm_underwriting_line_gl
--     via a single UPDATE … FROM … (see commented rollback at the bottom).
-- =============================================================================

BEGIN;

-- Sanity check — make sure no row in cost_account_map has model_line_id
-- that's NOT also present in dm_underwriting_line_gl. If it is, we'd lose
-- data on the drop. Raises a clear notice rather than failing silently.
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

ALTER TABLE cost_account_map DROP COLUMN IF EXISTS model_line_id;

COMMIT;

-- ============================================================================
-- Rollback (NOT run automatically — copy/paste into psql if needed)
-- ============================================================================
-- BEGIN;
-- ALTER TABLE cost_account_map ADD COLUMN model_line_id text;
-- UPDATE cost_account_map cam
--    SET model_line_id = (
--      SELECT source_line_id FROM dm_underwriting_line_gl ulg
--       WHERE ulg.gl_account = cam.gl_account
--       LIMIT 1  -- arbitrary pick when many-to-one
--    );
-- COMMIT;
