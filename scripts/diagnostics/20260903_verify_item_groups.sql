-- ============================================================================
-- SELF-ASSERTING VERIFIER for 20260903_diligence_item_groups.sql
-- ============================================================================
-- Michael runs this. Nobody else. Run it AFTER the migration.
--
-- *** THIS SCRIPT CHANGES NOTHING. It opens a transaction, creates a throwaway
-- *** template, tries to violate every rule the migration claims to enforce,
-- *** and ends with ROLLBACK. Nothing it inserts survives.
--
-- WHY IT EXISTS RATHER THAN A LIST OF THINGS TO EYEBALL. I could not execute the
-- migration myself: the embedded PostgreSQL 17.10 in nurock-underwriting cannot
-- fork backends in this environment (every connection dies with Windows
-- 0xC0000142, DLL init failure), and the stand-alone single-user backend splits
-- input on semicolons, which mangles dollar-quoted function bodies. So the
-- migration's SYNTAX is proven (pglast v8.4, parses as PostgreSQL) and its
-- BEHAVIOUR is not. Constraints and triggers nobody has watched refuse anything
-- are not yet known to work — a check that cannot fail is not coverage, and a
-- check nobody has seen fire is only a claim.
--
-- Read the `result` column. Every row must say PASS. Send me the output.
-- ============================================================================

BEGIN;

CREATE TEMP TABLE _verify (
  seq        int,
  check_name text,
  result     text,
  detail     text
) ON COMMIT DROP;

DO $$
DECLARE
  v_tmpl   uuid;
  v_other  uuid;
  v_item   uuid;
  v_l0     uuid;
  v_l1     uuid;
  v_l2     uuid;
  v_og     uuid;
  v_depth  int;
  v_n      int;
