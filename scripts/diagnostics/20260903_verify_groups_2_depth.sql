-- ============================================================================
-- VERIFY GROUPS — 2 of 4: DEPTH IS DERIVED, AND THE CEILING REFUSES LEVEL 4
-- ============================================================================
-- *** IT ENDS BY RAISING AN ERROR. THAT IS THE DESIGN. ***
-- The error message IS the report. Raising is what rolls back the one throwaway
-- template this creates, regardless of how the SQL editor handles transactions.
-- Nothing is kept.
--
-- Every appended line uses format(), never a bare literal — a bare untyped
-- literal is what broke the previous single-file version (Postgres resolved
-- `text[] || 'literal'` as array||array and tried to parse the sentence as an
-- array). `msg` is plain text here and there is no array anywhere.
-- ============================================================================

DO $$
DECLARE
  msg   text := '';
  fails int  := 0;
  t     uuid;
  g0    uuid;
  g1    uuid;
  g2    uuid;
  d     int;
BEGIN
  INSERT INTO nurock_diligence_templates (slug, name, template_kind, is_canonical, is_active)
    VALUES ('zz-verify-depth', 'ZZ VERIFY DEPTH', 'lender', false, false)
    RETURNING id INTO t;

  -- 1. top level -> depth 0
  INSERT INTO nurock_diligence_item_groups (template_id, label, code)
    VALUES (t, 'Real Estate', '2') RETURNING id, depth INTO g0, d;
  msg := msg || format(E'\n%s  1 top-level group gets depth 0 (got %s)',
                       CASE WHEN d = 0 THEN 'PASS' ELSE 'FAIL' END, d);
  IF d <> 0 THEN fails := fails + 1; END IF;

  -- 2. subsection -> depth 1
  INSERT INTO nurock_diligence_item_groups (template_id, parent_group_id, label, code)
    VALUES (t, g0, 'Title', '2.a') RETURNING id, depth INTO g1, d;
  msg := msg || format(E'\n%s  2 subsection gets depth 1 (got %s)',
                       CASE WHEN d = 1 THEN 'PASS' ELSE 'FAIL' END, d);
  IF d <> 1 THEN fails := fails + 1; END IF;

  -- 3. third level -> depth 2
  INSERT INTO nurock_diligence_item_groups (template_id, parent_group_id, label)
    VALUES (t, g1, 'Guarantor iii') RETURNING id, depth INTO g2, d;
  msg := msg || format(E'\n%s  3 third level gets depth 2 (got %s)',
                       CASE WHEN d = 2 THEN 'PASS' ELSE 'FAIL' END, d);
  IF d <> 2 THEN fails := fails + 1; END IF;

  -- 4. a caller-supplied depth must be OVERWRITTEN, never trusted
  BEGIN
    INSERT INTO nurock_diligence_item_groups (template_id, parent_group_id, label, depth)
      VALUES (t, g0, 'ZZ lying about depth', 0) RETURNING depth INTO d;
    msg := msg || format(E'\n%s  4 caller-supplied depth is overridden (got %s)',
                         CASE WHEN d = 1 THEN 'PASS' ELSE 'FAIL' END, d);
    IF d <> 1 THEN fails := fails + 1; END IF;
  EXCEPTION WHEN others THEN
    msg := msg || format(E'\nFAIL  4 caller-supplied depth is overridden -> %s', SQLERRM);
    fails := fails + 1;
  END;

  -- 5. THE CEILING. A fourth level must be refused, with the intended message.
  BEGIN
    INSERT INTO nurock_diligence_item_groups (template_id, parent_group_id, label)
      VALUES (t, g2, 'ZZ too deep');
    msg := msg || format(E'\nFAIL  5 fourth level refused -> the insert SUCCEEDED');
    fails := fails + 1;
  EXCEPTION WHEN others THEN
    IF SQLERRM ILIKE '%at most three levels%' THEN
      msg := msg || format(E'\nPASS  5 fourth level is refused');
    ELSE
      msg := msg || format(E'\nFAIL  5 refused with the WRONG error -> %s', SQLERRM);
      fails := fails + 1;
    END IF;
  END;

  RAISE EXCEPTION E'\n=== 2/4 DEPTH: % failed of 5 ===%\n=== END. This error is INTENTIONAL and rolls back the throwaway template. ===',
    fails, msg;
END $$;
