-- ============================================================================
-- INVITE CHAIN — STEP 3 OF 3. This is the one that closes it.
--
-- *** APPLIED BY THE OWNER 2026-08-21. Ran successfully. ***
-- *** THE SELF-INVITE ESCALATION IS CLOSED. Step 2 (app code) was deployed  ***
-- *** first, as required — devmgmt c0e7a0e / diligence b0ab253.             ***
-- ============================================================================
-- ORDER, AND THE ONE SEQUENCE THAT BREAKS ONBOARDING
-- ============================================================================
--   STEP 1  devmgmt 20260821_invite_chain_step1_minting_function.sql
--           adds create_app_invite(). Additive. Safe any time.
--   STEP 2  app code, devmgmt + diligence — both invite dialogs call that RPC.
--           SHIPPED with a 42883 fallback to the old direct write, so it is safe
--           to deploy before or after step 1.
--   STEP 3  this file. Revokes the client's direct write.
--
-- STEP 3 ASSUMES STEP 2 IS LIVE. Step 2's fallback exists precisely because a
-- missing function must not break onboarding — but once this file runs, that
-- fallback path can no longer succeed either, because the direct write it falls
-- back TO is exactly what this revokes. So if step 2 is not deployed, inviting a
-- user stops working the moment this runs.
-- CHECK FIRST: devmgmt and diligence /api/build-info must both report a commit
-- at or after step 2. That is what those routes are for.
--
-- ============================================================================
-- WHAT WAS OPEN, AND WHY THE POLICY THAT SHOULD HAVE STOPPED IT NEVER RAN
-- ============================================================================
-- MEASURED, both layers, on all four steps:
--   1. app_user_invites: policy app_user_invites_all is ALL / {public} /
--      true / true, and authenticated holds INSERT. So any signed-in user could
--      insert an invite naming their own address with every role set to 'admin'.
--   2. claim_pending_invite is granted to anon AND authenticated, and all three
--      apps call it on sign-in, so it is client-reachable.
--   3. It writes the invite row's TEXT COLUMNS straight into
--      app_user_roles.role_key. And because it is SECURITY DEFINER owned by
--      postgres, THE WRITE RUNS AS THE TABLE OWNER AND RLS DOES NOT APPLY — so
--      app_user_roles_wr, which correctly gates on app_is_org_admin, IS NEVER
--      EVALUATED. The one control that would refuse this is structurally out of
--      the path. Textbook confused deputy.
--   4. app_is_org_admin has no module predicate, so the result is org admin
--      everywhere.
--
-- THREE MODULES, NOT TWO. 0086 added diligence_role and redefined this function
-- to grant a third app_user_roles row. Confirmed live from the client: the
-- diligence team page renders DILIGENCE / DEVELOPMENT / UNDERWRITING columns and
-- its invite dialog offers all three selectors, which it would not if the column
-- and the branch did not exist. So one claim granted admin in all three.
--
-- WHAT 'admin' CONFERS, MEASURED from app_roles x app_role_permissions:
--   admin       approve, edit, export, manage_users, view
--   manager     approve, edit, export, view
--   contributor edit, view
--   viewer      view
-- manage_users is self-perpetuating — it is the permission behind the team UI —
-- so an escalated user could then re-role anyone. Full account takeover, two
-- steps, self-service for any signed-in colleague.
--
-- ============================================================================
-- THE FIX IS THE GRANT, NOT THE FUNCTION. The function hardening is the hedge.
-- ============================================================================
-- Revoking the client's write on app_user_invites is what actually closes this:
-- after it, the only way a row gets into that table is create_app_invite(), which
-- gates on app_is_org_admin and stamps invited_by from auth.uid(). The row stops
-- being attacker-authored, so everything downstream of it becomes trustworthy —
-- including granted_by, which needed no code change at all once the row is honest.
--
-- The refuse-to-escalate check below is DEFENCE IN DEPTH, and in normal use it
-- never fires. Established from source: when an admin re-invites someone who
-- ALREADY has an account, the invite handler calls applyModuleRole() and writes
-- app_user_roles directly, then marks the invite claimed — it does not go through
-- this function. So claim_pending_invite is ONBOARDING-ONLY in practice, and a
-- user being onboarded has no existing role to escalate from. The check exists for
-- the case nobody planned.
--
-- REFUSE-TO-ESCALATE, NOT REFUSE-TO-CHANGE. Two re-role surfaces exist in the UI:
-- the inline team-page dropdowns, and the invite dialog, whose own copy says "If
-- they already have an account, roles apply right away." Refusing any CHANGE would
-- break every downgrade through that dialog. A downgrade is never an escalation,
-- so blocking it buys no security — which is all refuse-to-change adds. Same
-- security, strictly fewer broken flows.
--
-- RANK, NOT A HARDCODED ORDER. app_roles carries `rank int NOT NULL` with higher
-- meaning more powerful (0074:36), so the comparison reads off the data. If a role
-- is ever added, this keeps working.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. THE ACTUAL FIX. Only create_app_invite() may write invites from now on.
-- ---------------------------------------------------------------------------
-- SELECT is deliberately left in place: the team page lists pending invites, and
-- that read is not the vector. (It does mean invite rows — emails and intended
-- roles — remain in the anon-readable set, which is the separate schema-wide
-- anon-SELECT item, not this one.)
REVOKE INSERT, UPDATE, DELETE ON public.app_user_invites FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.app_user_invites FROM anon;

