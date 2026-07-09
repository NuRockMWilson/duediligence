-- ============================================================================
-- 0101 — Diligence: actual completed/met date on checklist items
-- ----------------------------------------------------------------------------
-- Adds a nullable "completed_date" (date) to dm_diligence_deal_items so the
-- platform records WHEN a deadline was actually met, independent of the
-- planned due_date (which is untouched — never repurposed).
--
-- Behavior contract (enforced in app code, not the schema):
--   * When the sign-off chain flips an item to 'approved', completed_date
--     defaults to today IF NULL (a manually back-dated value is never
--     overwritten by re-derivation).
--   * The date is editable from the item drawer and clearable only through
--     a confirmed action.
--   * due_date and status semantics are unchanged.
--
-- Additive + idempotent: ADD COLUMN IF NOT EXISTS, no data loss, no changes
-- to existing columns / keys / RLS / realtime publication (the table is
-- already in supabase_realtime; new columns flow through automatically).
-- No backfill by design — historical items show "Pending" until a human
-- records the true met date.
-- ============================================================================

ALTER TABLE public.dm_diligence_deal_items
  ADD COLUMN IF NOT EXISTS completed_date date;

COMMENT ON COLUMN public.dm_diligence_deal_items.completed_date IS
  'Actual date the item/deadline was met (user-recorded truth). Independent of due_date. Defaults to today when the sign-off chain approves the item; editable/back-datable; nullable.';
