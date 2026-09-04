-- ============================================================================
-- PER-ENTITY DILIGENCE (ASK 2) — named entities, and items tracked per entity
-- ============================================================================
-- Michael runs this. Nobody else. Read docs/diligence-item-groups.md section 7
-- first: this migration ANSWERS the three questions that section left open, and
-- the answers are argued below so you can overrule any of them.
--
-- SCHEMA ONLY. No application code reads any of this yet, so applying it changes
-- nothing a user can see. The code that instantiates per-entity items follows in
-- its own commit.
--
-- ----------------------------------------------------------------------------
-- WHAT THIS IS FOR
-- ----------------------------------------------------------------------------
-- A per-entity block IS a group that repeats per named entity. PNC's checklist
-- has, under section 1 alone: the partnership; a GP tier (b, b1, b2, b3, b3.1);
-- developers c1-c3; the sponsor; and guarantors i, ii, iii — each with its OWN
-- item list. You do not approve "guarantor financials" once. You approve
-- guarantor i's, then ii's, then iii's, and a deal is not closed until each is
-- done.
--
-- 20260903_diligence_item_groups.sql already declared the template side
-- (is_entity_parameterized + entity_role) precisely so this migration adds only
-- the deal side rather than a second round of template surgery.
--
-- ============================================================================
-- THE THREE DECISIONS, AND WHY
-- ============================================================================
--
-- Q1. WHAT IS THE ENTITY-ROLE VOCABULARY?
--     ANSWER: a SEEDED CATALOG TABLE. Not a CHECK constraint, not free text.
--
--     The question as I posed it was a false choice: "a fixed list is checkable
--     and will be wrong for some lender; free text always fits and can never be
--     reported on consistently." A catalog table dissolves it. Roles are ROWS,
--     so adding "co-developer" for one lender is an INSERT Michael can do
--     without a migration — but the foreign key keeps the set consistent, so
--     "show me every guarantor across the portfolio" stays answerable. Free text
--     would have made that query return "Guarantor", "guarantor", "Guarantor
--     (individual)" and "GUARANTOR" as four different things.
--
--     Seeded with the LIHTC set PNC's structure implies. Extend by INSERT.
--
-- Q2. ARE ENTITIES PER-DEAL OR REUSABLE ACROSS DEALS?
--     ANSWER: REUSABLE — an org-level catalog plus a per-deal join.
--
--     "Every deal this guarantor is on" is a real CFO question, and LIHTC
--     sponsors and guarantors genuinely recur across a portfolio; the same two
--     or three principals guarantee many deals. Nine copies of one guarantor
--     cannot answer that question at all.
--
--     THE COST I ACCEPTED, stated plainly: reuse needs someone to notice that
--     "Smith Family Trust" and "The Smith Family Trust" are the same entity, and
--     nothing here forces that. It is mitigated rather than solved:
--     dm_diligence_deal_entities carries display_name, so when a deal's
--     paperwork names an entity differently you override the label WITHOUT
--     forking the underlying entity. If duplicates accumulate anyway, merging is
--     a later problem with a small blast radius — the join is the only thing
--     pointing at an entity.
--
-- Q3. DO ENTITY ITEMS GET THEIR OWN SIGN-OFF CHAIN?
--     ANSWER: YES. dm_diligence_deal_items grows entity_id.
--
--     THIS IS THE EXPENSIVE ONE AND THE ONE TO OVERRULE IF ANY. I chose it
--     because the source document answers it: PNC lists guarantors i/ii/iii as
--     separate blocks with separate items, which only means anything if each is
--     tracked, assigned, documented and signed off separately. A display-only
--     entity — the cheap alternative — would render three headings over ONE
--     shared item, so approving it for guarantor i would mark it approved for
--     all three. That is a false record on a cost-certification-adjacent
--     checklist.
--
--     dm_diligence_signoffs already keys on deal_item_id, so per-entity items
--     get their own chains with NO change to the sign-off tables. That is the
--     payoff for putting the dimension on the spine rather than beside it.
--
--     IF YOU OVERRULE: leave the column, stop the code from populating it. The
--     column is nullable and every existing row stays NULL, so display-only
--     remains reachable without reverting anything.
--
-- ============================================================================
-- THE NULL TRAP, WHICH IS THE WHOLE REASON Q3 NEEDED A MIGRATION AND NOT A PATCH
-- ============================================================================
-- The spine is UNIQUE (deal_id, item_id). Adding entity_id to that constraint
-- would be a silent data-integrity failure: POSTGRES TREATS NULLS AS DISTINCT IN
-- A UNIQUE CONSTRAINT, so every non-entity row (entity_id NULL — which is all
-- 62 of them today, and all of them forever on non-entity items) would permit
-- UNLIMITED DUPLICATES. ensureDealItems is self-healing and runs on every
-- diligence page load, so it would have inserted a fresh duplicate set on each
-- page view until the table was unusable.
--
-- Two PARTIAL unique indexes instead, which say what they mean:
--     one row per (deal, item) when there is no entity
--     one row per (deal, item, entity) when there is
-- UNIQUE NULLS NOT DISTINCT would also work on PG 15+, but the partial pair is
-- version-proof and self-documenting.
--
-- ============================================================================
-- AND GRANTS ARE EXPLICIT ON ALL THREE NEW TABLES
-- ============================================================================
-- Twice this week a permissive policy with NO GRANT has cost a round: the items
-- DELETE ("permission denied for table", 2026-09-03) and the crosswalk, which
-- 0082 created with a FOR ALL USING (true) policy and no grant at all. A POLICY
-- NEVER CONFERS A PRIVILEGE. So every table below gets both, anon is revoked,
-- TRUNCATE is revoked, and the file ends in NOTIFY pgrst — the line 0082 omitted,
-- which is the leading explanation for the crosswalk being invisible for months.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.nurock_diligence_item_groups') IS NULL THEN
    RAISE EXCEPTION
      'ABORTING: nurock_diligence_item_groups missing. Apply '
      '20260903_diligence_item_groups.sql first.';
  END IF;
  IF to_regclass('public.dm_diligence_deal_items') IS NULL THEN
    RAISE EXCEPTION 'ABORTING: dm_diligence_deal_items missing. Apply 0081 first.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('app_can','app_is_org_admin')
  ) THEN
    RAISE EXCEPTION
      'ABORTING: app_can()/app_is_org_admin() missing. Apply 0075 and 0079 first.';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. The role vocabulary (Q1). Rows, not a CHECK — extend by INSERT.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nurock_diligence_entity_roles (
  key         text PRIMARY KEY CHECK (btrim(key) <> ''),
  label       text NOT NULL CHECK (btrim(label) <> ''),
  -- What this role is, in LIHTC terms, so the next reader does not guess.
  description text,
  sort_order  int  NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO nurock_diligence_entity_roles (key, label, description, sort_order)
VALUES
  ('ownership',   'Ownership Entity',  'The LP or LLC that owns the project.', 10),
  ('general_partner','General Partner','GP / managing member, including tiered GP structures.', 20),
  ('developer',   'Developer',         'Developer entities; a deal may have several.', 30),
  ('sponsor',     'Sponsor',           'Sponsor / principal behind the development.', 40),
  ('guarantor',   'Guarantor',         'Guarantors of completion, operating deficit or recapture.', 50),
  ('contractor',  'General Contractor','The GC named in the construction contract.', 60),
  ('management',  'Management Agent',  'Property management company.', 70)
ON CONFLICT (key) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2. Named entities, ORG-LEVEL so they can be reused across deals (Q2).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nurock_diligence_entities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The entity's canonical legal name.
  name        text NOT NULL CHECK (btrim(name) <> ''),
  role_key    text NOT NULL REFERENCES nurock_diligence_entity_roles(key),
  notes       text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Case-insensitive uniqueness PER ROLE, not globally: the same person can be
-- both a sponsor and a guarantor, and those are two entities with two different
-- document sets. Case-insensitive because a spreadsheet will supply both
-- "Smith Family Trust" and "SMITH FAMILY TRUST".
CREATE UNIQUE INDEX IF NOT EXISTS idx_nde_name_role
  ON nurock_diligence_entities (lower(btrim(name)), role_key);

DROP TRIGGER IF EXISTS trg_nde_updated_at ON nurock_diligence_entities;
CREATE TRIGGER trg_nde_updated_at
  BEFORE UPDATE ON nurock_diligence_entities
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----------------------------------------------------------------------------
-- 3. Which entities are on which deal, and in what order.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dm_diligence_deal_entities (
  deal_id      text NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  entity_id    uuid NOT NULL REFERENCES nurock_diligence_entities(id) ON DELETE RESTRICT,
  -- Per-deal label override. The mitigation for the reuse cost in Q2: when a
  -- deal's paperwork names an entity differently, override the label here rather
  -- than forking the entity and losing the cross-deal link.
  display_name text,
  -- Guarantor i / ii / iii ordering is meaningful and comes from the lender's
  -- document, so it is stored rather than derived from a name sort.
  sort_order   int NOT NULL DEFAULT 0,
  added_by     uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (deal_id, entity_id)
);

-- ON DELETE RESTRICT above, deliberately: removing an entity from the CATALOG
-- while a deal still names it would orphan that deal's tracked items. Remove it
-- from the deal first, or deactivate it (is_active = false).

CREATE INDEX IF NOT EXISTS idx_dmdde_deal
  ON dm_diligence_deal_entities (deal_id, sort_order);

-- ----------------------------------------------------------------------------
-- 4. The spine grows an entity dimension (Q3), and the NULL trap is handled.
-- ----------------------------------------------------------------------------
ALTER TABLE dm_diligence_deal_items
  ADD COLUMN IF NOT EXISTS entity_id uuid
    REFERENCES nurock_diligence_entities(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_dmddi_entity
  ON dm_diligence_deal_items (entity_id);

-- THE EXISTING CONSTRAINT MUST GO, and be replaced by the partial pair. Dropped
-- by looking it up rather than by a guessed name: 0081 declared
-- `UNIQUE (deal_id, item_id)` inline, so the constraint name is
-- system-generated and guessing it would silently leave the old rule in force
-- alongside the new ones.
DO $$
DECLARE c text;
BEGIN
  SELECT con.conname INTO c
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
   WHERE rel.relname = 'dm_diligence_deal_items'
     AND con.contype = 'u'
     -- ::text ON BOTH SIDES. pg_attribute.attname is type `name`, so
     -- array_agg yields name[] and there is NO name[] = text[] operator --
     -- "operator does not exist: name[] = text[]", which is how the first
     -- version of this migration aborted. pglast cannot see it: it is a type
     -- resolution failure, not a syntax error.
     AND (SELECT array_agg(att.attname::text ORDER BY att.attname::text)
            FROM unnest(con.conkey) k
            JOIN pg_attribute att
              ON att.attrelid = con.conrelid AND att.attnum = k)
         = ARRAY['deal_id','item_id']::text[]
   LIMIT 1;
  IF c IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE public.dm_diligence_deal_items DROP CONSTRAINT %I', c);
    RAISE NOTICE 'Dropped the (deal_id, item_id) unique constraint: %', c;
  ELSE
    RAISE NOTICE 'No (deal_id, item_id) unique constraint found — already replaced?';
  END IF;
END $$;

-- One row per (deal, item) when there is NO entity. This is the rule that used
-- to be the constraint, and it must keep holding for every existing row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_dmddi_deal_item_no_entity
  ON dm_diligence_deal_items (deal_id, item_id)
  WHERE entity_id IS NULL;

-- One row per (deal, item, entity) when there is one.
CREATE UNIQUE INDEX IF NOT EXISTS idx_dmddi_deal_item_entity
  ON dm_diligence_deal_items (deal_id, item_id, entity_id)
  WHERE entity_id IS NOT NULL;

-- An entity-scoped item must name an entity that is actually ON that deal.
-- Enforced by trigger because a CHECK cannot join.
CREATE OR REPLACE FUNCTION dm_diligence_item_entity_on_deal()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.entity_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM dm_diligence_deal_entities de
     WHERE de.deal_id = NEW.deal_id AND de.entity_id = NEW.entity_id
  ) THEN
    RAISE EXCEPTION
      'Entity % is not on deal % — add it to the deal before tracking items for it.',
      NEW.entity_id, NEW.deal_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_dmddi_entity_on_deal ON dm_diligence_deal_items;
CREATE TRIGGER trg_dmddi_entity_on_deal
  BEFORE INSERT OR UPDATE OF entity_id, deal_id ON dm_diligence_deal_items
  FOR EACH ROW EXECUTE FUNCTION dm_diligence_item_entity_on_deal();

-- ----------------------------------------------------------------------------
-- 5. The template side's entity_role becomes a real reference.
-- ----------------------------------------------------------------------------
-- 20260903 declared entity_role as free text because the vocabulary was not
-- decided. Q1 decides it, so the column gets its FK. Safe today: no UI can set
-- is_entity_parameterized, so no row carries a role — but the pre-flight below
-- refuses rather than assuming that.
DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad
    FROM nurock_diligence_item_groups g
   WHERE g.entity_role IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM nurock_diligence_entity_roles r WHERE r.key = g.entity_role
     );
  IF bad > 0 THEN
    RAISE EXCEPTION
      'ABORTING: % group(s) carry an entity_role outside the new catalog. '
      'INSERT the missing roles into nurock_diligence_entity_roles first, then '
      're-run. Nothing was changed.', bad;
  END IF;
