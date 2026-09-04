-- ============================================================================
-- nurock_diligence_crosswalk — GRANTS, and a role-scoped policy
-- ============================================================================
-- Michael runs this. Nobody else. Run it AFTER 0082 (already applied
-- 2026-09-04). Safe to re-run.
--
-- ----------------------------------------------------------------------------
-- WHY 0082 ALONE IS NOT ENOUGH
-- ----------------------------------------------------------------------------
-- 0082 creates the table, enables RLS, and adds:
--     CREATE POLICY nurock_diligence_crosswalk_all ... FOR ALL USING (true)
-- and NO GRANT of any kind, and NO `NOTIFY pgrst, 'reload schema'`.
--
-- A POLICY NEVER CONFERS A PRIVILEGE. That is not a theory here — it is the
-- measured cause of the 2026-09-03 failure on nurock_diligence_items, where
-- every hard delete failed with "permission denied for table
-- nurock_diligence_items" as ORG ADMIN, because 0081 created exactly the same
-- FOR ALL USING (true) policy with no grant. RLS filters rows; a GRANT decides
-- whether the table is reachable at all.
--
-- So without this migration the crosswalk is likely to move from
--     "Could not find the table ... in the schema cache"     (0082 not applied)
-- to
--     "permission denied for table nurock_diligence_crosswalk"
-- which looks like a new bug and is the same one wearing a different message.
-- Whether it does depends on what Supabase's default privileges happen to grant
-- for newly created tables, which is not something the repo can tell you — and
-- "it depends on a default nobody wrote down" is precisely what this file
-- removes.
--
-- ----------------------------------------------------------------------------
-- AND THE PERMISSIVE POLICY IS NARROWED WHILE WE ARE HERE
-- ----------------------------------------------------------------------------
-- USING (true) means any authenticated session can read, insert, change and
-- DELETE crosswalk rows. Those rows decide COVERAGE: which canonical items
-- satisfy a financier's requirement, and therefore what a packet reports to a
-- lender. This program has spent weeks closing exactly this shape on
-- cost_account_map and gl_to_format_line; there is no reason to leave a third
-- open now that the table is finally live.
--
-- The write predicate MIRRORS assertDiligenceCan() in src/lib/auth/access.ts —
-- diligence role OR devmgmt role OR org admin — so the application and the
-- database agree. The app writes these rows under assertDiligenceCan("edit")
-- (addCrosswalkMapping / removeCrosswalkMapping / setCrosswalkMode), so keying
-- the policy to org-admin-only would make the app permit what the database then
-- refuses: the disagreement that broke forkFormatForDeal when gl_to_format_line
-- was first written admin-only.
--
-- READ STAYS WIDE. The crosswalk is read on the checklist, the financier
-- coverage cards, the packet exports and ensureDealItems. It holds no deal data
-- and no money — only which standard item satisfies which lender request. A
-- narrowed read does not present as a permission error; it presents as coverage
-- silently reading 0% across every packet, which is the failure this table has
-- just spent months demonstrating.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.nurock_diligence_crosswalk') IS NULL THEN
    RAISE EXCEPTION
      'ABORTING: public.nurock_diligence_crosswalk does not exist. Apply '
      '0082_diligence_crosswalk.sql first. Nothing was changed.';
  END IF;
  -- Both helpers are dependencies of the predicate below. 0079 defines them
  -- SECURITY DEFINER; a policy calling a non-definer helper recurses through
  -- app_user_roles' own policy ("infinite recursion detected").
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'app_can'
  ) THEN
    RAISE EXCEPTION
      'ABORTING: app_can() missing. Apply 0075 and 0079 first. Nothing changed.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'app_is_org_admin'
  ) THEN
    RAISE EXCEPTION
      'ABORTING: app_is_org_admin() missing. Apply 0079 first. Nothing changed.';
  END IF;
END $$;

ALTER TABLE public.nurock_diligence_crosswalk ENABLE ROW LEVEL SECURITY;

