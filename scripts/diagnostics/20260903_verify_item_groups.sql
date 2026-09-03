-- ============================================================================
-- SELF-ASSERTING VERIFIER for 20260903_diligence_item_groups.sql
-- ============================================================================
-- Michael runs this. Nobody else. Run it AFTER the migration.
--
-- *** IT ENDS BY RAISING AN ERROR. THAT IS THE DESIGN, NOT A FAILURE. ***
-- The error message IS the report — read the PASS/FAIL lines in it. Raising is
-- what guarantees every fixture this script creates is rolled back, no matter
-- how the SQL editor handles transactions.
--
-- ----------------------------------------------------------------------------
-- WHY THIS IS THE THIRD VERSION. TWO OF MY BUGS, BOTH THE SAME ROOT CAUSE.
-- ----------------------------------------------------------------------------
-- I cannot execute plpgsql in this environment (see WHY A VERIFIER AT ALL,
-- below), and pglast — the only checker available to me — treats a dollar-quoted
-- body as an OPAQUE STRING. So it proves the file is valid SQL and validates
-- nothing inside the DO block. Two runtime bugs reached Michael because of that,
-- and both are recorded here rather than quietly fixed:
--
-- v2 FAILED WITH: ERROR 22P02: malformed array literal:
--                 "PASS  05 FOURTH level is refused"
-- The report accumulated into `res text[]`, and `res || 'PASS ...'` with an
-- UNTYPED literal makes Postgres prefer `anyarray || anyarray` over
-- `anyarray || anyelement` — so it tried to parse the sentence as an array
-- literal. Checks 01-04 passed only because they wrapped their text in
-- format(), which returns explicitly-typed text. A perfect illustration of the
-- house rule: the first four checks could not fail in a way that revealed the
-- bug, so they looked like evidence the mechanism worked.
-- FIXED by deleting the ambiguity rather than casting fifteen literals: `res` is
-- now plain `text` and entries are joined with a newline. There is no array.
--
-- v1 FAILED WITH: ERROR 42P01: relation "_verify" does not exist.
-- My bug, and an instructive one. It opened with BEGIN, created a
-- `CREATE TEMP TABLE _verify (...) ON COMMIT DROP`, and expected the whole
-- script to be one transaction. The Supabase SQL editor COMMITS PER STATEMENT,
-- so the temp table was created, committed, and dropped by its own ON COMMIT
-- DROP before the next statement ran — and the DO block then referenced a table
-- that no longer existed.
--
-- The same assumption made the trailing ROLLBACK decorative: had the DO block
-- succeeded, the fixtures would have been COMMITTED, leaving two throwaway
-- templates in the shared database. So the first version was not merely broken,
-- it was broken in the direction that writes. Hence this rewrite:
--
--   * EVERYTHING happens inside ONE plpgsql block, so it is atomic on its own
--     terms and needs nothing from the editor.
--   * The report accumulates in a variable, not a table.
--   * The block ends in RAISE EXCEPTION, which rolls back the whole block —
--     fixtures included — and prints the report.
--   * Every expected refusal is caught by a nested BEGIN/EXCEPTION, which rolls
--     back only that sub-block, exactly as a savepoint would.
--
-- NOTHING IS KEPT. If you want to prove that independently, run this after:
--   SELECT count(*) FROM nurock_diligence_templates WHERE slug LIKE 'zz-verify-groups-%';
--   SELECT count(*) FROM nurock_diligence_item_groups;
--
-- ----------------------------------------------------------------------------
-- WHY A VERIFIER AT ALL
-- ----------------------------------------------------------------------------
-- I could not execute the migration myself: the embedded PostgreSQL 17.10 in
-- nurock-underwriting starts its postmaster but every forked backend dies with
-- Windows 0xC0000142 (DLL init failure), and the stand-alone single-user backend
-- splits input on semicolons, which mangles dollar-quoted function bodies. So
-- the migration's SYNTAX is proven (pglast v8.4) and its BEHAVIOUR is not.
-- Constraints and triggers nobody has watched refuse anything are not yet known
-- to work.
--
-- EVERY LINE IN THE REPORT MUST READ PASS. Send me the output.
-- ============================================================================

DO $$
DECLARE
  res      text := '';
  n_fail   int := 0;
  v_tmpl   uuid;
  v_other  uuid;
  v_item   uuid;
  v_canon  uuid;
  v_l0     uuid;
  v_l1     uuid;
  v_l2     uuid;
  v_og     uuid;
  v_depth  int;
  v_n      int;
  v_txt    text;