END $$;

ALTER TABLE nurock_diligence_item_groups
  DROP CONSTRAINT IF EXISTS nurock_diligence_item_groups_entity_role_fk;
ALTER TABLE nurock_diligence_item_groups
  ADD CONSTRAINT nurock_diligence_item_groups_entity_role_fk
  FOREIGN KEY (entity_role) REFERENCES nurock_diligence_entity_roles(key);

-- ----------------------------------------------------------------------------
-- 6. RLS + GRANTS on all three new tables. Both. Always.
-- ----------------------------------------------------------------------------
ALTER TABLE nurock_diligence_entity_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE nurock_diligence_entities     ENABLE ROW LEVEL SECURITY;
ALTER TABLE dm_diligence_deal_entities    ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT tablename, policyname FROM pg_policies
            WHERE schemaname = 'public'
              AND tablename IN ('nurock_diligence_entity_roles',
                                'nurock_diligence_entities',
                                'dm_diligence_deal_entities')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, p.tablename);
  END LOOP;
END $$;

-- The role vocabulary is reference data: read by anyone signed in, written by an
-- org admin only. Adding a role changes what the whole platform can express, so
-- it is not an ordinary editing action.
CREATE POLICY nurock_diligence_entity_roles_sel ON nurock_diligence_entity_roles
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY nurock_diligence_entity_roles_wr ON nurock_diligence_entity_roles
  FOR ALL TO authenticated
  USING      (app_is_org_admin(auth.uid()))
  WITH CHECK (app_is_org_admin(auth.uid()));