-- Drop by ENUMERATED name rather than guessing. Policies OR together, so a
-- leftover permissive one beside the new one makes the result as wide as the
-- widest — the trap that made cost_account_map's cleanup subtle.
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies
            WHERE schemaname = 'public'
              AND tablename = 'nurock_diligence_crosswalk'
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.nurock_diligence_crosswalk',
      p.policyname);
  END LOOP;
END $$;

CREATE POLICY nurock_diligence_crosswalk_sel
  ON public.nurock_diligence_crosswalk
  FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

-- USING and WITH CHECK identical, so an UPDATE cannot be half-permitted.
CREATE POLICY nurock_diligence_crosswalk_wr
  ON public.nurock_diligence_crosswalk
  FOR ALL TO authenticated
  USING (
    app_can('diligence', 'edit')
    OR app_can('devmgmt', 'edit')
    OR app_is_org_admin(auth.uid())
  )
  WITH CHECK (
    app_can('diligence', 'edit')
    OR app_can('devmgmt', 'edit')
    OR app_is_org_admin(auth.uid())
  );

-- TRUNCATE is a table privilege row security does not filter, so no policy
-- closes it. Revoke everything, then grant back explicitly and only the four.
-- DELETE *is* granted here, unlike nurock_diligence_items: removing a mapping is
-- a normal editing action (removeCrosswalkMapping), and a crosswalk row carries
-- no history worth preserving — it is a statement about which item satisfies
-- which, not a record of work done.
REVOKE ALL ON public.nurock_diligence_crosswalk FROM anon;
REVOKE ALL ON public.nurock_diligence_crosswalk FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.nurock_diligence_crosswalk TO authenticated;

COMMENT ON TABLE public.nurock_diligence_crosswalk IS
  'Many-to-many map from canonical NuRock checklist items to the items on an '
  'investor/lender packet. COVERAGE IS COMPUTED THROUGH THIS TABLE: a mapped '
  'packet item is satisfied when its canonical item(s) are approved, so one '
  'document attached once propagates to every packet that maps to it. Read by '
  'any signed-in user (four surfaces depend on it, and a narrowed read presents '
  'as 0% coverage rather than as an error); written under diligence:edit, '
  'devmgmt:edit or org admin, mirroring assertDiligenceCan so the app and the '
  'database cannot disagree. Before 2026-09-04 the table was ABSENT entirely and '
  'every app read swallowed the error, so an unreachable table was '
  'indistinguishable from an unmapped template.';

-- THE LINE 0082 WAS MISSING. Without it PostgREST keeps serving a schema cache
-- that has no such table, and the app goes on reporting "Could not find the
-- table ... in the schema cache" even though it now exists.
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================================
-- VERIFY (read-only). Run after COMMIT.
-- ============================================================================
-- 1. Exactly TWO policies, and NO bare `true` in the write predicate:
--
--   SELECT policyname, cmd, roles, qual, with_check FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'nurock_diligence_crosswalk'
--    ORDER BY policyname;
--
-- 2. Grants: authenticated holds exactly SELECT/INSERT/UPDATE/DELETE, anon holds
--    NOTHING, and neither holds TRUNCATE:
--
--   SELECT grantee, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
--     FROM information_schema.role_table_grants
--    WHERE table_schema = 'public' AND table_name = 'nurock_diligence_crosswalk'
--    GROUP BY grantee ORDER BY grantee;
--
-- 3. The table is empty, which is expected — it has never held a row:
--
--   SELECT count(*) AS crosswalk_rows FROM public.nurock_diligence_crosswalk;
--
-- 4. Then have the browser session create ONE mapping on
--    "TEST - Claude Review Sample Import". A real chip should render for the
--    first time in this program's history, and the fuzzy SUGGESTION for that
--    same canonical item should disappear, because
--    .filter((s) => !mapped.includes(s.id)) finally has something to filter.
-- ============================================================================
