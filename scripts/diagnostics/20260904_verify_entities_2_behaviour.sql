-- ============================================================================
-- VERIFY ENTITIES — 2 of 2: BEHAVIOUR
-- ============================================================================
-- *** IT ENDS BY RAISING AN ERROR. THAT IS THE DESIGN. ***
-- The error message IS the report, and raising is what rolls back the fixtures
-- this creates. Nothing is kept. Read the first line: it states the verdict in
-- words before any detail.
--
-- Run AFTER 20260904_diligence_entities.sql. Presupposes it applied — unlike
-- script 1, which is catalog-only and works either way.
--
-- CHECK 5 IS THE ONE THAT MATTERS. It proves the NULL trap is actually closed:
-- that a second non-entity row for the same (deal, item) is REFUSED, while the
-- same item for two DIFFERENT entities is ALLOWED. Get that wrong and
-- ensureDealItems — which runs on every diligence page load and is self-healing
-- by design — inserts a fresh duplicate set every time anyone opens the page.
-- ============================================================================

DO $$
DECLARE
  msg    text := '';
  fails  int  := 0;
  v_deal text;
  v_item uuid;
  v_e1   uuid;
  v_e2   uuid;
  v_e3   uuid;
  n      int;
BEGIN
  -- ==========================================================================
  -- 0. Seeded vocabulary (moved here from script 1: reading the table is a
  --    parse-time reference, so it cannot live in a script that must work
  --    before the migration).
  -- ==========================================================================
  SELECT count(*) INTO n FROM nurock_diligence_entity_roles
   WHERE key IN ('ownership','general_partner','developer','sponsor',
                 'guarantor','contractor','management');
  msg := msg || format(E'\n%s  0 the seven roles are seeded (got %s)',
                       CASE WHEN n = 7 THEN 'PASS' ELSE 'FAIL' END, n);
  IF n <> 7 THEN fails := fails + 1; END IF;

  SELECT count(*) INTO n FROM dm_diligence_deal_items WHERE entity_id IS NOT NULL;
  msg := msg || format(E'\n%s  1 no PRE-EXISTING deal item was given an entity (got %s)',
                       CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END, n);
  IF n <> 0 THEN fails := fails + 1; END IF;

  -- ==========================================================================
  -- Fixtures. A throwaway deal so nothing real is touched, plus two entities.
  -- ==========================================================================
  v_deal := 'zz_verify_entities_' || substr(md5(random()::text), 1, 8);
  INSERT INTO deals (id, name, stage)
    VALUES (v_deal, 'ZZ VERIFY ENTITIES', 'underwriting');

  -- Any existing catalog item will do as the thing being tracked.
  SELECT id INTO v_item FROM nurock_diligence_items WHERE is_active LIMIT 1;
  IF v_item IS NULL THEN
    RAISE EXCEPTION 'ABORTING: no active catalog item to test with.';
  END IF;

  INSERT INTO nurock_diligence_entities (name, role_key)
    VALUES ('ZZ Verify Guarantor One', 'guarantor') RETURNING id INTO v_e1;
  INSERT INTO nurock_diligence_entities (name, role_key)
    VALUES ('ZZ Verify Guarantor Two', 'guarantor') RETURNING id INTO v_e2;

  -- ==========================================================================
  -- 2. The role vocabulary is enforced
  -- ==========================================================================
  BEGIN
    INSERT INTO nurock_diligence_entities (name, role_key)
      VALUES ('ZZ Verify Bad Role', 'not_a_real_role');
    msg := msg || format(E'\nFAIL  2 unknown role refused -> the insert SUCCEEDED');
    fails := fails + 1;
  EXCEPTION WHEN others THEN
    msg := msg || format(E'\nPASS  2 an unknown entity role is refused');
  END;

  -- ==========================================================================
  -- 3. Same name, same role = one entity. Same name, DIFFERENT role = two.
  -- ==========================================================================
  BEGIN
    INSERT INTO nurock_diligence_entities (name, role_key)
      VALUES ('zz verify guarantor one', 'guarantor');  -- different case
    msg := msg || format(E'\nFAIL  3 duplicate name+role refused -> the insert SUCCEEDED');
    fails := fails + 1;
  EXCEPTION WHEN others THEN
    msg := msg || format(E'\nPASS  3 duplicate name+role refused (case-insensitively)');
  END;

  BEGIN
    INSERT INTO nurock_diligence_entities (name, role_key)
      VALUES ('ZZ Verify Guarantor One', 'sponsor');
    msg := msg || format(E'\nPASS  4 same name in a DIFFERENT role is allowed');
  EXCEPTION WHEN others THEN
    msg := msg || format(E'\nFAIL  4 same name, different role -> %s', SQLERRM);
    fails := fails + 1;
  END;

  -- ==========================================================================
  -- 5. *** THE NULL TRAP. The reason this needed a migration. ***
  -- ==========================================================================
  INSERT INTO dm_diligence_deal_items (deal_id, item_id) VALUES (v_deal, v_item);
  BEGIN
    INSERT INTO dm_diligence_deal_items (deal_id, item_id) VALUES (v_deal, v_item);
    msg := msg || format(E'\nFAIL  5a DUPLICATE non-entity row was ACCEPTED — the partial index is missing or non-partial. ensureDealItems would duplicate on every page load.');
    fails := fails + 1;
  EXCEPTION WHEN others THEN
    msg := msg || format(E'\nPASS  5a a second non-entity row for the same (deal,item) is refused');
  END;

  -- Now attach the deal's entities and prove per-entity rows ARE allowed.
  INSERT INTO dm_diligence_deal_entities (deal_id, entity_id, sort_order)
    VALUES (v_deal, v_e1, 0), (v_deal, v_e2, 1);
  BEGIN
    INSERT INTO dm_diligence_deal_items (deal_id, item_id, entity_id)
      VALUES (v_deal, v_item, v_e1), (v_deal, v_item, v_e2);
    msg := msg || format(E'\nPASS  5b the SAME item for TWO different entities is allowed');
  EXCEPTION WHEN others THEN
    msg := msg || format(E'\nFAIL  5b per-entity rows refused -> %s', SQLERRM);
    fails := fails + 1;
  END;

  BEGIN
    INSERT INTO dm_diligence_deal_items (deal_id, item_id, entity_id)
      VALUES (v_deal, v_item, v_e1);
    msg := msg || format(E'\nFAIL  5c duplicate (deal,item,entity) was ACCEPTED');
    fails := fails + 1;
  EXCEPTION WHEN others THEN
    msg := msg || format(E'\nPASS  5c a duplicate (deal,item,entity) is refused');
  END;

  -- ==========================================================================
  -- 6. An entity-scoped item must name an entity ON that deal
  -- ==========================================================================
  BEGIN
    INSERT INTO nurock_diligence_entities (name, role_key)
      VALUES ('ZZ Verify Not On Deal', 'sponsor') RETURNING id INTO v_e3;
    BEGIN
      INSERT INTO dm_diligence_deal_items (deal_id, item_id, entity_id)
        VALUES (v_deal, v_item, v_e3);
      msg := msg || format(E'\nFAIL  6 an entity not on the deal was ACCEPTED');
      fails := fails + 1;
    EXCEPTION WHEN others THEN
      IF SQLERRM ILIKE '%not on deal%' THEN
        msg := msg || format(E'\nPASS  6 an entity not on the deal is refused');
      ELSE
        msg := msg || format(E'\nFAIL  6 refused with the WRONG error -> %s', SQLERRM);
        fails := fails + 1;
      END IF;
    END;
  END;

  -- ==========================================================================
  -- 7. A catalog entity still named by a deal cannot be deleted
  -- ==========================================================================
  BEGIN
    DELETE FROM nurock_diligence_entities WHERE id = v_e1;
    msg := msg || format(E'\nFAIL  7 deleting an in-use entity was ACCEPTED — a deal would be left with orphaned items');
    fails := fails + 1;
  EXCEPTION WHEN others THEN
    msg := msg || format(E'\nPASS  7 deleting an entity a deal still names is refused');
  END;

  -- ==========================================================================
  -- 8. Sign-off chains come free: they key on deal_item_id, so two per-entity
  --    items are two independent chains with no signoff-table change at all.
  -- ==========================================================================
  SELECT count(*) INTO n
    FROM dm_diligence_deal_items
   WHERE deal_id = v_deal AND item_id = v_item;
  msg := msg || format(E'\n%s  8 one item now tracked 3 ways: unscoped + 2 entities (got %s)',
                       CASE WHEN n = 3 THEN 'PASS' ELSE 'FAIL' END, n);
  IF n <> 3 THEN fails := fails + 1; END IF;

  RAISE EXCEPTION E'\n%\n%\n(end of ENTITIES BEHAVIOUR)',
    CASE WHEN fails = 0
      THEN '*** ALL CHECKS PASSED. The Postgres error you are reading IS the intended rollback — the throwaway deal and entities are gone. ***'
      ELSE format('*** %s CHECK(S) FAILED. Read the FAIL lines below. ***', fails)
    END,
    msg;
END $$;