BEGIN
  -- ==========================================================================
  -- Fixtures. Rolled back with everything else by the RAISE at the end.
  -- ==========================================================================
  INSERT INTO nurock_diligence_templates (slug, name, template_kind, is_canonical, is_active)
    VALUES ('zz-verify-groups-a', 'ZZ VERIFY GROUPS A', 'lender', false, false)
    RETURNING id INTO v_tmpl;
  INSERT INTO nurock_diligence_templates (slug, name, template_kind, is_canonical, is_active)
    VALUES ('zz-verify-groups-b', 'ZZ VERIFY GROUPS B', 'lender', false, false)
    RETURNING id INTO v_other;
  INSERT INTO nurock_diligence_items (template_id, item_number, category, title)
    VALUES (v_tmpl, 9001, 'imported', 'ZZ verify item')
    RETURNING id INTO v_item;

  -- ==========================================================================
  -- 1. depth is DERIVED, not supplied
  -- ==========================================================================
  INSERT INTO nurock_diligence_item_groups (template_id, label, code)
    VALUES (v_tmpl, 'Real Estate', '2') RETURNING id, depth INTO v_l0, v_depth;
  res := res || E'
' || format('%s  01 top-level group gets depth 0 (got %s)',
                       CASE WHEN v_depth = 0 THEN 'PASS' ELSE 'FAIL' END, v_depth);
  IF v_depth <> 0 THEN n_fail := n_fail + 1; END IF;

  INSERT INTO nurock_diligence_item_groups (template_id, parent_group_id, label, code)
    VALUES (v_tmpl, v_l0, 'Title', '2.a') RETURNING id, depth INTO v_l1, v_depth;
  res := res || E'
' || format('%s  02 subsection gets depth 1 (got %s)',
                       CASE WHEN v_depth = 1 THEN 'PASS' ELSE 'FAIL' END, v_depth);
  IF v_depth <> 1 THEN n_fail := n_fail + 1; END IF;

  INSERT INTO nurock_diligence_item_groups (template_id, parent_group_id, label)
    VALUES (v_tmpl, v_l1, 'Guarantor iii') RETURNING id, depth INTO v_l2, v_depth;
  res := res || E'
' || format('%s  03 third level gets depth 2 (got %s)',
                       CASE WHEN v_depth = 2 THEN 'PASS' ELSE 'FAIL' END, v_depth);
  IF v_depth <> 2 THEN n_fail := n_fail + 1; END IF;

  -- A caller-supplied depth must be OVERWRITTEN, never trusted.
  BEGIN
    INSERT INTO nurock_diligence_item_groups (template_id, parent_group_id, label, depth)
      VALUES (v_tmpl, v_l0, 'ZZ lying about depth', 0) RETURNING depth INTO v_depth;
    res := res || E'
' || format('%s  04 caller-supplied depth is overridden (got %s)',
                         CASE WHEN v_depth = 1 THEN 'PASS' ELSE 'FAIL' END, v_depth);
    IF v_depth <> 1 THEN n_fail := n_fail + 1; END IF;
  EXCEPTION WHEN others THEN
    res := res || E'
' || format('FAIL  04 caller-supplied depth is overridden -> %s', SQLERRM);
    n_fail := n_fail + 1;
  END;

  -- ==========================================================================
  -- 2. The ceiling refuses a fourth level
  -- ==========================================================================
  BEGIN
    INSERT INTO nurock_diligence_item_groups (template_id, parent_group_id, label)
      VALUES (v_tmpl, v_l2, 'ZZ too deep');
    res := res || E'
' || 'FAIL  05 FOURTH level is refused -> the insert SUCCEEDED';
    n_fail := n_fail + 1;
  EXCEPTION WHEN others THEN
    IF SQLERRM ILIKE '%at most three levels%' THEN
      res := res || E'
' || 'PASS  05 FOURTH level is refused';
    ELSE
      res := res || E'
' || format('FAIL  05 refused, but with the wrong error -> %s', SQLERRM);
      n_fail := n_fail + 1;
    END IF;
  END;

  -- ==========================================================================
  -- 3. Cycles are refused. A rendering path that can hang is worse than a
  --    rejected write.
  -- ==========================================================================
  BEGIN
    UPDATE nurock_diligence_item_groups SET parent_group_id = id WHERE id = v_l0;
    res := res || E'
' || 'FAIL  06 self-parent is refused -> the update SUCCEEDED';
    n_fail := n_fail + 1;
  EXCEPTION WHEN others THEN
    res := res || E'
' || 'PASS  06 self-parent is refused';
  END;

  BEGIN
    UPDATE nurock_diligence_item_groups SET parent_group_id = v_l2 WHERE id = v_l0;
    res := res || E'