BEGIN
  -- --------------------------------------------------------------------------
  -- Fixtures. Throwaway, and removed by the ROLLBACK at the end.
  -- --------------------------------------------------------------------------
  INSERT INTO nurock_diligence_templates (slug, name, template_kind, is_canonical, is_active)
    VALUES ('zz-verify-groups-a', 'ZZ VERIFY GROUPS A', 'lender', false, false)
    RETURNING id INTO v_tmpl;
  INSERT INTO nurock_diligence_templates (slug, name, template_kind, is_canonical, is_active)
    VALUES ('zz-verify-groups-b', 'ZZ VERIFY GROUPS B', 'lender', false, false)
    RETURNING id INTO v_other;
  INSERT INTO nurock_diligence_items (template_id, item_number, category, title)
    VALUES (v_tmpl, 9001, 'imported', 'ZZ verify item')
    RETURNING id INTO v_item;

  -- --------------------------------------------------------------------------
  -- 1. depth is DERIVED, not supplied.
  -- --------------------------------------------------------------------------
  INSERT INTO nurock_diligence_item_groups (template_id, label, code)
    VALUES (v_tmpl, 'Real Estate', '2') RETURNING id, depth INTO v_l0, v_depth;
  INSERT INTO _verify VALUES (1, 'top-level group gets depth 0',
    CASE WHEN v_depth = 0 THEN 'PASS' ELSE 'FAIL' END, 'depth=' || v_depth);

  INSERT INTO nurock_diligence_item_groups (template_id, parent_group_id, label, code)
    VALUES (v_tmpl, v_l0, 'Title', '2.a') RETURNING id, depth INTO v_l1, v_depth;
  INSERT INTO _verify VALUES (2, 'subsection gets depth 1',
    CASE WHEN v_depth = 1 THEN 'PASS' ELSE 'FAIL' END, 'depth=' || v_depth);

  INSERT INTO nurock_diligence_item_groups (template_id, parent_group_id, label)
    VALUES (v_tmpl, v_l1, 'Guarantor iii') RETURNING id, depth INTO v_l2, v_depth;
  INSERT INTO _verify VALUES (3, 'third level gets depth 2',
    CASE WHEN v_depth = 2 THEN 'PASS' ELSE 'FAIL' END, 'depth=' || v_depth);

  -- Supplying a wrong depth must be overwritten by the trigger, not trusted.
  BEGIN
    INSERT INTO nurock_diligence_item_groups (template_id, parent_group_id, label, depth)
      VALUES (v_tmpl, v_l0, 'lying about depth', 0) RETURNING depth INTO v_depth;
    INSERT INTO _verify VALUES (4, 'caller-supplied depth is overridden',
      CASE WHEN v_depth = 1 THEN 'PASS' ELSE 'FAIL' END, 'depth=' || v_depth);
  EXCEPTION WHEN others THEN
    INSERT INTO _verify VALUES (4, 'caller-supplied depth is overridden', 'FAIL', SQLERRM);
  END;

  -- --------------------------------------------------------------------------
  -- 2. The ceiling refuses a fourth level.
  -- --------------------------------------------------------------------------
  BEGIN
    INSERT INTO nurock_diligence_item_groups (template_id, parent_group_id, label)
      VALUES (v_tmpl, v_l2, 'too deep');
    INSERT INTO _verify VALUES (5, 'FOURTH level is refused', 'FAIL',
      'the insert SUCCEEDED — the ceiling is not enforced');
  EXCEPTION WHEN others THEN
    INSERT INTO _verify VALUES (5, 'FOURTH level is refused',
      CASE WHEN SQLERRM ILIKE '%at most three levels%' THEN 'PASS' ELSE 'FAIL' END,
      SQLERRM);
  END;

  -- --------------------------------------------------------------------------
  -- 3. Cycles are refused. A rendering path that can hang is worse than a
  --    rejected write.
  -- --------------------------------------------------------------------------
  BEGIN
    UPDATE nurock_diligence_item_groups SET parent_group_id = id WHERE id = v_l0;
    INSERT INTO _verify VALUES (6, 'self-parent is refused', 'FAIL',
      'the update SUCCEEDED');
  EXCEPTION WHEN others THEN
    INSERT INTO _verify VALUES (6, 'self-parent is refused', 'PASS', SQLERRM);
  END;

  BEGIN
    UPDATE nurock_diligence_item_groups SET parent_group_id = v_l2 WHERE id = v_l0;
    INSERT INTO _verify VALUES (7, 'ancestor cycle is refused', 'FAIL',
      'the update SUCCEEDED — a cycle now exists');
  EXCEPTION WHEN others THEN
    INSERT INTO _verify VALUES (7, 'ancestor cycle is refused', 'PASS', SQLERRM);
  END;

  -- --------------------------------------------------------------------------
  -- 4. A packet cannot borrow another financier's structure.
  -- --------------------------------------------------------------------------
  BEGIN
    INSERT INTO nurock_diligence_item_groups (template_id, parent_group_id, label)
      VALUES (v_other, v_l0, 'wrong template');
    INSERT INTO _verify VALUES (8, 'cross-template parent is refused', 'FAIL',
      'the insert SUCCEEDED');
  EXCEPTION WHEN others THEN
    INSERT INTO _verify VALUES (8, 'cross-template parent is refused',
      CASE WHEN SQLERRM ILIKE '%parent belongs to template%' THEN 'PASS' ELSE 'FAIL' END,
      SQLERRM);
  END;

  -- v_item belongs to v_tmpl; try to file it under a group in v_other.
  INSERT INTO nurock_diligence_item_groups (template_id, label)
    VALUES (v_other, 'other template section') RETURNING id INTO v_og;
  BEGIN
    UPDATE nurock_diligence_items SET group_id = v_og WHERE id = v_item;
    INSERT INTO _verify VALUES (9, 'item cannot join another template''s group',
      'FAIL', 'the update SUCCEEDED');
  EXCEPTION WHEN others THEN
    INSERT INTO _verify VALUES (9, 'item cannot join another template''s group',
      CASE WHEN SQLERRM ILIKE '%belongs to template%' THEN 'PASS' ELSE 'FAIL' END,
      SQLERRM);
  END;

  -- --------------------------------------------------------------------------
  -- 5. entity_role coherence (the ASK 2 hook must not accept nonsense).
  -- --------------------------------------------------------------------------
  BEGIN
    INSERT INTO nurock_diligence_item_groups (template_id, label, is_entity_parameterized)
      VALUES (v_tmpl, 'repeats over nothing', true);
    INSERT INTO _verify VALUES (10, 'parameterized group needs an entity_role',
      'FAIL', 'the insert SUCCEEDED');
  EXCEPTION WHEN others THEN
    INSERT INTO _verify VALUES (10, 'parameterized group needs an entity_role',
      'PASS', SQLERRM);
  END;

  BEGIN
    INSERT INTO nurock_diligence_item_groups (template_id, label, entity_role)
      VALUES (v_tmpl, 'role without repeating', 'guarantor');
    INSERT INTO _verify VALUES (11, 'entity_role requires the flag', 'FAIL',
      'the insert SUCCEEDED');
  EXCEPTION WHEN others THEN
    INSERT INTO _verify VALUES (11, 'entity_role requires the flag', 'PASS', SQLERRM);
  END;

  BEGIN
    INSERT INTO nurock_diligence_item_groups
      (template_id, label, is_entity_parameterized, entity_role)
      VALUES (v_tmpl, 'Guarantors', true, 'guarantor');
    INSERT INTO _verify VALUES (12, 'flag + role together is accepted', 'PASS', '');
  EXCEPTION WHEN others THEN
    INSERT INTO _verify VALUES (12, 'flag + role together is accepted', 'FAIL', SQLERRM);
  END;

  -- --------------------------------------------------------------------------
  -- 6. A blank label is refused (a nameless section renders as a gap).
  -- --------------------------------------------------------------------------
  BEGIN
    INSERT INTO nurock_diligence_item_groups (template_id, label)
      VALUES (v_tmpl, '   ');
    INSERT INTO _verify VALUES (13, 'blank label is refused', 'FAIL',
      'the insert SUCCEEDED');
  EXCEPTION WHEN others THEN
    INSERT INTO _verify VALUES (13, 'blank label is refused', 'PASS', SQLERRM);
  END;

  -- --------------------------------------------------------------------------
  -- 7. sort_order is NOT unique, so reordering is one plain UPDATE. This is the
  --    deliberate opposite of nurock_diligence_items.item_number, whose inline
  --    UNIQUE forces a three-step park-and-swap.
  -- --------------------------------------------------------------------------
  BEGIN
    INSERT INTO nurock_diligence_item_groups (template_id, label, sort_order)
      VALUES (v_tmpl, 'shares position A', 5), (v_tmpl, 'shares position B', 5);
    INSERT INTO _verify VALUES (14, 'two groups may share a sort_order', 'PASS', '');
  EXCEPTION WHEN others THEN
    INSERT INTO _verify VALUES (14, 'two groups may share a sort_order', 'FAIL', SQLERRM);
  END;

  -- --------------------------------------------------------------------------
  -- 8. Deleting a section DETACHES its items and NEVER deletes them, but does
  --    cascade to its subsections.
  -- --------------------------------------------------------------------------
  UPDATE nurock_diligence_items SET group_id = v_l0 WHERE id = v_item;
  DELETE FROM nurock_diligence_item_groups WHERE id = v_l0;

  SELECT count(*) INTO v_n FROM nurock_diligence_items WHERE id = v_item;
  INSERT INTO _verify VALUES (15, 'item SURVIVES deletion of its group',
    CASE WHEN v_n = 1 THEN 'PASS' ELSE 'FAIL' END, 'rows=' || v_n);

  SELECT count(*) INTO v_n
    FROM nurock_diligence_items WHERE id = v_item AND group_id IS NULL;
  INSERT INTO _verify VALUES (16, 'orphaned item''s group_id reset to NULL',
    CASE WHEN v_n = 1 THEN 'PASS' ELSE 'FAIL' END, 'rows=' || v_n);

  SELECT count(*) INTO v_n
    FROM nurock_diligence_item_groups WHERE id IN (v_l1, v_l2);
  INSERT INTO _verify VALUES (17, 'subsections cascade away with their section',
    CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, 'remaining=' || v_n);
