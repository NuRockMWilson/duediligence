-- ============================================================================
-- VERIFY GROUPS — 3 of 4: CYCLES, CROSS-TEMPLATE FILING, entity_role, LABEL
-- ============================================================================
-- *** IT ENDS BY RAISING AN ERROR. THAT IS THE DESIGN. ***
-- The error message IS the report, and raising rolls back the two throwaway
-- templates this creates. Nothing is kept.
--
-- The cycle checks matter most. Without them a caller can re-parent a group
-- under its own descendant, and every recursive read of that template loops
-- forever — a rendering path that can hang is worse than a rejected write.
-- ============================================================================

DO $$
DECLARE
  msg   text := '';
  fails int  := 0;
  ta    uuid;
  tb    uuid;
  item  uuid;
  g0    uuid;
  g1    uuid;
  g2    uuid;
  gb    uuid;
BEGIN
  INSERT INTO nurock_diligence_templates (slug, name, template_kind, is_canonical, is_active)
    VALUES ('zz-verify-int-a', 'ZZ VERIFY INTEGRITY A', 'lender', false, false)
    RETURNING id INTO ta;
  INSERT INTO nurock_diligence_templates (slug, name, template_kind, is_canonical, is_active)
    VALUES ('zz-verify-int-b', 'ZZ VERIFY INTEGRITY B', 'lender', false, false)
    RETURNING id INTO tb;
  INSERT INTO nurock_diligence_items (template_id, item_number, category, title)
    VALUES (ta, 9001, 'imported', 'ZZ verify item') RETURNING id INTO item;

  INSERT INTO nurock_diligence_item_groups (template_id, label)
    VALUES (ta, 'Section A') RETURNING id INTO g0;
  INSERT INTO nurock_diligence_item_groups (template_id, parent_group_id, label)
    VALUES (ta, g0, 'Sub A1') RETURNING id INTO g1;
  INSERT INTO nurock_diligence_item_groups (template_id, parent_group_id, label)
    VALUES (ta, g1, 'Sub A2') RETURNING id INTO g2;
  INSERT INTO nurock_diligence_item_groups (template_id, label)
    VALUES (tb, 'Section B') RETURNING id INTO gb;

  -- 1. a group cannot be its own parent
  BEGIN
    UPDATE nurock_diligence_item_groups SET parent_group_id = id WHERE id = g0;
    msg := msg || format(E'\nFAIL  1 self-parent refused -> the update SUCCEEDED');
    fails := fails + 1;
  EXCEPTION WHEN others THEN
    msg := msg || format(E'\nPASS  1 self-parent is refused');
  END;

  -- 2. …nor a descendant's child (the deeper cycle)
  BEGIN
    UPDATE nurock_diligence_item_groups SET parent_group_id = g2 WHERE id = g0;
    msg := msg || format(E'\nFAIL  2 ancestor cycle refused -> the update SUCCEEDED');
    fails := fails + 1;
  EXCEPTION WHEN others THEN
    msg := msg || format(E'\nPASS  2 ancestor cycle is refused');
  END;

  -- 3. a subsection cannot parent into another template
  BEGIN
    INSERT INTO nurock_diligence_item_groups (template_id, parent_group_id, label)
      VALUES (tb, g0, 'ZZ wrong template');
    msg := msg || format(E'\nFAIL  3 cross-template parent refused -> the insert SUCCEEDED');
    fails := fails + 1;
  EXCEPTION WHEN others THEN
    IF SQLERRM ILIKE '%parent belongs to template%' THEN
      msg := msg || format(E'\nPASS  3 cross-template parent is refused');
    ELSE
      msg := msg || format(E'\nFAIL  3 refused with the WRONG error -> %s', SQLERRM);
      fails := fails + 1;
    END IF;
  END;

  -- 4. an item cannot be filed under another template's section
  BEGIN
    UPDATE nurock_diligence_items SET group_id = gb WHERE id = item;
    msg := msg || format(E'\nFAIL  4 item cross-template filing refused -> the update SUCCEEDED');
    fails := fails + 1;
  EXCEPTION WHEN others THEN
    IF SQLERRM ILIKE '%belongs to template%' THEN
      msg := msg || format(E'\nPASS  4 item cannot join another template''s group');
    ELSE
      msg := msg || format(E'\nFAIL  4 refused with the WRONG error -> %s', SQLERRM);
      fails := fails + 1;
    END IF;
  END;

  -- 5. a repeating group with nothing to repeat over is incoherent
  BEGIN
    INSERT INTO nurock_diligence_item_groups (template_id, label, is_entity_parameterized)
      VALUES (ta, 'ZZ repeats over nothing', true);
    msg := msg || format(E'\nFAIL  5 parameterized group needs entity_role -> the insert SUCCEEDED');
    fails := fails + 1;
  EXCEPTION WHEN others THEN
    msg := msg || format(E'\nPASS  5 parameterized group needs an entity_role');
  END;

  -- 6. …and a role on a group that does not repeat is equally incoherent
  BEGIN
    INSERT INTO nurock_diligence_item_groups (template_id, label, entity_role)
      VALUES (ta, 'ZZ role without repeating', 'guarantor');
    msg := msg || format(E'\nFAIL  6 entity_role requires the flag -> the insert SUCCEEDED');
    fails := fails + 1;
  EXCEPTION WHEN others THEN
    msg := msg || format(E'\nPASS  6 entity_role requires the flag');
  END;

  -- 7. the valid combination must still be accepted
  BEGIN
    INSERT INTO nurock_diligence_item_groups
      (template_id, label, is_entity_parameterized, entity_role)
      VALUES (ta, 'ZZ Guarantors', true, 'guarantor');
    msg := msg || format(E'\nPASS  7 flag + role together is accepted');
  EXCEPTION WHEN others THEN
    msg := msg || format(E'\nFAIL  7 flag + role together -> %s', SQLERRM);
    fails := fails + 1;
  END;

  -- 8. a nameless section renders as a gap, so it is refused
  BEGIN
    INSERT INTO nurock_diligence_item_groups (template_id, label) VALUES (ta, '   ');
    msg := msg || format(E'\nFAIL  8 blank label refused -> the insert SUCCEEDED');
    fails := fails + 1;
  EXCEPTION WHEN others THEN
    msg := msg || format(E'\nPASS  8 blank label is refused');
  END;

  RAISE EXCEPTION E'\n=== 3/4 INTEGRITY: % failed of 8 ===%\n=== END. This error is INTENTIONAL and rolls back both throwaway templates. ===',
    fails, msg;
END $$;
