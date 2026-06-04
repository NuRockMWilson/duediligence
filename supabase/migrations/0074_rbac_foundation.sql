-- =============================================================================
-- Migration 0074 — RBAC foundation (Access & Roles, Phase 9 r1)
-- =============================================================================
-- Org-wide, CROSS-APP role-based access control in the shared Supabase project.
-- Both nurock-devmgmt and nurock-underwriting read these tables; auth.users is
-- shared, so a user is one identity across modules.
--
-- Model:
--   - app_permissions   : the fine-grained ACTION catalog (view/edit/approve/…)
--   - app_roles         : named tiers (admin/manager/contributor/viewer)
--   - app_role_permissions : which actions each role bundles
--   - app_user_roles    : a user's role WITHIN a module (per-module assignment)
--
-- Effective access = for each module the user has a role in, the set of actions
-- that role bundles. Exposed via SQL functions so the app layer (now) and RLS
-- (later) share one source of truth.
--
-- Enforcement is app-layer for now (guards + UI). These tables keep the
-- project's PUBLIC RLS convention; the Users & Access admin gates writes.
-- =============================================================================

BEGIN;

-- ---- Action catalog --------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_permissions (
  key         text PRIMARY KEY,        -- 'view' | 'edit' | 'approve' | 'export' | 'manage_users'
  label       text NOT NULL,
  description text,
  sort_order  int NOT NULL DEFAULT 0
);

-- ---- Role catalog ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_roles (
  key         text PRIMARY KEY,        -- 'admin' | 'manager' | 'contributor' | 'viewer'
  label       text NOT NULL,
  rank        int NOT NULL,            -- higher = more powerful
  description text
);

-- ---- Role → action bundles -------------------------------------------------
CREATE TABLE IF NOT EXISTS app_role_permissions (
  role_key       text NOT NULL REFERENCES app_roles(key) ON DELETE CASCADE,
  permission_key text NOT NULL REFERENCES app_permissions(key) ON DELETE CASCADE,
  PRIMARY KEY (role_key, permission_key)
);

-- ---- Per-module user role assignment ---------------------------------------
CREATE TABLE IF NOT EXISTS app_user_roles (
  user_id    uuid NOT NULL,            -- auth.users.id (= app_users.user_id)
  module     text NOT NULL,            -- 'underwriting' | 'devmgmt'
  role_key   text NOT NULL REFERENCES app_roles(key),
  granted_by uuid,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, module)
);
CREATE INDEX IF NOT EXISTS idx_app_user_roles_user ON app_user_roles(user_id);

-- ---- Seed: actions ---------------------------------------------------------
INSERT INTO app_permissions (key, label, description, sort_order) VALUES
  ('view',         'View',          'Read access to the module',                     10),
  ('edit',         'Edit',          'Create and edit records',                       20),
  ('approve',      'Approve',       'Approve draws, change orders, and submissions',  30),
  ('export',       'Export',        'Generate exports, reports, and packages',        40),
  ('manage_users', 'Manage Users',  'Invite users and assign roles (org admin)',      50)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label, description = EXCLUDED.description, sort_order = EXCLUDED.sort_order;

-- ---- Seed: roles -----------------------------------------------------------
INSERT INTO app_roles (key, label, rank, description) VALUES
  ('admin',       'Admin',       40, 'Full access plus user & role management'),
  ('manager',     'Manager',     30, 'Edit, approve, and export'),
  ('contributor', 'Contributor', 20, 'Create and edit; cannot approve'),
  ('viewer',      'Viewer',      10, 'Read-only')
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label, rank = EXCLUDED.rank, description = EXCLUDED.description;

-- ---- Seed: role → action bundles ------------------------------------------
-- Rebuild cleanly so re-running the migration reflects the latest mapping.
DELETE FROM app_role_permissions;
INSERT INTO app_role_permissions (role_key, permission_key) VALUES
  ('viewer',      'view'),
  ('contributor', 'view'), ('contributor', 'edit'),
  ('manager',     'view'), ('manager', 'edit'), ('manager', 'approve'), ('manager', 'export'),
  ('admin',       'view'), ('admin', 'edit'), ('admin', 'approve'), ('admin', 'export'), ('admin', 'manage_users');

-- ---- Permission functions (shared by app + future RLS) ---------------------
-- Actions a user holds, per module.
CREATE OR REPLACE FUNCTION app_user_actions(p_uid uuid)
RETURNS TABLE(module text, action text)
LANGUAGE sql STABLE AS $$
  SELECT ur.module, rp.permission_key
  FROM app_user_roles ur
  JOIN app_role_permissions rp ON rp.role_key = ur.role_key
  WHERE ur.user_id = p_uid;
$$;

-- Does the user hold an action within a module?
CREATE OR REPLACE FUNCTION app_has_permission(p_uid uuid, p_module text, p_action text)
RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM app_user_actions(p_uid) a
    WHERE a.module = p_module AND a.action = p_action
  );
$$;

-- Org admin = holds the admin role in any module (can manage users).
CREATE OR REPLACE FUNCTION app_is_org_admin(p_uid uuid)
RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM app_user_roles ur
    WHERE ur.user_id = p_uid AND ur.role_key = 'admin'
  );
$$;

-- ---- RLS (PUBLIC per project convention; app layer gates writes) -----------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['app_permissions','app_roles','app_role_permissions','app_user_roles']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_all ON %I', t, t);
    EXECUTE format('CREATE POLICY %I_all ON %I FOR ALL USING (true) WITH CHECK (true)', t, t);
  END LOOP;
END;
$$;

-- ---- Backfill from existing app_users role flags ---------------------------
-- CFOs (owners) become admin in BOTH modules so enabling enforcement can never
-- lock the owner out of either app. PMs become devmgmt managers. Everyone else
-- on the team gets devmgmt viewer. Existing assignments are left untouched.
INSERT INTO app_user_roles (user_id, module, role_key, granted_by)
SELECT user_id, m.module,
       CASE
         WHEN is_cfo THEN 'admin'
         WHEN is_pm AND m.module = 'devmgmt' THEN 'manager'
         ELSE 'viewer'
       END,
       user_id
FROM app_users
CROSS JOIN (VALUES ('devmgmt'), ('underwriting')) AS m(module)
-- Only seed underwriting for CFOs (others get devmgmt-only until assigned).
WHERE m.module = 'devmgmt' OR is_cfo
ON CONFLICT (user_id, module) DO NOTHING;

COMMIT;
