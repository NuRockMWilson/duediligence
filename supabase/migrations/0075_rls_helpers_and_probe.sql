-- =============================================================================
-- Migration 0075 — RLS helpers + auth probe (Access & Roles, Phase 9 r4 prep)
-- =============================================================================
-- SAFE / ADDITIVE — changes NO row-level security. It only adds two helper
-- functions used by the (separate) RLS rollout and by an in-app diagnostic.
--
-- Why a probe first: this project's entire RLS surface is PUBLIC (USING true)
-- and a long-standing convention note warns "TO authenticated silently fails."
-- Before any restrictive, auth.uid()-keyed policy is enabled, we must confirm
-- the app's Postgres session actually resolves auth.uid() — otherwise the
-- policies deny everything and lock both apps out of their data.
--
-- app_auth_probe() runs as the CURRENT (invoking) user, so calling it via rpc
-- FROM THE APP (with the logged-in session) is the definitive test.
-- =============================================================================

BEGIN;

-- Current user's permission within a module — the form RLS policies call.
CREATE OR REPLACE FUNCTION app_can(p_module text, p_action text)
RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app_has_permission(auth.uid(), p_module, p_action);
$$;

-- Diagnostic: does the caller's session resolve a user + permissions?
-- Returns JSON so the app can render it. auth_uid NULL ⇒ RLS-by-user is NOT
-- safe to enable (the connection isn't carrying the user's JWT).
CREATE OR REPLACE FUNCTION app_auth_probe()
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'auth_uid',        auth.uid(),
    'auth_role',       auth.role(),
    'current_user',    current_user,
    'has_devmgmt_view', app_has_permission(auth.uid(), 'devmgmt', 'view'),
    'has_uw_view',      app_has_permission(auth.uid(), 'underwriting', 'view'),
    'is_org_admin',     app_is_org_admin(auth.uid()),
    'rls_ready',        auth.uid() IS NOT NULL
  );
$$;

COMMIT;