' || 'FAIL  07 ancestor cycle is refused -> the update SUCCEEDED';
    n_fail := n_fail + 1;
  EXCEPTION WHEN others THEN
    res := res || E'
' || 'PASS  07 ancestor cycle is refused';
  END;

  -- ==========================================================================
  -- 4. A packet cannot borrow another financier's structure
  -- ==========================================================================
  BEGIN
    INSERT INTO nurock_diligence_item_groups (template_id, parent_group_id, label)
      VALUES (v_other, v_l0, 'ZZ wrong template');
    res := res || E'
' || 'FAIL  08 cross-template parent is refused -> the insert SUCCEEDED';
    n_fail := n_fail + 1;
  EXCEPTION WHEN others THEN
    IF SQLERRM ILIKE '%parent belongs to template%' THEN
      res := res || E'
' || 'PASS  08 cross-template parent is refused';
    ELSE
      res := res || E'
' || format('FAIL  08 refused, but with the wrong error -> %s', SQLERRM);
      n_fail := n_fail + 1;
    END IF;
  END;

  INSERT INTO nurock_diligence_item_groups (template_id, label)
    VALUES (v_other, 'ZZ other template section') RETURNING id INTO v_og;
  BEGIN
    UPDATE nurock_diligence_items SET group_id = v_og WHERE id = v_item;
    res := res || E'
' || 'FAIL  09 item cannot join another template''s group -> the update SUCCEEDED';
    n_fail := n_fail + 1;
  EXCEPTION WHEN others THEN
    IF SQLERRM ILIKE '%belongs to template%' THEN
      res := res || E'
' || 'PASS  09 item cannot join another template''s group';
    ELSE
      res := res || E'
' || format('FAIL  09 refused, but with the wrong error -> %s', SQLERRM);
      n_fail := n_fail + 1;
    END IF;
  END;

  -- ==========================================================================
  -- 5. entity_role coherence — the ASK 2 hook must not accept nonsense
  -- ==========================================================================
  BEGIN
    INSERT INTO nurock_diligence_item_groups (template_id, label, is_entity_parameterized)
      VALUES (v_tmpl, 'ZZ repeats over nothing', true);
    res := res || E'
' || 'FAIL  10 parameterized group needs an entity_role -> the insert SUCCEEDED';
    n_fail := n_fail + 1;
  EXCEPTION WHEN others THEN
    res := res || E'
' || 'PASS  10 parameterized group needs an entity_role';
  END;

  BEGIN
    INSERT INTO nurock_diligence_item_groups (template_id, label, entity_role)
      VALUES (v_tmpl, 'ZZ role without repeating', 'guarantor');
    res := res || E'
' || 'FAIL  11 entity_role requires the flag -> the insert SUCCEEDED';
    n_fail := n_fail + 1;
  EXCEPTION WHEN others THEN
    res := res || E'
' || 'PASS  11 entity_role requires the flag';
  END;

  BEGIN
    INSERT INTO nurock_diligence_item_groups
      (template_id, label, is_entity_parameterized, entity_role)
      VALUES (v_tmpl, 'ZZ Guarantors', true, 'guarantor');
    res := res || E'
' || 'PASS  12 flag + role together is accepted';
  EXCEPTION WHEN others THEN
    res := res || E'
' || format('FAIL  12 flag + role together is accepted -> %s', SQLERRM);
    n_fail := n_fail + 1;
  END;

  -- ==========================================================================
  -- 6. A blank label is refused — a nameless section renders as a gap
  -- ==========================================================================
  BEGIN
    INSERT INTO nurock_diligence_item_groups (template_id, label) VALUES (v_tmpl, '   ');
    res := res || E'
' || 'FAIL  13 blank label is refused -> the insert SUCCEEDED';
    n_fail := n_fail + 1;
  EXCEPTION WHEN others THEN
    res := res || E'
' || 'PASS  13 blank label is refused';
  END;

  -- ==========================================================================
  -- 7. sort_order is NOT unique, so reordering is one plain UPDATE. The
  --    deliberate opposite of nurock_diligence_items.item_number, whose inline
  --    UNIQUE forces a three-step park-and-swap.
  -- ==========================================================================
  BEGIN
    INSERT INTO nurock_diligence_item_groups (template_id, label, sort_order)
      VALUES (v_tmpl, 'ZZ shares position A', 5), (v_tmpl, 'ZZ shares position B', 5);
    res := res || E'
' || 'PASS  14 two groups may share a sort_order';
  EXCEPTION WHEN others THEN
    res := res || E'
