-- =============================================================================
-- Migration 0082 — Due-Diligence crosswalk (DD module — Increment 2)
-- =============================================================================
-- Increment 1 shipped the canonical NuRock checklist + per-deal tracking. This
-- adds the CROSSWALK: a many-to-many map between canonical NuRock items and the
-- items on imported investor/lender/underwriter templates.
--
-- Why a crosswalk (vs. instantiating external items per deal): a deal only ever
-- tracks the CANONICAL items. An external packet's coverage is COMPUTED through
-- this map — "external item X is satisfied when its mapped canonical item(s)
-- are approved" — so a document attached once to a canonical item propagates to
-- every financier packet that maps to it. No duplication, no sync drift.
--
-- Cardinality: one external item may require SEVERAL canonical items (AND), and
-- one canonical item may satisfy SEVERAL external items (fan-out). requirement_
-- mode is logically a property of the external item (how its mapped canonical
-- set combines); we store it per row and the app writes it consistently across
-- an external item's rows. coverage_weight allows partial credit later.
--
-- External templates themselves reuse the Increment-1 catalog tables
-- (nurock_diligence_templates with template_kind in investor/lender/
-- underwriter/custom, nurock_diligence_items) and per-deal opt-in adoption
-- reuses dm_diligence_deal_templates — so no new tables are needed for those.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS nurock_diligence_crosswalk (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Canonical (NuRock-standard) item. App enforces it belongs to the canonical
  -- template; FK guarantees it's a real item.
  canonical_item_id uuid NOT NULL REFERENCES nurock_diligence_items(id) ON DELETE CASCADE,
  -- External-template item this canonical item helps satisfy.
  external_item_id  uuid NOT NULL REFERENCES nurock_diligence_items(id) ON DELETE CASCADE,
  -- How the external item's mapped canonical set combines:
  --   'all' → every mapped canonical item must be approved (default)
  --   'any' → at least one mapped canonical item approved satisfies it
  requirement_mode  text NOT NULL DEFAULT 'all'
                      CHECK (requirement_mode IN ('all','any')),
  -- Partial-credit weight (reserved for weighted coverage; 1 = full credit).
  coverage_weight   numeric NOT NULL DEFAULT 1 CHECK (coverage_weight > 0),
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (canonical_item_id, external_item_id),
  -- A row mapping an item to itself is meaningless (mirror the
  -- nurock_schedule_line_members self-guard).
  CONSTRAINT nurock_diligence_crosswalk_no_self
    CHECK (canonical_item_id <> external_item_id)
);

CREATE INDEX IF NOT EXISTS idx_nurock_diligence_crosswalk_external
  ON nurock_diligence_crosswalk (external_item_id);
CREATE INDEX IF NOT EXISTS idx_nurock_diligence_crosswalk_canonical
  ON nurock_diligence_crosswalk (canonical_item_id);

ALTER TABLE nurock_diligence_crosswalk ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nurock_diligence_crosswalk_all ON nurock_diligence_crosswalk;
CREATE POLICY nurock_diligence_crosswalk_all ON nurock_diligence_crosswalk
  FOR ALL USING (true) WITH CHECK (true);

-- set_updated_at() exists from 0072/0081.
DROP TRIGGER IF EXISTS trg_nurock_diligence_crosswalk_updated_at ON nurock_diligence_crosswalk;
CREATE TRIGGER trg_nurock_diligence_crosswalk_updated_at
  BEFORE UPDATE ON nurock_diligence_crosswalk
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