END $$;

-- ----------------------------------------------------------------------------
-- 9. Grants and policies — structural, no fixtures needed.
-- ----------------------------------------------------------------------------
INSERT INTO _verify
SELECT 18, 'anon holds NOTHING on the two catalog tables',
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
       coalesce(string_agg(table_name || ':' || privilege_type, ', '), 'none')
  FROM information_schema.role_table_grants
 WHERE table_schema = 'public' AND grantee = 'anon'
   AND table_name IN ('nurock_diligence_item_groups', 'nurock_diligence_items');

INSERT INTO _verify
SELECT 19, 'TRUNCATE is granted to nobody',
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
       coalesce(string_agg(table_name || ':' || grantee, ', '), 'none')
  FROM information_schema.role_table_grants
 WHERE table_schema = 'public' AND privilege_type = 'TRUNCATE'
   AND grantee IN ('anon', 'authenticated')
   AND table_name IN ('nurock_diligence_item_groups', 'nurock_diligence_items');

-- Deliberate: the app never hard-deletes catalog items (removal is
-- is_active=false), so DELETE must NOT appear here.
INSERT INTO _verify
SELECT 20, 'nurock_diligence_items has NO DELETE grant (by design)',
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
       coalesce(string_agg(grantee, ', '), 'none')
  FROM information_schema.role_table_grants
 WHERE table_schema = 'public' AND table_name = 'nurock_diligence_items'
   AND privilege_type = 'DELETE' AND grantee = 'authenticated';

INSERT INTO _verify
SELECT 21, 'groups table has exactly two policies',
       CASE WHEN count(*) = 2 THEN 'PASS' ELSE 'FAIL' END,
       coalesce(string_agg(policyname || '/' || cmd, ', '), 'none')
  FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'nurock_diligence_item_groups';

INSERT INTO _verify
SELECT 22, 'no unconditional TRUE write predicate on the groups table',
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
       coalesce(string_agg(policyname, ', '), 'none')
  FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'nurock_diligence_item_groups'
   AND cmd = 'ALL'
   AND (btrim(coalesce(qual, '')) = 'true' OR btrim(coalesce(with_check, '')) = 'true');

-- Nothing in production may have been regrouped by the migration itself.
INSERT INTO _verify
SELECT 23, 'no PRE-EXISTING item was grouped by the migration',
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
       'grouped rows outside the throwaway templates: ' || count(*)
  FROM nurock_diligence_items i
  JOIN nurock_diligence_templates t ON t.id = i.template_id
 WHERE i.group_id IS NOT NULL AND t.slug NOT LIKE 'zz-verify-groups-%';

-- ============================================================================
-- THE RESULT. Every row must read PASS.
-- ============================================================================
SELECT seq, check_name, result, detail FROM _verify ORDER BY seq;

-- *** NOTHING ABOVE IS KEPT. ***
ROLLBACK;
