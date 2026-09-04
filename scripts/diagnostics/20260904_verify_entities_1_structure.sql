-- ============================================================================
-- VERIFY ENTITIES — 1 of 2: STRUCTURE
-- ============================================================================
-- READ-ONLY. Catalog queries only — no fixtures, no writes, no plpgsql, and no
-- direct reference to any table that might be absent (the mistake that made the
-- crosswalk diagnostic fail on the very question it was asked).
--
-- Read the `result` column. Every row must say PASS.
--
-- WHY TWO CHECKS ARE NOT HERE. Counting the seeded roles, and confirming no
-- pre-existing deal item was given an entity, both require READING a table or a
-- column this migration creates — and a reference to a missing object fails when
-- the statement is PARSED, so no runtime guard protects it. That is exactly how
-- the crosswalk diagnostic failed on the question it was asked. Those two live in
-- script 2, which presupposes the migration ran. This script does not.
-- ============================================================================

SELECT * FROM (

  SELECT 1 AS seq, 'entity_roles table exists' AS check_name,
         CASE WHEN to_regclass('public.nurock_diligence_entity_roles') IS NOT NULL
              THEN 'PASS' ELSE 'FAIL — migration not applied' END AS result,
         coalesce(to_regclass('public.nurock_diligence_entity_roles')::text,'absent') AS detail

  UNION ALL
  SELECT 2, 'entities table exists',
         CASE WHEN to_regclass('public.nurock_diligence_entities') IS NOT NULL
              THEN 'PASS' ELSE 'FAIL' END,
         coalesce(to_regclass('public.nurock_diligence_entities')::text,'absent')

  UNION ALL
  SELECT 3, 'deal_entities join exists',
         CASE WHEN to_regclass('public.dm_diligence_deal_entities') IS NOT NULL
              THEN 'PASS' ELSE 'FAIL' END,
         coalesce(to_regclass('public.dm_diligence_deal_entities')::text,'absent')

  UNION ALL
  -- THE NULL TRAP. The old blanket constraint must be GONE and replaced by two
  -- PARTIAL unique indexes. If the constraint survives, per-entity items are
  -- impossible; if the partial indexes are missing, ensureDealItems can insert a
  -- duplicate set on every page load.
  SELECT 5, 'the blanket (deal_id, item_id) UNIQUE CONSTRAINT is gone',
         CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL — per-entity rows will be rejected' END,
         coalesce(string_agg(con.conname, ', '), 'none')
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
   WHERE rel.relname = 'dm_diligence_deal_items' AND con.contype = 'u'
     -- ::text on BOTH sides: attname is `name`, and name[] = text[] has no
     -- operator. See the note in the migration.
     AND (SELECT array_agg(att.attname::text ORDER BY att.attname::text)
            FROM unnest(con.conkey) k
            JOIN pg_attribute att ON att.attrelid=con.conrelid AND att.attnum=k)
         = ARRAY['deal_id','item_id']::text[]

  UNION ALL
  SELECT 6, 'both PARTIAL unique indexes exist',
         CASE WHEN count(*) = 2 THEN 'PASS' ELSE 'FAIL' END,
         count(*)::text || ': ' || coalesce(string_agg(indexname, ', ' ORDER BY indexname),'none')
    FROM pg_indexes
   WHERE schemaname='public' AND tablename='dm_diligence_deal_items'
     AND indexname IN ('idx_dmddi_deal_item_no_entity','idx_dmddi_deal_item_entity')

  UNION ALL
  -- Both must be PARTIAL. A non-partial pair would be the very bug being avoided.
  SELECT 7, 'both indexes are PARTIAL (carry a WHERE clause)',
         CASE WHEN count(*) = 2 THEN 'PASS' ELSE 'FAIL' END,
         coalesce(string_agg(indexname || ' -> ' ||
           substring(indexdef from 'WHERE.*$'), ' | '), 'none')
    FROM pg_indexes
   WHERE schemaname='public' AND tablename='dm_diligence_deal_items'
     AND indexname IN ('idx_dmddi_deal_item_no_entity','idx_dmddi_deal_item_entity')
     AND indexdef ILIKE '%WHERE%'

  UNION ALL
  SELECT 8, 'deal_items.entity_id exists and is NULLABLE',
         CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END,
         coalesce(string_agg(data_type || ', nullable=' || is_nullable, ''),'absent')
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='dm_diligence_deal_items'
     AND column_name='entity_id' AND is_nullable='YES'

  UNION ALL
  SELECT 10, 'item_groups.entity_role now references the catalog',
         CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END,
         coalesce(string_agg(conname, ', '), 'none')
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
   WHERE rel.relname='nurock_diligence_item_groups' AND con.contype='f'
     AND con.conname='nurock_diligence_item_groups_entity_role_fk'

  UNION ALL
  SELECT 11, 'the entity-on-deal trigger exists',
         CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END,
         coalesce(string_agg(tgname, ', '), 'none')
    FROM pg_trigger
   WHERE NOT tgisinternal AND tgname='trg_dmddi_entity_on_deal'

  UNION ALL
  SELECT 12, 'all three new tables have RLS enabled',
         CASE WHEN count(*) = 3 THEN 'PASS' ELSE 'FAIL' END,
         count(*)::text || ' of 3'
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relrowsecurity
     AND c.relname IN ('nurock_diligence_entity_roles',
                       'nurock_diligence_entities',
                       'dm_diligence_deal_entities')

  UNION ALL
  SELECT 13, 'six policies across the three new tables',
         CASE WHEN count(*) = 6 THEN 'PASS' ELSE 'FAIL' END,
         count(*)::text || ': ' || coalesce(string_agg(policyname, ', ' ORDER BY policyname),'none')
    FROM pg_policies
   WHERE schemaname='public'
     AND tablename IN ('nurock_diligence_entity_roles',
                       'nurock_diligence_entities',
                       'dm_diligence_deal_entities')

  UNION ALL
  SELECT 14, 'no unconditional TRUE write predicate on any of them',
         CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
         coalesce(string_agg(tablename || '/' || policyname, ', '), 'none')
    FROM pg_policies
   WHERE schemaname='public' AND cmd='ALL'
     AND tablename IN ('nurock_diligence_entity_roles',
                       'nurock_diligence_entities',
                       'dm_diligence_deal_entities')
     AND (btrim(coalesce(qual,''))='true' OR btrim(coalesce(with_check,''))='true')

  UNION ALL
  -- A POLICY NEVER CONFERS A PRIVILEGE. 12 = 3 tables x 4 privileges.
  SELECT 15, 'authenticated holds all four privileges on all three tables',
         CASE WHEN count(*) = 12 THEN 'PASS' ELSE 'FAIL' END,
         count(*)::text || ' of 12'
    FROM information_schema.role_table_grants
   WHERE table_schema='public' AND grantee='authenticated'
     AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')
     AND table_name IN ('nurock_diligence_entity_roles',
                        'nurock_diligence_entities',
                        'dm_diligence_deal_entities')

  UNION ALL
  SELECT 16, 'anon holds NOTHING, and nobody holds TRUNCATE',
         CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
         coalesce(string_agg(grantee || ':' || table_name || ':' || privilege_type, ', '),'none')
    FROM information_schema.role_table_grants
   WHERE table_schema='public'
     AND table_name IN ('nurock_diligence_entity_roles',
                        'nurock_diligence_entities',
                        'dm_diligence_deal_entities')
     AND (grantee='anon'
          OR (privilege_type='TRUNCATE' AND grantee IN ('anon','authenticated')))

) checks ORDER BY seq;