' || format('FAIL  14 two groups may share a sort_order -> %s', SQLERRM);
    n_fail := n_fail + 1;
  END;

  -- ==========================================================================
  -- 8. Deleting a section DETACHES its items and never deletes them, but does
  --    cascade to its own subsections.
  -- ==========================================================================
  UPDATE nurock_diligence_items SET group_id = v_l0 WHERE id = v_item;
  DELETE FROM nurock_diligence_item_groups WHERE id = v_l0;

  SELECT count(*) INTO v_n FROM nurock_diligence_items WHERE id = v_item;
  res := res || E'
' || format('%s  15 item SURVIVES deletion of its group (rows=%s)',
                       CASE WHEN v_n = 1 THEN 'PASS' ELSE 'FAIL' END, v_n);
  IF v_n <> 1 THEN n_fail := n_fail + 1; END IF;

  SELECT count(*) INTO v_n
    FROM nurock_diligence_items WHERE id = v_item AND group_id IS NULL;
  res := res || E'
' || format('%s  16 orphaned item''s group_id reset to NULL (rows=%s)',
                       CASE WHEN v_n = 1 THEN 'PASS' ELSE 'FAIL' END, v_n);
  IF v_n <> 1 THEN n_fail := n_fail + 1; END IF;

  SELECT count(*) INTO v_n
    FROM nurock_diligence_item_groups WHERE id IN (v_l1, v_l2);
  res := res || E'
' || format('%s  17 subsections cascade with their section (remaining=%s)',
                       CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);
  IF v_n <> 0 THEN n_fail := n_fail + 1; END IF;

  -- ==========================================================================
  -- 9. Grants and policies — structural, no fixtures needed
  -- ==========================================================================
  SELECT count(*), coalesce(string_agg(table_name || ':' || privilege_type, ', '), 'none')
    INTO v_n, v_txt
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND grantee = 'anon'
     AND table_name IN ('nurock_diligence_item_groups', 'nurock_diligence_items');
  res := res || E'
' || format('%s  18 anon holds NOTHING on both catalog tables (%s)',
                       CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_txt);
  IF v_n <> 0 THEN n_fail := n_fail + 1; END IF;

  SELECT count(*), coalesce(string_agg(table_name || ':' || grantee, ', '), 'none')
    INTO v_n, v_txt
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND privilege_type = 'TRUNCATE'
     AND grantee IN ('anon', 'authenticated')
     AND table_name IN ('nurock_diligence_item_groups', 'nurock_diligence_items');
  res := res || E'
' || format('%s  19 TRUNCATE granted to nobody (%s)',
                       CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_txt);
  IF v_n <> 0 THEN n_fail := n_fail + 1; END IF;

  -- Deliberate: the app never hard-deletes catalog items (removal is
  -- is_active=false), so DELETE must NOT be granted here.
  SELECT count(*) INTO v_n
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'nurock_diligence_items'
     AND privilege_type = 'DELETE' AND grantee = 'authenticated';
  res := res || E'
' || format('%s  20 items has NO DELETE grant, by design (found=%s)',
                       CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);
  IF v_n <> 0 THEN n_fail := n_fail + 1; END IF;

  SELECT count(*), coalesce(string_agg(policyname || '/' || cmd, ', '), 'none')
    INTO v_n, v_txt
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'nurock_diligence_item_groups';
  res := res || E'
' || format('%s  21 groups table has exactly two policies (%s)',
                       CASE WHEN v_n = 2 THEN 'PASS' ELSE 'FAIL' END, v_txt);
  IF v_n <> 2 THEN n_fail := n_fail + 1; END IF;

  SELECT count(*) INTO v_n
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'nurock_diligence_item_groups'
     AND cmd = 'ALL'
     AND (btrim(coalesce(qual, '')) = 'true'
          OR btrim(coalesce(with_check, '')) = 'true');
  res := res || E'
' || format('%s  22 no unconditional TRUE write predicate (found=%s)',
                       CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);
  IF v_n <> 0 THEN n_fail := n_fail + 1; END IF;

  -- Nothing in production may have been regrouped by the migration itself.
  SELECT count(*) INTO v_n
    FROM nurock_diligence_items i
    JOIN nurock_diligence_templates t ON t.id = i.template_id
   WHERE i.group_id IS NOT NULL AND t.slug NOT LIKE 'zz-verify-groups-%';
  res := res || E'
' || format('%s  23 no PRE-EXISTING item was grouped (found=%s)',
                       CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END, v_n);
  IF v_n <> 0 THEN n_fail := n_fail + 1; END IF;

  -- ==========================================================================
  -- Report, and roll everything back by raising.
  -- ==========================================================================
  RAISE EXCEPTION E'\n==== VERIFIER REPORT (% failed of 23) ====\n%\n==== END. This error is INTENTIONAL: it rolls back every fixture above, so nothing was written. ====',
    n_fail, res;
END $$;
