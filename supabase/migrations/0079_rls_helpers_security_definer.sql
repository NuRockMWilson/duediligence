-- =============================================================================
-- Migration 0079 — make RBAC helpers SECURITY DEFINER (Access & Roles r4 fix)
-- =============================================================================
-- ⚠️ APPLY THIS BEFORE 0077.
--
-- 0077 puts RLS on app_user_roles. The policies (and the dm_ table policies)
-- call app_can / app_is_org_admin, which read app_user_roles — and once that
-- table is itself under RLS, those reads re-trigger the same policy, causing
-- Postgres "infinite recursion detected in policy for relation app_user_roles".
--
-- The fix is the standard RLS-helper pattern: define the permission functions
-- as SECURITY DEFINER (they run as the function owner / postgres, which bypasses
-- RLS) with a pinned search_path. They only READ the RBAC tables to compute a
-- boolean/set for a given uid, so this leaks nothing — and auth.uid() still
-- returns the CALLING user (it reads the request JWT, not the function role).
--
-- Idempotent CREATE OR REPLACE — bodies are unchanged from 0074/0075, only the
-- SECURITY DEFINER + search_path are added. Safe to apply on its own; it does
-- not change any RLS by itself.
-- =============================================================================

BEGIN;

-- Actions a user holds, per module.
CREATE OR REPLACE FUNCTION app_user_actions(p_uid uuid)
RETURNS TABLE(module text, action text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ur.module, rp.permission_key
  FROM app_user_roles ur
  JOIN app_role_permissions rp ON rp.role_key = ur.role_key
  WHERE ur.user_id = p_uid;
$$;

-- Does the user hold an action within a module?
CREATE OR REPLACE FUNCTION app_has_permission(p_uid uuid, p_module text, p_action text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM app_user_actions(p_uid) a
    WHERE a.module = p_module AND a.action = p_action
  );
$$;

-- Org admin = holds the admin role in any module.
CREATE OR REPLACE FUNCTION app_is_org_admin(p_uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM app_user_roles ur
    WHERE ur.user_id = p_uid AND ur.role_key = 'admin'
  );
$$;

-- Current user's permission within a module — the form RLS policies call.
CREATE OR REPLACE FUNCTION app_can(p_module text, p_action text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_has_permission(auth.uid(), p_module, p_action);
$$;

COMMIT;
