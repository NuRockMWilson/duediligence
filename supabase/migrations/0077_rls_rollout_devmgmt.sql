-- =============================================================================
-- Migration 0077 — RLS rollout: devmgmt-only + RBAC tables (Phase 9 r4)
-- =============================================================================
-- ⚠️ PREREQUISITE: apply 0079_rls_helpers_security_definer.sql FIRST. Without
--    it, the app_user_roles policy below recurses (app_is_org_admin reads
--    app_user_roles under its own policy) → "infinite recursion detected in
--    policy". 0079 makes the helpers SECURITY DEFINER so they bypass RLS.
--
-- ⚠️ DO NOT APPLY until ALL are true:
--    1. The diagnostic shows rls_ready = true (auth.uid() resolves in-app), AND
--    2. The 0076 pilot has been applied and the app still reads/writes
--       retainage releases correctly, AND
--    3. 0079 (SECURITY DEFINER helpers) has been applied.
--    Keep 0077_rollback.sql open while testing; run it instantly if anything
--    breaks.
--
-- Scope (intentional): operational, devmgmt-only tables + the RBAC tables. It
-- DELIBERATELY EXCLUDES the cross-app core tables (deals, cost_account_map,
-- nurock_* schedule/format tables) — those are read/written by BOTH apps and
-- must be hardened individually with their own testing, not in a sweep.
--
-- Policy shape:
--   devmgmt tables → SELECT: devmgmt 'view'; WRITE: devmgmt 'edit'  (+org admin)
--   RBAC reference (app_roles/permissions/role_permissions) → SELECT: any
--     signed-in user; WRITE: org admin
--   app_user_roles → SELECT: own rows or org admin; WRITE: org admin
--
-- Each table's existing policies are dropped (whatever their names) and
-- replaced, so this is idempotent regardless of prior policy naming.
-- =============================================================================

BEGIN;

-- ---- devmgmt-only operational tables --------------------------------------
DO $$
DECLARE
  t text;
  pol record;
  devmgmt_tables text[] := ARRAY[
    'dm_invoices','dm_invoice_lines','dm_draws','dm_draw_lines',
    'dm_draw_schedule_lines','dm_funding_sources','dm_funding_source_tranches',
    'dm_vendors','dm_buildings','dm_lease_up_schedule','dm_milestones',
    'dm_change_orders','dm_change_order_lines','dm_lien_waivers',
    'dm_eligible_basis_overrides','dm_schedules','dm_report_schedule_lines',
    'dm_draw_line_allocations','dm_draw_status_history','dm_gl_mapping_overrides',
    'dm_schedule_line_to_standard','dm_underwriting_line_gl',
    'dm_cost_cert_allocations','dm_affiliates','dm_deal_formats'
  ];
BEGIN
  FOREACH t IN ARRAY devmgmt_tables LOOP
    -- Skip silently if the table doesn't exist in this environment.
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;

    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    FOR pol IN SELECT policyname FROM pg_policies
               WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY %I ON %I', pol.policyname, t);
    END LOOP;

    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT USING (app_can(''devmgmt'',''view'') OR app_is_org_admin(auth.uid()))',
      t || '_sel', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (app_can(''devmgmt'',''edit'') OR app_is_org_admin(auth.uid())) WITH CHECK (app_can(''devmgmt'',''edit'') OR app_is_org_admin(auth.uid()))',
      t || '_wr', t);
  END LOOP;
END;
$$;

-- ---- RBAC reference tables (readable by any signed-in user) ----------------
DO $$
DECLARE
  t text;
  pol record;
  ref_tables text[] := ARRAY['app_roles','app_permissions','app_role_permissions'];
BEGIN
  FOREACH t IN ARRAY ref_tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    FOR pol IN SELECT policyname FROM pg_policies
               WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY %I ON %I', pol.policyname, t);
    END LOOP;
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT USING (auth.uid() IS NOT NULL)', t || '_sel', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (app_is_org_admin(auth.uid())) WITH CHECK (app_is_org_admin(auth.uid()))', t || '_wr', t);
  END LOOP;
END;
$$;

-- ---- app_user_roles: users read their own; admins manage --------------------
ALTER TABLE app_user_roles ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies
             WHERE schemaname = 'public' AND tablename = 'app_user_roles' LOOP
    EXECUTE format('DROP POLICY %I ON app_user_roles', pol.policyname);
  END LOOP;
END;
$$;
CREATE POLICY app_user_roles_sel ON app_user_roles
  FOR SELECT USING (user_id = auth.uid() OR app_is_org_admin(auth.uid()));
CREATE POLICY app_user_roles_wr ON app_user_roles
  FOR ALL USING (app_is_org_admin(auth.uid())) WITH CHECK (app_is_org_admin(auth.uid()));

COMMIT;
