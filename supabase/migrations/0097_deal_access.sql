-- =============================================================================
-- Migration 0097 — Project Access (per-deal access grants) + grant-aware deals RLS
-- =============================================================================
-- Adds an explicit access-control list for deals so an org admin can grant
-- specific users access to specific projects from Settings → Users & Access
-- ("Project Access" section). Replaces the all-or-nothing options that came
-- before:
--   • 001_init owner-VALUE policy (each user sees only their own rows) — the
--     reason teammates currently see nothing but a locally-seeded Foxcroft shell.
--   • 0096 "any signed-in user sees ALL deals" — too coarse; never applied.
--
-- SHARED MIGRATION: this is identical to nurock-devmgmt's 0097 (same shared
-- Supabase project, the same way 0074–0079 are mirrored across both repos). Run
-- it ONCE from either app — it is idempotent, so re-running the twin is a no-op.
--
-- MODEL
--   A user may SEE / EDIT a deal if they OWN it, are an ORG ADMIN, or have a
--   row in deal_access for it. DELETE stays owner/admin only. The module role
--   (viewer / contributor / manager) still governs WHAT they can do, enforced
--   at the app layer — this policy only governs WHICH deals are reachable.
--
-- SAFE TO APPLY: uses owner_id + app_is_org_admin() (SECURITY DEFINER, 0079) +
-- a deal_access EXISTS check (deal_access self-read RLS resolves it). It does
-- NOT use app_can(), so it avoids the UW-client save path 0096 flagged — a
-- deal's owner always passes via the owner_id check.
--
-- ⚠️ Requires the RLS Diagnostic (Settings → Users & Access) to show
--    rls_ready = true (auth.uid() resolves in-app). Keep 0097_rollback.sql handy.
-- =============================================================================

BEGIN;

-- 1) The grant list ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.deal_access (
  deal_id    text NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_by uuid,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (deal_id, user_id)
);
CREATE INDEX IF NOT EXISTS deal_access_user_idx ON public.deal_access (user_id);

ALTER TABLE public.deal_access ENABLE ROW LEVEL SECURITY;

-- Idempotent: drop any prior deal_access policies.
DO $$ DECLARE pol record; BEGIN
  FOR pol IN SELECT policyname FROM pg_policies
             WHERE schemaname='public' AND tablename='deal_access' LOOP
    EXECUTE format('DROP POLICY %I ON public.deal_access', pol.policyname);
  END LOOP; END $$;

-- Org admins manage all grants; a user may read their OWN grant rows (so the
-- EXISTS check in the deals policy below resolves for them — no recursion: this
-- never reads `deals`).
CREATE POLICY deal_access_admin ON public.deal_access
  FOR ALL USING (app_is_org_admin(auth.uid()))
  WITH CHECK (app_is_org_admin(auth.uid()));
CREATE POLICY deal_access_self_read ON public.deal_access
  FOR SELECT USING (user_id = auth.uid());

-- 2) Grant-aware deals RLS ----------------------------------------------------
ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;

-- Idempotent: drop whatever policies currently exist (001_init owner set, the
-- 0096 names, or any prior naming).
DO $$ DECLARE pol record; BEGIN
  FOR pol IN SELECT policyname FROM pg_policies
             WHERE schemaname='public' AND tablename='deals' LOOP
    EXECUTE format('DROP POLICY %I ON public.deals', pol.policyname);
  END LOOP; END $$;

-- Reusable predicate: caller owns the deal, is an org admin, or is granted.
--   owner_id is stored as the auth UID in text form (matches auth.uid()::text).
CREATE POLICY deals_select ON public.deals
  FOR SELECT USING (
    owner_id = auth.uid()::text
    OR app_is_org_admin(auth.uid())
    OR EXISTS (SELECT 1 FROM public.deal_access da
               WHERE da.deal_id = deals.id AND da.user_id = auth.uid())
  );

-- New deals: you create your own (owner = you); admins may create for anyone.
CREATE POLICY deals_insert ON public.deals
  FOR INSERT WITH CHECK (
    owner_id = auth.uid()::text OR app_is_org_admin(auth.uid())
  );

-- Edits: owner, admin, or a granted collaborator (their module role gates the
-- actual edit/approve actions at the app layer).
CREATE POLICY deals_update ON public.deals
  FOR UPDATE USING (
    owner_id = auth.uid()::text
    OR app_is_org_admin(auth.uid())
    OR EXISTS (SELECT 1 FROM public.deal_access da
               WHERE da.deal_id = deals.id AND da.user_id = auth.uid())
  )
  WITH CHECK (
    owner_id = auth.uid()::text
    OR app_is_org_admin(auth.uid())
    OR EXISTS (SELECT 1 FROM public.deal_access da
               WHERE da.deal_id = deals.id AND da.user_id = auth.uid())
  );

-- Deleting a whole deal stays owner/admin only — a granted collaborator can't.
CREATE POLICY deals_delete ON public.deals
  FOR DELETE USING (
    owner_id = auth.uid()::text OR app_is_org_admin(auth.uid())
  );

COMMIT;
