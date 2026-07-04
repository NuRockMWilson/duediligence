-- =============================================================================
-- Migration 0099 — Per-item document requirement mode (brief Part 2)
-- =============================================================================
-- The document library links any document to any number of checklist items
-- (dm_diligence_item_documents, shipped in 0081). This adds the per-item
-- requirement mode the sign-off gate reads:
--
--   'all' (default) — the item expects every linked document to be present
--                     before the Approver can approve;
--   'any'           — any one linked document suffices (either/or items,
--                     e.g. "EIN Letter / W-9").
--
-- Because a link's existence IS presence, both modes currently gate the
-- Approver on "at least one linked document"; the mode is persisted per item,
-- editable in the drawer, and feeds future expected-document lists + the
-- crosswalk's requirement_mode semantics.
-- =============================================================================

BEGIN;

ALTER TABLE dm_diligence_deal_items
  ADD COLUMN IF NOT EXISTS document_requirement text NOT NULL DEFAULT 'all'
  CHECK (document_requirement IN ('all', 'any'));

COMMIT;
