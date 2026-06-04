-- =============================================================================
-- Migration 0078 — Invite-by-email + auto-link on login (Access & Roles r5)
-- =============================================================================
-- Removes the "copy the auth UUID from the dashboard" step. An admin invites a
-- person by EMAIL + per-module roles; the invite is claimed automatically the
-- first time that email signs in (any module), creating their directory row +
-- role assignments.
--
-- claim_pending_invite() is SECURITY DEFINER so it can write app_users /
-- app_user_roles even under future RLS — but it only ever acts on the CALLER'S
-- OWN authenticated email (auth.jwt() ->> 'email'), so a user can't claim
-- someone else's invite.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS app_user_invites (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             text NOT NULL UNIQUE,           -- stored lowercased
  display_name      text,
  devmgmt_role      text REFERENCES app_roles(key),     -- null = no access
  underwriting_role text REFERENCES app_roles(key),     -- null = no access
  invited_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  claimed_at        timestamptz,
  claimed_user_id   uuid
);

ALTER TABLE app_user_invites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_user_invites_all ON app_user_invites;
CREATE POLICY app_user_invites_all ON app_user_invites
  FOR ALL USING (true) WITH CHECK (true);

-- ---- Claim: link the signed-in caller to their pending invite --------------
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

  UPDATE app_user_invites
  SET claimed_at = now(), claimed_user_id = v_uid
  WHERE id = v_inv.id;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION claim_pending_invite() TO anon, authenticated;

COMMIT;