-- Entities and their deal assignments are ordinary diligence editing, so the
-- predicate mirrors assertDiligenceCan — app and database agree.
CREATE POLICY nurock_diligence_entities_sel ON nurock_diligence_entities
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY nurock_diligence_entities_wr ON nurock_diligence_entities
  FOR ALL TO authenticated
  USING      (app_can('diligence','edit') OR app_can('devmgmt','edit') OR app_is_org_admin(auth.uid()))
  WITH CHECK (app_can('diligence','edit') OR app_can('devmgmt','edit') OR app_is_org_admin(auth.uid()));

CREATE POLICY dm_diligence_deal_entities_sel ON dm_diligence_deal_entities
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY dm_diligence_deal_entities_wr ON dm_diligence_deal_entities
  FOR ALL TO authenticated
  USING      (app_can('diligence','edit') OR app_can('devmgmt','edit') OR app_is_org_admin(auth.uid()))
  WITH CHECK (app_can('diligence','edit') OR app_can('devmgmt','edit') OR app_is_org_admin(auth.uid()));

REVOKE ALL ON public.nurock_diligence_entity_roles FROM anon;
REVOKE ALL ON public.nurock_diligence_entity_roles FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.nurock_diligence_entity_roles TO authenticated;

REVOKE ALL ON public.nurock_diligence_entities FROM anon;
REVOKE ALL ON public.nurock_diligence_entities FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.nurock_diligence_entities TO authenticated;

