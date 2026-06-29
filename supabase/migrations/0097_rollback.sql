-- =============================================================================
-- Rollback for 0097 — drop Project Access + restore a non-blocking deals RLS
-- =============================================================================
-- Emergency revert. Drops the deal_access ACL and replaces the grant-aware
-- deals policies with the conservative "any signed-in user" policy from 0096,
-- so nothing is left blocked. (Run 0096_rollback.sql afterward only if you also
-- need to return to the original owner-scoped behavior.) Shared with devmgmt —
-- run once.
-- =============================================================================

BEGIN;

DROP TABLE IF EXISTS public.deal_access CASCADE;

ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE pol record; BEGIN
  FOR pol IN SELECT policyname FROM pg_policies
             WHERE schemaname='public' AND tablename='deals' LOOP
    EXECUTE format('DROP POLICY %I ON public.deals', pol.policyname);
  END LOOP; END $$;

CREATE POLICY deals_sel ON public.deals
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY deals_wr ON public.deals
  FOR ALL USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

COMMIT;
