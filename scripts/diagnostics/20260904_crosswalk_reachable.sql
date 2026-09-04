-- ============================================================================
-- IS nurock_diligence_crosswalk REACHABLE? Settling three readings of one error.
-- ============================================================================
-- READ-ONLY. No fixtures, no writes, no plpgsql. Michael runs this.
--
-- THE SYMPTOM, measured live 2026-09-04. Creating a crosswalk mapping from the
-- template drawer produced exactly one request and one toast:
--
--     Could not find the table 'public.nurock_diligence_crosswalk'
--     in the schema cache
--
-- That is PostgREST's phrasing and the live session correctly refused to guess
-- between three causes it cannot distinguish from a browser:
--     (a) the table genuinely does not exist       -> 0082 was never applied
--     (b) it exists, PostgREST's cache is stale    -> needs NOTIFY pgrst
--     (c) it exists in a schema PostgREST cannot see
--
-- Read `verdict` on row 1. It says which.
--
-- WHY IT WENT UNNOTICED FOR MONTHS, and this is the part that matters more than
-- the fix: every READ of this table in the app destructured only `data` and
-- ignored `error`. So an UNREACHABLE table was indistinguishable from a table
-- with no rows — the drawer showed no mapped chips, which is exactly what a
-- genuinely unmapped template looks like. Three rounds of live investigation
-- concluded "there are simply no mappings". Those reads now log the error
-- (0e2c9d7 and this commit), and ensureDealItems refuses to decide packet scope
-- from a failed read.
-- ============================================================================

SELECT * FROM (

  SELECT 1 AS seq,
         'crosswalk table exists in public' AS check_name,
         CASE
           WHEN to_regclass('public.nurock_diligence_crosswalk') IS NOT NULL
             THEN 'EXISTS — so the cause is (b) a stale PostgREST cache or (c) exposure. Run: NOTIFY pgrst, ''reload schema'';'
           ELSE 'ABSENT — cause (a). Apply supabase/migrations/0082_diligence_crosswalk.sql'
         END AS verdict,
         coalesce(to_regclass('public.nurock_diligence_crosswalk')::text, 'absent') AS detail

  UNION ALL
  -- (c): a table outside an exposed schema is invisible to PostgREST even when
  -- it exists. Supabase exposes `public` by default.
  SELECT 2, 'is it in some OTHER schema?',
         CASE WHEN count(*) = 0 THEN 'no — nowhere else'
              ELSE 'YES — found outside public; that is cause (c)' END,
         coalesce(string_agg(table_schema, ', '), 'none')
    FROM information_schema.tables
   WHERE table_name = 'nurock_diligence_crosswalk' AND table_schema <> 'public'

  UNION ALL
  -- 0082's siblings, to show whether the whole migration was skipped or just
  -- this table. 0081 is clearly applied (the app works); 0083's sign-off tables
  -- came later.
  SELECT 3, 'sibling diligence tables present',
         'informational',
         concat_ws(', ',
           CASE WHEN to_regclass('public.nurock_diligence_templates') IS NOT NULL THEN 'templates' END,
           CASE WHEN to_regclass('public.nurock_diligence_items') IS NOT NULL THEN 'items' END,
           CASE WHEN to_regclass('public.nurock_diligence_crosswalk') IS NOT NULL THEN 'crosswalk' END,
           CASE WHEN to_regclass('public.nurock_diligence_item_groups') IS NOT NULL THEN 'item_groups' END,
           CASE WHEN to_regclass('public.dm_diligence_deal_items') IS NOT NULL THEN 'deal_items' END,
           CASE WHEN to_regclass('public.dm_diligence_signoffs') IS NOT NULL THEN 'signoffs' END)

  UNION ALL
  -- If it DOES exist, these three tell you whether it would work once visible.
  -- A policy without a GRANT is inert — the lesson from the items DELETE.
  SELECT 4, 'if it exists: RLS enabled?',
         CASE
           WHEN to_regclass('public.nurock_diligence_crosswalk') IS NULL THEN 'n/a — absent'
           WHEN (SELECT relrowsecurity FROM pg_class
                  WHERE oid = to_regclass('public.nurock_diligence_crosswalk')) THEN 'yes'
           ELSE 'NO — open to any session'
         END,
         ''

  UNION ALL
  SELECT 5, 'if it exists: policies',
         CASE WHEN to_regclass('public.nurock_diligence_crosswalk') IS NULL
              THEN 'n/a — absent'
              ELSE count(*)::text || ' policy(ies)' END,
         coalesce(string_agg(policyname || '/' || cmd, ', '), 'none')
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'nurock_diligence_crosswalk'

  UNION ALL
  SELECT 6, 'if it exists: grants to authenticated',
         CASE WHEN to_regclass('public.nurock_diligence_crosswalk') IS NULL
              THEN 'n/a — absent'
              WHEN count(*) = 0 THEN 'NONE — a policy without a grant is inert'
              ELSE count(*)::text || ' privilege(s)' END,
         coalesce(string_agg(privilege_type, ', ' ORDER BY privilege_type), 'none')
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'nurock_diligence_crosswalk'
     AND grantee = 'authenticated'

  UNION ALL
  SELECT 7, 'if it exists: row count',
         CASE WHEN to_regclass('public.nurock_diligence_crosswalk') IS NULL
              THEN 'n/a — absent' ELSE 'see detail' END,
         CASE WHEN to_regclass('public.nurock_diligence_crosswalk') IS NULL
              THEN 'absent'
              ELSE (SELECT count(*)::text FROM public.nurock_diligence_crosswalk) END

) checks ORDER BY seq;

-- ============================================================================
-- WHAT TO DO WITH THE ANSWER
-- ============================================================================
-- Row 1 says ABSENT  -> apply supabase/migrations/0082_diligence_crosswalk.sql.
--                       NOTE: 0082 contains NO `NOTIFY pgrst, 'reload schema'`,
--                       so run that yourself afterwards or PostgREST may keep
--                       reporting the table as missing even once it exists.
--                       That omission is a plausible cause of this whole issue:
--                       the migration may well have run months ago and
--                       PostgREST was simply never told.
--
-- Row 1 says EXISTS   -> run: NOTIFY pgrst, 'reload schema';
--                       then have the browser session retry the mapping. If it
--                       still fails, check row 2 (cause c) and row 6 (a policy
--                       with no grant, which is the shape that broke the items
--                       DELETE on 2026-09-03).
--
-- Row 7 > 0 with the app reporting no mappings would mean rows exist and are
-- being filtered by RLS — a different problem again, and one row 5 and 6 would
-- narrow.
-- ============================================================================
