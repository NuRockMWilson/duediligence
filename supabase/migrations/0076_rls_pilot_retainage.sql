-- =============================================================================
-- Migration 0076 — RLS PILOT on dm_retainage_releases (Phase 9 r4)
-- =============================================================================
-- ⚠️ APPLY ONLY AFTER the diagnostic (Settings → Users & Access → RLS
--    Diagnostic) shows rls_ready = true. If auth.uid() does not resolve in the
--    app's session, this WILL block access to this table. Roll back instantly
--    with 0076_rollback.sql.
--
-- This is a deliberately SMALL blast radius: dm_retainage_releases is a newer,
-- low-traffic, devmgmt-only table. Enabling permission-scoped RLS here proves
-- the auth.uid()-keyed mechanism end-to-end (both reads and writes, in the
-- real app session) before rolling it out to core tables.
--
-- Policy shape (the template for the full rollout):
--   SELECT  → devmgmt 'view'  (or org admin)
--   WRITE   → devmgmt 'edit'  (or org admin)
-- Org admins are allowed through everywhere to match the r2 module gate.
-- =============================================================================

BEGIN;

-- Replace the PUBLIC policy with permission-scoped policies.
DROP POLICY IF EXISTS dm_retainage_releases_all ON dm_retainage_releases;

CREATE POLICY dm_retainage_releases_select ON dm_retainage_releases
  FOR SELECT
  USING (app_can('devmgmt', 'view') OR app_is_org_admin(auth.uid()));

CREATE POLICY dm_retainage_releases_write ON dm_retainage_releases
  FOR ALL
  USING (app_can('devmgmt', 'edit') OR app_is_org_admin(auth.uid()))
  WITH CHECK (app_can('devmgmt', 'edit') OR app_is_org_admin(auth.uid()));

COMMIT;