REVOKE ALL ON public.dm_diligence_deal_entities FROM anon;
REVOKE ALL ON public.dm_diligence_deal_entities FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dm_diligence_deal_entities TO authenticated;

COMMENT ON TABLE public.nurock_diligence_entity_roles IS
  'The entity-role vocabulary: ownership, general_partner, developer, sponsor, '
  'guarantor, contractor, management. A TABLE rather than a CHECK so a new role '
  'is an INSERT and not a migration, while the FK keeps "every guarantor across '
  'the portfolio" answerable. Org-admin write: adding a role changes what the '
  'platform can express.';

COMMENT ON TABLE public.nurock_diligence_entities IS
  'Named entities, ORG-LEVEL so one guarantor referenced by nine deals is one '
  'row — which is what makes "every deal this guarantor is on" answerable. '
  'Unique per (lower(name), role) because the same person can be both sponsor '
  'and guarantor, and those carry different document sets.';

COMMENT ON COLUMN public.dm_diligence_deal_items.entity_id IS
  'The named entity this tracked item belongs to; NULL for every non-entity item '
  '(all of them today). Per-entity items get their OWN sign-off chain for free, '
  'because dm_diligence_signoffs keys on deal_item_id. NOTE the two PARTIAL '
  'unique indexes rather than one constraint: Postgres treats NULLs as distinct, '
  'so folding entity_id into UNIQUE (deal_id, item_id) would have let '
  'ensureDealItems insert a duplicate set on every page load.';

NOTIFY pgrst, 'reload schema';

COMMIT;
