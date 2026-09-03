-- ============================================================================
-- VERIFY GROUPS — 4 of 4: DELETING A SECTION DETACHES ITEMS, NEVER DELETES THEM
-- ============================================================================
-- *** IT ENDS BY RAISING AN ERROR. THAT IS THE DESIGN. ***
-- The error message IS the report, and raising rolls back the one throwaway
-- template this creates. Nothing is kept.
--
-- This is the script that matters most for data safety. group_id is
-- ON DELETE SET NULL, never CASCADE: removing a section must never destroy the
-- lender's requirements. It also confirms the LAST production-safety claim —
-- that the migration grouped nothing that already existed.
-- ============================================================================

DO $$
DECLARE
  msg   text := '';
  fails int  := 0;
  t     uuid;
  item  uuid;
  g0    uuid;
  g1    uuid;
  g2    uuid;
  n     int;
BEGIN
  INSERT INTO nurock_diligence_templates (slug, name, template_kind, is_canonical, is_active)
    VALUES ('zz-verify-detach', 'ZZ VERIFY DETACH', 'lender', false, false)
    RETURNING id INTO t;
  INSERT INTO nurock_diligence_items (template_id, item_number, category, title)
    VALUES (t, 9001, 'imported', 'ZZ verify item') RETURNING id INTO item;

  INSERT INTO nurock_diligence_item_groups (template_id, label)
    VALUES (t, 'Section') RETURNING id INTO g0;
  INSERT INTO nurock_diligence_item_groups (template_id, parent_group_id, label)
    VALUES (t, g0, 'Subsection') RETURNING id INTO g1;
  INSERT INTO nurock_diligence_item_groups (template_id, parent_group_id, label)
    VALUES (t, g1, 'Sub-subsection') RETURNING id INTO g2;

  -- 1. sort_order is NOT unique, so reordering a group is one plain UPDATE.
  --    The deliberate opposite of items.item_number, whose inline UNIQUE forces
  --    a three-step park-and-swap.
  BEGIN
    INSERT INTO nurock_diligence_item_groups (template_id, label, sort_order)
      VALUES (t, 'ZZ shares position A', 5), (t, 'ZZ shares position B', 5);
    msg := msg || format(E'\nPASS  1 two groups may share a sort_order');
  EXCEPTION WHEN others THEN
    msg := msg || format(E'\nFAIL  1 sort_order collided -> %s', SQLERRM);
    fails := fails + 1;
  END;

  -- File the item, then delete its section.
  UPDATE nurock_diligence_items SET group_id = g0 WHERE id = item;
  DELETE FROM nurock_diligence_item_groups WHERE id = g0;

  -- 2. the item must SURVIVE
  SELECT count(*) INTO n FROM nurock_diligence_items WHERE id = item;
  msg := msg || format(E'\n%s  2 item SURVIVES deletion of its group (rows=%s)',
                       CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END, n);
  IF n <> 1 THEN fails := fails + 1; END IF;

  -- 3. …and fall back to ungrouped rather than keeping a dangling id
  SELECT count(*) INTO n
    FROM nurock_diligence_items WHERE id = item AND group_id IS NULL;
  msg := msg || format(E'\n%s  3 its group_id was reset to NULL (rows=%s)',
                       CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END, n);
  IF n <> 1 THEN fails := fails + 1; END IF;

  -- 4. subsections DO cascade — structure is disposable, requirements are not
  SELECT count(*) INTO n
    FROM nurock_diligence_item_groups WHERE id IN (g1, g2);
  msg := msg || format(E'\n%s  4 subsections cascaded with their section (remaining=%s)',
                       CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END, n);
  IF n <> 0 THEN fails := fails + 1; END IF;

  -- 5. THE PRODUCTION-SAFETY CHECK. Nothing that existed before the migration
  --    may have been grouped by it. Excludes this script's own fixture.
  SELECT count(*) INTO n
    FROM nurock_diligence_items i
    JOIN nurock_diligence_templates tt ON tt.id = i.template_id
   WHERE i.group_id IS NOT NULL
     AND tt.slug NOT LIKE 'zz-verify-%';
  msg := msg || format(E'\n%s  5 no PRE-EXISTING item was grouped (found=%s)',
                       CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END, n);
  IF n <> 0 THEN fails := fails + 1; END IF;

  -- 6. and the canonical checklist is untouched in count
  SELECT count(*) INTO n
    FROM nurock_diligence_items i
    JOIN nurock_diligence_templates tt ON tt.id = i.template_id
   WHERE tt.is_canonical AND i.is_active;
  msg := msg || format(E'\n%s  6 canonical checklist still has 59 active items (got %s)',
                       CASE WHEN n = 59 THEN 'PASS' ELSE 'CHECK' END, n);
  -- Not counted as a failure: 59 is the seeded number, and a deliberate
  -- addition would legitimately change it. Reported so a SURPRISE is visible.

  RAISE EXCEPTION E'\n=== 4/4 DETACH: % failed of 5 (+1 informational) ===%\n=== END. This error is INTENTIONAL and rolls back the throwaway template. ===',
    fails, msg;
END $$;