-- ---------------------------------------------------------------------------
-- 2. Hardened redemption. Behaviour preserved except where noted.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_pending_invite()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_email   text := lower(auth.jwt() ->> 'email');
  v_inv     app_user_invites%ROWTYPE;
  v_mod     text;
  v_role    text;
BEGIN
  IF v_uid IS NULL OR v_email IS NULL THEN
    RETURN false;
  END IF;

  -- ORDER BY added. The original was `LIMIT 1` with no ordering, so with two
  -- pending invites for one address the pick was nondeterministic. Step 1's
  -- minting function keeps one row per address, which makes this moot — but a
  -- deterministic pick costs nothing and this function must be safe on its own.
  SELECT * INTO v_inv
  FROM app_user_invites
  WHERE lower(email) = v_email AND claimed_at IS NULL
  ORDER BY created_at DESC, id
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Directory row. Unchanged.
  INSERT INTO app_users (user_id, display_name, email, is_pm, is_cfo)
  VALUES (v_uid, COALESCE(v_inv.display_name, v_email), v_inv.email, false, false)
  ON CONFLICT (user_id) DO NOTHING;

  -- Per-module roles. WAS three near-identical blocks; now one loop over the
  -- three (module, role) pairs, so a fourth module cannot be added to two of
  -- them and forgotten in the third. That is not hypothetical — 0086 added the
  -- diligence branch here and the devmgmt invite dialog still does not surface a
  -- diligence role, so the surfaces are already out of step.
  FOR v_mod, v_role IN
    SELECT * FROM (VALUES
      ('devmgmt',      v_inv.devmgmt_role),
      ('underwriting', v_inv.underwriting_role),
      ('diligence',    v_inv.diligence_role)
    ) AS t(m, r)
    WHERE t.r IS NOT NULL
  LOOP
    -- The role must exist. The FK enforces this too, but a named error beats an
    -- FK violation surfacing to a user mid-sign-in.
    IF NOT EXISTS (SELECT 1 FROM app_roles WHERE key = v_role) THEN
      RAISE EXCEPTION 'Invite names an unknown role: % (module %)', v_role, v_mod;
    END IF;

    -- REFUSE TO ESCALATE. The conditional DO UPDATE is what makes this atomic —
    -- a read-then-write would race. If the incoming role outranks the one already
    -- held, the WHERE fails, no row changes, and redemption still returns true:
    -- the invite is consumed and the existing role stands. Silence is correct
    -- here rather than an error, because the alternative is failing a sign-in.
    INSERT INTO app_user_roles (user_id, module, role_key, granted_by)
    VALUES (v_uid, v_mod, v_role, v_inv.invited_by)
    ON CONFLICT (user_id, module) DO UPDATE
      SET role_key = EXCLUDED.role_key
      WHERE (SELECT rank FROM app_roles WHERE key = EXCLUDED.role_key)
         <= (SELECT rank FROM app_roles WHERE key = app_user_roles.role_key);
  END LOOP;

  UPDATE app_user_invites
  SET claimed_at = now(), claimed_user_id = v_uid
  WHERE id = v_inv.id;

  RETURN true;
