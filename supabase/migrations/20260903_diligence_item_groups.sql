-- ============================================================================
-- TEMPLATE-OWNED ITEM GROUPS (ASK 6) — sections and subsections that belong to
-- the financier's own checklist, not to NuRock's 15 categories.
-- ============================================================================
-- Michael runs this. Nobody else. Read the design doc first:
--   docs/diligence-item-groups.md
--
-- ----------------------------------------------------------------------------
-- THE PROBLEM, MEASURED
-- ----------------------------------------------------------------------------
-- The add/edit item form offers exactly 15 category options and nothing else —
-- they are the canonical NuRock 59-item checklist's own headers, hardcoded in
-- src/lib/diligence/categories.ts. There is no free-text field and no
-- create-new-category control.
--
-- So a financier packet cannot carry the financier's own section names. The PNC
-- DD Checklist has 12 numbered top-level sections, a second level beneath them
-- (section 2 Real Estate -> Title / Survey / Flood / Site Control / Zoning;
-- section 7 Construction Documents -> eight subsections a-h), and a third
-- per-entity level under section 1 (partnership; GP tier b/b1/b2/b3/b3.1;
-- developers c1-c3; sponsor; guarantors i-iii) — 329 items. NONE of PNC's 12
-- section names exist in the 15-category list. Importing that file today forces
-- all 329 items into NuRock categories that do not match the lender's structure
-- and the packet reads as a flat list. It is also why the importer can only map
-- the item-title column: the Section column has nowhere to land.
--
-- ----------------------------------------------------------------------------
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
-- ----------------------------------------------------------------------------
-- 1. IT DOES NOT TOUCH `category`, AND IT DOES NOT TOUCH COVERAGE. Coverage is
--    computed from nurock_diligence_crosswalk (mapped external items stay
--    virtual; their coverage flows through the canonical item they map to).
--    Groups are ORGANISATIONAL — how a packet is laid out for a reader. Wiring
--    presentation into the coverage denominator is how one quantity ends up
--    computed two ways, which is this platform's most expensive recurring
--    defect. `category` keeps its present meaning: the canonical LIHTC grouping.
--
-- 2. IT ADDS NO SECOND ORDERING SOURCE. Item order stays `item_number`, which is
--    already unique per template. A grouped checklist orders by (group position,
--    item_number). A per-group position column would be a second source of
--    truth for one fact, and the two would drift.
--
-- 3. IT PUTS NO UNIQUE CONSTRAINT ON group sort_order — learned directly from
--    nurock_diligence_items, whose inline UNIQUE (template_id, item_number) is
--    non-deferrable and therefore makes a simple two-row swap illegal. Reordering
--    items needs a three-step park-and-swap because of it. Group sort_order is
--    deliberately NON-unique so reordering a group is one plain UPDATE with no
--    collision class at all. Ties break on label, so ordering stays
--    deterministic.
--
-- 4. IT IS FULLY BACKWARD COMPATIBLE. group_id is NULLABLE and every existing
--    row stays NULL, so the canonical 59-item checklist and both existing
--    imports render exactly as they do today. Grouping is opt-in per template.
--
-- ----------------------------------------------------------------------------
-- GRANTS ARE NOT OPTIONAL, AND THIS IS WHY THEY ARE SPELLED OUT BELOW
-- ----------------------------------------------------------------------------
-- On 2026-09-03 every attempted hard delete of a checklist item failed with
-- "permission denied for table nurock_diligence_items" — as ORG ADMIN, in a
-- session where INSERT and UPDATE had just succeeded. Cause: 0081 created
-- `nurock_diligence_items_all ... FOR ALL USING (true)` and NO GRANT anywhere.
-- A POLICY NEVER CONFERS A PRIVILEGE. A permissive FOR ALL policy is inert
-- without a table-level grant, so `authenticated` held whatever Supabase's
-- defaults gave it and nothing more.
--
-- Every new object here therefore gets BOTH an explicit policy AND an explicit
-- grant, and TRUNCATE is revoked because row security does not filter it.
--
-- The write predicate mirrors assertDiligenceCan() in src/lib/auth/access.ts —
-- diligence role OR devmgmt role OR org admin — so the application and the
-- database agree rather than disagreeing in ways that surface only as a silent
-- empty screen. This app's route gate admits all three.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- PRE-FLIGHT. Nothing is changed if any dependency is missing.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.nurock_diligence_templates') IS NULL THEN
    RAISE EXCEPTION 'ABORTING: nurock_diligence_templates missing. Apply 0081 first.';
  END IF;
  IF to_regclass('public.nurock_diligence_items') IS NULL THEN
    RAISE EXCEPTION 'ABORTING: nurock_diligence_items missing. Apply 0081 first.';
  END IF;
  -- Both helpers are dependencies of the write predicate. 0079 defines them
  -- SECURITY DEFINER; a policy calling a non-definer helper recurses through
  -- app_user_roles' own policy ("infinite recursion detected"), the failure
  -- 0077's header warns about.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'app_can'
  ) THEN
    RAISE EXCEPTION
      'ABORTING: app_can() missing. Apply 0075 and 0079 first. Nothing changed.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'app_is_org_admin'
  ) THEN
    RAISE EXCEPTION
      'ABORTING: app_is_org_admin() missing. Apply 0079 first. Nothing changed.';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. The groups table.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nurock_diligence_item_groups (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id     uuid NOT NULL
                    REFERENCES nurock_diligence_templates(id) ON DELETE CASCADE,
  -- NULL = a top-level section. CASCADE so removing a section removes its
  -- subsections; items are detached rather than deleted (see group_id below).
  parent_group_id uuid
                    REFERENCES nurock_diligence_item_groups(id) ON DELETE CASCADE,
  -- The financier's OWN wording. Free text on purpose — "Real Estate",
  -- "Construction Documents", "Guarantor Financials". Never validated against
  -- the canonical 15 categories; that is the entire point.
  label           text NOT NULL CHECK (btrim(label) <> ''),
  -- The financier's own numbering, verbatim: '2', '7.a', 'b3.1', 'iii'. Kept as
  -- text and never parsed — lender numbering is not arithmetic, and a packet
  -- must be able to echo the source document exactly.
  code            text,
  -- Maintained by trigger: 0 = top level, 1 = subsection, 2 = third level.
  -- Capped at 2 so rendering recursion is bounded and a template cannot grow a
  -- structure the UI has no way to show.
  depth           int  NOT NULL DEFAULT 0 CHECK (depth BETWEEN 0 AND 2),
  -- NON-UNIQUE, deliberately. See note 3 in the header.
  sort_order      int  NOT NULL DEFAULT 0,
  -- ASK 2 HOOK, INERT UNTIL THE ENTITY LAYER SHIPS. A group flagged here is a
  -- BLOCK THAT REPEATS ONCE PER NAMED ENTITY of `entity_role` (PNC's guarantors
  -- i-iii, developers c1-c3, the GP tier). Declaring the intent now costs one
  -- boolean and one text column and means the entity migration adds the deal
  -- side only, not a second round of template surgery. NOTHING READS THESE YET
  -- — see docs/diligence-item-groups.md section 7 for the open questions that
  -- have to be answered before they mean anything.
  is_entity_parameterized boolean NOT NULL DEFAULT false,
  entity_role     text,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- A group cannot be its own parent. Deeper cycles are caught by the trigger.
  CONSTRAINT nurock_diligence_item_groups_no_self
    CHECK (parent_group_id IS NULL OR parent_group_id <> id),
  -- entity_role is meaningless unless the group actually repeats, and a
  -- repeating group with no role has nothing to repeat over.
  CONSTRAINT nurock_diligence_item_groups_entity_role_chk
    CHECK (
      (is_entity_parameterized AND entity_role IS NOT NULL AND btrim(entity_role) <> '')
      OR (NOT is_entity_parameterized AND entity_role IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_nddg_template_sort
  ON nurock_diligence_item_groups (template_id, sort_order, label);
CREATE INDEX IF NOT EXISTS idx_nddg_parent
  ON nurock_diligence_item_groups (parent_group_id);

-- ----------------------------------------------------------------------------
-- 2. Depth + cycle enforcement.
-- ----------------------------------------------------------------------------
-- WHY A TRIGGER AND NOT A GENERATED COLUMN: depth is recursive, and a generated
-- column may not read other rows. WHY IT MATTERS: without it a caller can
-- re-parent a group under its own descendant, and every recursive read of that
-- template loops forever. A rendering path that can hang is worse than a
-- rejected write.
CREATE OR REPLACE FUNCTION nurock_diligence_group_depth()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_parent_depth int;
  v_parent_template uuid;
  v_ancestor uuid;
  v_hops int := 0;
BEGIN
  IF NEW.parent_group_id IS NULL THEN
    NEW.depth := 0;
  ELSE
    SELECT depth, template_id
      INTO v_parent_depth, v_parent_template
      FROM nurock_diligence_item_groups
     WHERE id = NEW.parent_group_id;

    IF v_parent_depth IS NULL THEN
      RAISE EXCEPTION 'Parent group % does not exist.', NEW.parent_group_id;
    END IF;

    -- A subsection must live in the same template as its parent, or a packet
    -- silently inherits another financier's structure.
    IF v_parent_template <> NEW.template_id THEN
      RAISE EXCEPTION
        'Group % belongs to template %, but its parent belongs to template %.',
        NEW.id, NEW.template_id, v_parent_template;
    END IF;

    NEW.depth := v_parent_depth + 1;

    IF NEW.depth > 2 THEN
      RAISE EXCEPTION
        'Checklist groups nest at most three levels (section > subsection > '
        'sub-subsection). This would be level %.', NEW.depth + 1;
    END IF;

    -- Walk up. A bounded loop, so a pre-existing cycle cannot hang the write.
    v_ancestor := NEW.parent_group_id;
    WHILE v_ancestor IS NOT NULL AND v_hops < 8 LOOP
      IF v_ancestor = NEW.id THEN
        RAISE EXCEPTION 'That would make group % its own ancestor.', NEW.id;
      END IF;
      SELECT parent_group_id INTO v_ancestor
        FROM nurock_diligence_item_groups WHERE id = v_ancestor;
      v_hops := v_hops + 1;
    END LOOP;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_nddg_depth ON nurock_diligence_item_groups;
CREATE TRIGGER trg_nddg_depth
  BEFORE INSERT OR UPDATE OF parent_group_id, template_id
  ON nurock_diligence_item_groups
  FOR EACH ROW EXECUTE FUNCTION nurock_diligence_group_depth();

-- Re-parenting a group must re-derive its children's depth too, or a subtree
-- keeps a stale depth and the CHECK stops meaning anything.
CREATE OR REPLACE FUNCTION nurock_diligence_group_depth_cascade()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.depth IS DISTINCT FROM OLD.depth THEN
    -- Touching parent_group_id re-fires the BEFORE trigger on each child, which
    -- recomputes depth and re-runs the ceiling check. Assigning the column to
    -- itself is the cheapest way to say "re-derive".
    UPDATE nurock_diligence_item_groups
       SET parent_group_id = parent_group_id
     WHERE parent_group_id = NEW.id;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_nddg_depth_cascade ON nurock_diligence_item_groups;
CREATE TRIGGER trg_nddg_depth_cascade
  AFTER UPDATE OF depth ON nurock_diligence_item_groups
  FOR EACH ROW EXECUTE FUNCTION nurock_diligence_group_depth_cascade();

DROP TRIGGER IF EXISTS trg_nddg_updated_at ON nurock_diligence_item_groups;
CREATE TRIGGER trg_nddg_updated_at
  BEFORE UPDATE ON nurock_diligence_item_groups
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----------------------------------------------------------------------------
-- 3. Items join a group.
-- ----------------------------------------------------------------------------
-- ON DELETE SET NULL, not CASCADE: deleting a section must never delete the
-- lender's requirements. The items fall back to ungrouped and stay visible,
-- which is recoverable. Silently destroying checklist rows is not.
ALTER TABLE nurock_diligence_items
  ADD COLUMN IF NOT EXISTS group_id uuid
    REFERENCES nurock_diligence_item_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ndi_group
  ON nurock_diligence_items (group_id);

-- An item and its group must belong to the SAME template. Without this an item
-- can be filed under another financier's section, and the packet renders
-- structure it does not own. Enforced by trigger because a CHECK cannot join.
CREATE OR REPLACE FUNCTION nurock_diligence_item_group_same_template()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE v_group_template uuid;
BEGIN
  IF NEW.group_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT template_id INTO v_group_template
    FROM nurock_diligence_item_groups WHERE id = NEW.group_id;
  IF v_group_template IS NULL THEN
    RAISE EXCEPTION 'Group % does not exist.', NEW.group_id;
  END IF;
  IF v_group_template <> NEW.template_id THEN
    RAISE EXCEPTION
      'Item belongs to template % but group % belongs to template %.',
      NEW.template_id, NEW.group_id, v_group_template;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_ndi_group_same_template ON nurock_diligence_items;
CREATE TRIGGER trg_ndi_group_same_template
  BEFORE INSERT OR UPDATE OF group_id, template_id ON nurock_diligence_items
  FOR EACH ROW EXECUTE FUNCTION nurock_diligence_item_group_same_template();

-- ----------------------------------------------------------------------------
-- 4. RLS + GRANTS. Both. See the header.
-- ----------------------------------------------------------------------------
ALTER TABLE nurock_diligence_item_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nurock_diligence_item_groups_sel ON nurock_diligence_item_groups;
DROP POLICY IF EXISTS nurock_diligence_item_groups_wr  ON nurock_diligence_item_groups;

-- READ IS WIDE, and the reasoning matches gl_to_format_line's and
-- cost_account_map's: these are section LABELS on an org-wide catalog. They hold
-- no deal data and no money. A narrowed read does not present as a permission
-- error; it presents as every packet's headings quietly going blank.
CREATE POLICY nurock_diligence_item_groups_sel
  ON nurock_diligence_item_groups
  FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

-- USING and WITH CHECK identical, so an UPDATE cannot be half-permitted.
CREATE POLICY nurock_diligence_item_groups_wr
  ON nurock_diligence_item_groups
  FOR ALL TO authenticated
  USING (
    app_can('diligence', 'edit')
    OR app_can('devmgmt', 'edit')
    OR app_is_org_admin(auth.uid())
  )
  WITH CHECK (
    app_can('diligence', 'edit')
    OR app_can('devmgmt', 'edit')
    OR app_is_org_admin(auth.uid())
  );

-- TRUNCATE is a table privilege row security does not filter, so no policy
-- closes it. Revoke everything, then grant back explicitly and only the four.
REVOKE ALL ON public.nurock_diligence_item_groups FROM anon;
REVOKE ALL ON public.nurock_diligence_item_groups FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.nurock_diligence_item_groups TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. AND FIX THE INHERITED GAP ON nurock_diligence_items WHILE WE ARE HERE.
-- ----------------------------------------------------------------------------
-- NOTE: this does NOT grant DELETE, and that is deliberate. The application no
-- longer deletes catalog items at all — removal is is_active=false (see
-- removeTemplateItem in settings/diligence-templates/item-actions.ts), which is
-- also what 0081's own comment requires so that live deal tracking can never be
-- orphaned. Granting DELETE to close a cosmetic gap would widen the write
-- surface on an org-wide catalog for no behaviour the product wants.
--
-- What IS fixed: the grant is now EXPLICIT rather than inherited from whatever
-- defaults happened to apply, anon holds nothing, and TRUNCATE is revoked. The
-- 2026-09-03 measurement showed the old state was legible to nobody — the app
-- had INSERT and UPDATE by accident rather than by decision.
REVOKE ALL ON public.nurock_diligence_items FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.nurock_diligence_items TO authenticated;

COMMENT ON TABLE public.nurock_diligence_item_groups IS
  'Template-owned sections/subsections for a financier or lender checklist, so a '
  'packet can carry ITS OWN structure (PNC has 12 numbered sections with '
  'subsections) instead of being forced into the canonical 15 LIHTC categories. '
  'ORGANISATIONAL ONLY: coverage is computed from nurock_diligence_crosswalk and '
  'this table must never enter that calculation. Item order remains '
  'nurock_diligence_items.item_number; a grouped checklist orders by (group '
  'position, item_number). Max three levels, enforced by trigger. '
  'is_entity_parameterized/entity_role are declared for the per-entity work '
  '(ASK 2) and are read by nothing yet.';

COMMENT ON COLUMN public.nurock_diligence_items.group_id IS
  'Optional template-owned section. NULL = ungrouped, which is every pre-existing '
  'row: the canonical 59-item checklist is unaffected and grouping is opt-in per '
  'template. ON DELETE SET NULL so removing a section never destroys the '
  'lender''s requirements.';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================================
-- VERIFY (read-only). Run these after COMMIT.
-- ============================================================================
-- 1. The table, the column, and NOTHING regrouped by accident:
--
--   SELECT count(*) AS groups FROM public.nurock_diligence_item_groups;
--   -- expect 0
--   SELECT count(*) AS grouped_items
--     FROM public.nurock_diligence_items WHERE group_id IS NOT NULL;
--   -- expect 0 — nothing is grouped until someone groups it
--   SELECT count(*) AS active_items
--     FROM public.nurock_diligence_items WHERE is_active;
--   -- expect the SAME number as before this migration (62 at time of writing:
--   -- 59 canonical + 3 active on the test template)
--
-- 2. Policies — expect exactly two, and NO `true` in either predicate:
--
--   SELECT policyname, cmd, roles, qual, with_check FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'nurock_diligence_item_groups'
--    ORDER BY policyname;
--
-- 3. Grants — anon must hold NOTHING on either table, and neither may carry
--    TRUNCATE. `nurock_diligence_items` should show SELECT/INSERT/UPDATE and
--    NO DELETE (deliberate — see section 5):
--
--   SELECT table_name, grantee,
--          string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
--     FROM information_schema.role_table_grants
--    WHERE table_schema = 'public'
--      AND table_name IN ('nurock_diligence_item_groups','nurock_diligence_items')
--      AND grantee IN ('anon','authenticated')
--    GROUP BY table_name, grantee ORDER BY table_name, grantee;
--
-- 4. The depth ceiling and the cycle guard actually fire. This is the part worth
--    running, because a constraint nobody has seen refuse anything is not yet
--    known to work. ROLL IT BACK — it creates nothing permanent:
--
--   BEGIN;
--     WITH t AS (SELECT id FROM public.nurock_diligence_templates
--                 WHERE is_canonical = false LIMIT 1)
--     INSERT INTO public.nurock_diligence_item_groups (template_id, label)
--       SELECT id, 'ZZ depth test L0' FROM t RETURNING id, depth;
--     -- then, using the id returned above as :p0
--     -- INSERT ... (template_id, parent_group_id, label) -> expect depth 1
--     -- INSERT ... parent = the depth-1 row            -> expect depth 2
--     -- INSERT ... parent = the depth-2 row            -> EXPECT AN EXCEPTION:
--     --   "Checklist groups nest at most three levels ... This would be level 4."
--   ROLLBACK;
--
-- 5. Cross-template filing is refused (also roll back):
--
--   BEGIN;
--     -- UPDATE public.nurock_diligence_items SET group_id = <a group from
--     --   ANOTHER template> WHERE id = <any item>;
--     -- EXPECT: "Item belongs to template X but group Y belongs to template Z."
--   ROLLBACK;
-- ============================================================================
