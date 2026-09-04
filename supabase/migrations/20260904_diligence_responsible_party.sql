-- ============================================================================
-- RESPONSIBLE PARTY on a tracked checklist item
-- ============================================================================
-- Michael runs this. Nobody else. Small: two columns and a CHECK on an existing
-- table, so no new policies or grants — dm_diligence_deal_items already carries
-- both, and a column inherits them.
--
-- ----------------------------------------------------------------------------
-- WHAT IT IS, IN MICHAEL'S WORDS
-- ----------------------------------------------------------------------------
-- "Responsible party will be either the entity which generated the list (i.e.
--  PNC Bank) or the NuRock organizational users that have IDs (i.e. Michael
--  Wilson, Robby Block, Jordan Pines)."
--
-- So it answers WHO OWES THE DOCUMENT, and the answer is one of two kinds:
--   * the FINANCIER whose packet this is — PNC provides its own forms; nobody at
--     NuRock can produce them, and chasing NuRock for one is a category error;
--   * a NAMED NUROCK USER.
--
-- ----------------------------------------------------------------------------
-- WHY THIS IS NOT assignee_user_id, WHICH ALREADY EXISTS
-- ----------------------------------------------------------------------------
-- ASSIGNEE is who is WORKING it. RESPONSIBLE PARTY is who OWES it. On a packet
-- those routinely differ: PNC owes its own subscription form, while Michael is
-- the assignee chasing PNC for it. Collapsing them would make "outstanding by
-- owner" either count NuRock people for documents they cannot produce, or lose
-- the fact that someone here is chasing it.
--
-- They will often coincide — Michael both owes and works an item — and that is
-- fine. Two columns answering two questions that usually agree is not
-- duplication; one column answering two questions is.
--
-- ----------------------------------------------------------------------------
-- TWO COLUMNS PLUS A CHECK, NOT ONE COLUMN HOLDING EITHER KIND
-- ----------------------------------------------------------------------------
-- The tempting shape is a single text column holding a user uuid OR the literal
-- 'financier'. That is two meanings in one column, and this codebase has paid
-- for that shape repeatedly — a guard reading a stored LABEL instead of the
-- fact, one quantity computed two ways. A reader would have to know the
-- convention to interpret the value, and any query filtering "items PNC owes"
-- would have to string-match.
--
-- So: responsible_user_id for the NuRock case, responsible_is_financier for the
-- other, and a CHECK that they are mutually exclusive. Both unset = nobody has
-- decided yet, which is the honest default and is distinct from either answer.
--
-- ----------------------------------------------------------------------------
-- DELIBERATELY NOT DONE HERE
-- ----------------------------------------------------------------------------
-- PNC's source spreadsheet has its OWN "Resp. Party" column, with values like
-- GP, PNC, GP/PNC, City of Miami, PNC/Freddie. Those are neither a NuRock user
-- nor cleanly "the financier" — "City of Miami" is a third party entirely. That
-- is the LENDER'S STATED EXPECTATION, a different fact from NuRock's internal
-- resolution of who owes it, and importing it into this column would conflate
-- them. If that column should be preserved it belongs on the TEMPLATE item as
-- reference text, and it is a separate decision.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.dm_diligence_deal_items') IS NULL THEN
    RAISE EXCEPTION 'ABORTING: dm_diligence_deal_items missing. Apply 0081 first.';
  END IF;
END $$;

ALTER TABLE dm_diligence_deal_items
  ADD COLUMN IF NOT EXISTS responsible_user_id uuid,
  ADD COLUMN IF NOT EXISTS responsible_is_financier boolean NOT NULL DEFAULT false;

-- No FK to app_users, matching assignee_user_id in 0081 — that column is a bare
-- uuid too. Adding one here and not there would be an inconsistency that reads
-- as intent, and a user row being removed should not block a checklist read.
CREATE INDEX IF NOT EXISTS idx_dmddi_responsible_user
  ON dm_diligence_deal_items (responsible_user_id)
  WHERE responsible_user_id IS NOT NULL;

-- Mutually exclusive. An item cannot be owed by both PNC and a named person:
-- that is not a richer answer, it is an unanswered question wearing two hats.
ALTER TABLE dm_diligence_deal_items
  DROP CONSTRAINT IF EXISTS dm_diligence_deal_items_responsible_chk;
ALTER TABLE dm_diligence_deal_items
  ADD CONSTRAINT dm_diligence_deal_items_responsible_chk
  CHECK (NOT (responsible_is_financier AND responsible_user_id IS NOT NULL));

COMMENT ON COLUMN public.dm_diligence_deal_items.responsible_user_id IS
  'The NuRock user who OWES this document. Distinct from assignee_user_id, which '
  'is who is WORKING it — PNC may owe its own form while a NuRock person chases '
  'it. NULL and responsible_is_financier=false together mean nobody has decided.';

COMMENT ON COLUMN public.dm_diligence_deal_items.responsible_is_financier IS
  'TRUE when the packet''s own financier owes the document (PNC provides its own '
  'forms). Mutually exclusive with responsible_user_id by CHECK. Deliberately a '
  'boolean rather than a second id: a packet has exactly one financier, named on '
  'nurock_diligence_templates.financier_name, so storing it again would be a '
  'second copy of one fact.';

NOTIFY pgrst, 'reload schema';

COMMIT;
