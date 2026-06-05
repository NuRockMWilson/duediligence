-- =============================================================================
-- Migration 0086 — Dedicated "diligence" RBAC module/role
-- =============================================================================
-- Lets finance-team members get access to the standalone diligence app WITHOUT
-- a Development (devmgmt) role. RBAC modules are free-text in app_user_roles, so
-- granting a 'diligence' role needs no schema change for existing users — this
-- migration only extends the INVITE flow so admins can invite finance staff
-- straight into a diligence role (claimed on first sign-in).
--
-- The diligence app's access gate accepts EITHER 'diligence' OR 'devmgmt' (see
-- src/app/(app)/layout.tsx), so this is additive and never locks anyone out.
-- Shared DB: dev-mgmt's invite flow ignores the new column (stays null).
-- =============================================================================

BEGIN;

ALTER TABLE app_user_invites
  ADD COLUMN IF NOT EXISTS diligence_role text REFERENCES app_roles(key);

-- Recreate the claim function to also apply a pending diligence role.
CREATE OR REPLACE FUNCTION claim_pending_invite()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_email text := lower(auth.jwt() ->> 'email');
  v_inv   app_user_invites%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR v_email IS NULL THEN
    RETURN false;
  END IF;

  SELECT * INTO v_inv
  FROM app_user_invites
  WHERE lower(email) = v_email AND claimed_at IS NULL
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Directory row.
  INSERT INTO app_users (user_id, display_name, email, is_pm, is_cfo)
  VALUES (v_uid, COALESCE(v_inv.display_name, v_email), v_inv.email, false, false)
  ON CONFLICT (user_id) DO NOTHING;

  -- Per-module roles.
  IF v_inv.devmgmt_role IS NOT NULL THEN
    INSERT INTO app_user_roles (user_id, module, role_key, granted_by)
    VALUES (v_uid, 'devmgmt', v_inv.devmgmt_role, v_inv.invited_by)
    ON CONFLICT (user_id, module) DO UPDATE SET role_key = EXCLUDED.role_key;
  END IF;
  IF v_inv.underwriting_role IS NOT NULL THEN
    INSERT INTO app_user_roles (user_id, module, role_key, granted_by)
    VALUES (v_uid, 'underwriting', v_inv.underwriting_role, v_inv.invited_by)
    ON CONFLICT (user_id, module) DO UPDATE SET role_key = EXCLUDED.role_key;
  END IF;
  IF v_inv.diligence_role IS NOT NULL THEN
    INSERT INTO app_user_roles (user_id, module, role_key, granted_by)
    VALUES (v_uid, 'diligence', v_inv.diligence_role, v_inv.invited_by)
    ON CONFLICT (user_id, module) DO UPDATE SET role_key = EXCLUDED.role_key;
  END IF;

  UPDATE app_user_invites
  SET claimed_at = now(), claimed_user_id = v_uid
  WHERE id = v_inv.id;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION claim_pending_invite() TO anon, authenticated;

COMMIT;