END;
$$;

-- anon was granted EXECUTE by 0086. It cannot succeed — anon has no JWT email, so
-- v_email is null and the function returns false on the first branch — but a
-- function that writes app_user_roles has no business being callable without a
-- session. Removed rather than left as harmless.
REVOKE ALL ON FUNCTION public.claim_pending_invite() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_pending_invite() FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_pending_invite() TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================================
-- VERIFICATION
-- ============================================================================
-- 1. THE ESCALATION IS CLOSED. As a NON-ADMIN (Jordan), the self-mint must now
--    fail at the first step:
--
--      insert into app_user_invites (email, devmgmt_role, underwriting_role)
--      values ('jhyatt@nurock.com', 'admin', 'admin');
--
--    FALSIFYING OBSERVATION, STATED IN ADVANCE: a permission error is the PASS.
--    A success is a FAILURE and means the revoke did not take. A "0 rows" with no
--    error would mean RLS filtered it rather than the privilege refusing it —
--    weaker, and worth knowing, since a future policy change could undo it.
--
-- 2. INVITING STILL WORKS. This is the one that matters operationally: as
--    Michael, invite a test address from devmgmt AND from diligence. Both must
--    succeed through create_app_invite(). If either fails with "permission denied
--    for table app_user_invites", STEP 2 IS NOT DEPLOYED and this file should be
--    rolled back until it is.
--
-- 3. THE DILIGENCE ROLE STICKS. Invite from diligence with all three roles set,
--    then check the row. This is the direct falsifier for the module-dropping
--    defect in step 1's first draft:
--
--   select email, devmgmt_role, underwriting_role, diligence_role, invited_by
--     from app_user_invites where email = '<the test address>';
--
-- 4. RE-INVITING DOES NOT WIPE. Re-invite that address from DEVMGMT, whose dialog
--    does not send a diligence role, then re-run query 3. diligence_role must be
--    UNCHANGED. If it went null, step 1's absent-vs-clear handling is wrong.
--
-- 5. THE PRIVILEGES, both roles:
--
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_schema='public' and table_name='app_user_invites'
--      and grantee in ('anon','authenticated') order by 1,2;
--   -- expect SELECT only for both
--
-- 6. REDEMPTION STILL ONBOARDS. The real test needs a genuinely new account and
--    is Michael's call whether to run it. Short of that, confirm the function
--    still exists with the expected signature and that anon cannot execute it:
--
--   select has_function_privilege('anon','public.claim_pending_invite()','execute') as anon_exec,
--          has_function_privilege('authenticated','public.claim_pending_invite()','execute') as authd_exec;
--   -- expect f, t
--
-- ============================================================================
-- WHAT THIS DOES NOT CLOSE
-- ============================================================================
-- app_is_org_admin STILL HAS NO MODULE PREDICATE. After this, a non-admin can no
-- longer become org admin — but an admin of ONE module remains an admin of ALL,
-- which is a second escalation path through the same missing predicate and also
-- what lets a devmgmt-only admin rewrite the role-permission map. Latent today:
-- no user is admin of one module and not the others. It is the next fix and it is
-- one function.
--
-- The is_pm/is_cfo self-grant is separate and has its own migration
-- (devmgmt 20260821_lock_pm_cfo_flags.sql), still awaiting a run.
--
-- ============================================================================
-- ROLLBACK — restores the privileges AND the previous function body.
-- ============================================================================
-- BEGIN;
-- GRANT INSERT, UPDATE, DELETE ON public.app_user_invites TO authenticated;
-- -- and re-apply 0086_diligence_rbac_role.sql's CREATE OR REPLACE FUNCTION
-- -- claim_pending_invite() block verbatim to restore the prior behaviour.
-- NOTIFY pgrst, 'reload schema';
-- COMMIT;
--
-- NOTE: rolling back the grant alone is enough to restore onboarding if step 2
-- turns out not to be deployed. The function hardening is independent and does
-- not need reverting for that.
-- ============================================================================
