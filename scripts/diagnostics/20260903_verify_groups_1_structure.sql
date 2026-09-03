-- ============================================================================
-- VERIFY GROUPS — 1 of 4: STRUCTURE
-- ============================================================================
-- READ-ONLY. No fixtures, no writes, no plpgsql, no transaction assumptions.
-- It reads the system catalogs only, so it is safe to run at any time and it
-- works even if the migration has NOT been applied (it will say so).
--
-- Read the `result` column. Every row must say PASS.
-- ============================================================================

SELECT * FROM (

  -- The table itself.
  SELECT 1 AS seq,
         'groups table exists' AS check_name,
         CASE WHEN to_regclass('public.nurock_diligence_item_groups') IS NOT NULL
              THEN 'PASS' ELSE 'FAIL — migration not applied' END AS result,
         coalesce(to_regclass('public.nurock_diligence_item_groups')::text, 'absent') AS detail

  UNION ALL
  -- The column on items.
  SELECT 2, 'items.group_id column exists',
         CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END,
         coalesce(string_agg(data_type || ', nullable=' || is_nullable, ''), 'absent')
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'nurock_diligence_items'
     AND column_name = 'group_id'

  UNION ALL
  -- group_id MUST be nullable: every pre-existing row is NULL and grouping is
  -- opt-in per template. A NOT NULL here would have broken the whole catalog.
  SELECT 3, 'items.group_id is NULLABLE',
         CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END,
         coalesce(string_agg(is_nullable, ''), 'absent')
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'nurock_diligence_items'
     AND column_name = 'group_id' AND is_nullable = 'YES'

  UNION ALL
  -- Every column the design calls for.
  SELECT 4, 'groups table has all 12 expected columns',
         CASE WHEN count(*) = 12 THEN 'PASS' ELSE 'FAIL' END,
         count(*)::text || ' of 12: ' ||
           coalesce(string_agg(column_name, ', ' ORDER BY column_name), 'none')
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'nurock_diligence_item_groups'
     AND column_name IN ('id','template_id','parent_group_id','label','code',
                         'depth','sort_order','is_entity_parameterized',
                         'entity_role','notes','created_at','updated_at')

  UNION ALL
  -- RLS on, or the policies below are decoration.
  SELECT 5, 'row level security is ENABLED on the groups table',
         CASE WHEN bool_or(relrowsecurity) THEN 'PASS' ELSE 'FAIL' END,
         coalesce(bool_or(relrowsecurity)::text, 'table absent')
    FROM pg_class
   WHERE oid = to_regclass('public.nurock_diligence_item_groups')

  UNION ALL
  SELECT 6, 'groups table has exactly two policies',
         CASE WHEN count(*) = 2 THEN 'PASS' ELSE 'FAIL' END,
         coalesce(string_agg(policyname || '/' || cmd, ', ' ORDER BY policyname), 'none')
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'nurock_diligence_item_groups'

  UNION ALL
  -- The write predicate must be role-scoped, not unconditional.
  SELECT 7, 'no unconditional TRUE write predicate',
         CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
         coalesce(string_agg(policyname, ', '), 'none')
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'nurock_diligence_item_groups'
     AND cmd = 'ALL'
     AND (btrim(coalesce(qual, '')) = 'true'
          OR btrim(coalesce(with_check, '')) = 'true')

  UNION ALL
  -- …and it must actually mention the role helpers.
  SELECT 8, 'write predicate is role-scoped (app_can / app_is_org_admin)',
         CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END,
         coalesce(string_agg(left(coalesce(qual,''), 90), ' | '), 'none')
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'nurock_diligence_item_groups'
     AND cmd = 'ALL'
     AND (qual ILIKE '%app_can%' OR qual ILIKE '%app_is_org_admin%')

  UNION ALL
  -- A POLICY NEVER CONFERS A PRIVILEGE. This is the check that would have
  -- caught the nurock_diligence_items DELETE problem before it was measured
  -- live: that table has a permissive FOR ALL policy and no GRANT.
  SELECT 9, 'authenticated holds SELECT/INSERT/UPDATE/DELETE on groups',
         CASE WHEN count(*) = 4 THEN 'PASS' ELSE 'FAIL' END,
         count(*)::text || ': ' ||
           coalesce(string_agg(privilege_type, ', ' ORDER BY privilege_type), 'none')
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'nurock_diligence_item_groups'
     AND grantee = 'authenticated'
     AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')

  UNION ALL
  SELECT 10, 'anon holds NOTHING on either catalog table',
         CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
         coalesce(string_agg(table_name || ':' || privilege_type, ', '), 'none')
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND grantee = 'anon'
     AND table_name IN ('nurock_diligence_item_groups','nurock_diligence_items')

  UNION ALL
  -- Row security does not filter TRUNCATE, so no policy closes it.
  SELECT 11, 'TRUNCATE granted to nobody on either table',
         CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
         coalesce(string_agg(table_name || ':' || grantee, ', '), 'none')
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND privilege_type = 'TRUNCATE'
     AND grantee IN ('anon','authenticated')
     AND table_name IN ('nurock_diligence_item_groups','nurock_diligence_items')

  UNION ALL
  -- DELIBERATE: the app never hard-deletes catalog items (removal is
  -- is_active=false), so DELETE must NOT be granted here.
  SELECT 12, 'items has NO DELETE grant, by design',
         CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN count(*) = 0 THEN 'none' ELSE 'granted to authenticated' END
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'nurock_diligence_items'
     AND privilege_type = 'DELETE' AND grantee = 'authenticated'

  UNION ALL
  -- Both triggers must exist, or depth and cross-template filing are unpoliced.
  SELECT 13, 'depth + cascade + same-template triggers all exist',
         CASE WHEN count(*) = 3 THEN 'PASS' ELSE 'FAIL' END,
         count(*)::text || ' of 3: ' ||
           coalesce(string_agg(tgname, ', ' ORDER BY tgname), 'none')
    FROM pg_trigger
   WHERE NOT tgisinternal
     AND tgname IN ('trg_nddg_depth','trg_nddg_depth_cascade',
                    'trg_ndi_group_same_template')

) checks ORDER BY seq;
