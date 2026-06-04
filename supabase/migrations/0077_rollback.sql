-- =============================================================================
-- ROLLBACK for 0077 — restore PUBLIC access on the rolled-out tables
-- =============================================================================
-- Run this immediately if the rollout blocks the app. Drops the permission-
-- scoped policies and restores a single PUBLIC (USING true) policy per table,
-- returning every table to the project's prior open state.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  t text;
  pol record;
  all_tables text[] := ARRAY[
    'dm_invoices','dm_invoice_lines','dm_draws','dm_draw_lines',
    'dm_draw_schedule_lines','dm_funding_sources','dm_funding_source_tranches',
    'dm_vendors','dm_buildings','dm_lease_up_schedule','dm_milestones',
    'dm_change_orders','dm_change_order_lines','dm_lien_waivers',
    'dm_eligible_basis_overrides','dm_schedules','dm_report_schedule_lines',
    'dm_draw_line_allocations','dm_draw_status_history','dm_gl_mapping_overrides',
    'dm_schedule_line_to_standard','dm_underwriting_line_gl',
    'dm_cost_cert_allocations','dm_affiliates','dm_deal_formats',
    'app_roles','app_permissions','app_role_permissions','app_user_roles'
  ];
BEGIN
  FOREACH t IN ARRAY all_tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    FOR pol IN SELECT policyname FROM pg_policies
               WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY %I ON %I', pol.policyname, t);
    END LOOP;
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (true) WITH CHECK (true)', t || '_all', t);
  END LOOP;
END;
$$;

COMMIT;
