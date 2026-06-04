-- =============================================================================
-- ROLLBACK for 0076 — restore PUBLIC access on dm_retainage_releases
-- =============================================================================
-- Run this immediately if the pilot RLS blocks the app (e.g. the diagnostic
-- was wrong / auth.uid() doesn't resolve in some path). Restores the original
-- PUBLIC policy so the table is fully accessible again.
-- =============================================================================

BEGIN;

DROP POLICY IF EXISTS dm_retainage_releases_select ON dm_retainage_releases;
DROP POLICY IF EXISTS dm_retainage_releases_write ON dm_retainage_releases;

DROP POLICY IF EXISTS dm_retainage_releases_all ON dm_retainage_releases;
CREATE POLICY dm_retainage_releases_all
  ON dm_retainage_releases
  FOR ALL
  USING (true)
  WITH CHECK (true);

COMMIT;
