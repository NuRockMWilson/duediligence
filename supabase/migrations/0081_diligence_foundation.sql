-- =============================================================================
-- Migration 0081 — Due-Diligence tracking foundation (DD module — Increment 1)
-- =============================================================================
-- Phase 8 of the platform roadmap: a per-deal due-diligence checklist that
-- tracks every document/attestation an LIHTC deal must close, who owns it, its
-- status, and the files satisfying it — surfaced as a live "readiness %".
--
-- Built by COMPOSING existing shared services (no new infra):
--   * Template catalog mirrors nurock_schedule_formats / _standard_schedule_lines
--     (org-global → nurock_ prefix, no deal_id).
--   * Per-deal tracking mirrors dm_lien_waivers (singleton status rows, denorm
--     deal_id, received/approved consistency CHECK).
--   * File upload mirrors the invoice/lien-waiver private-bucket pattern.
--   * RLS = PUBLIC policy (no TO clause — "TO authenticated" silently fails in
--     this project; write-enforcement is app-layer via app_can('devmgmt',…)).
--
-- DESIGN SPINE: a deal tracks one row per CANONICAL (NuRock-standard) item.
-- Investor/lender templates (Increment 2) are satisfied THROUGH a crosswalk off
-- those canonical items, so a document attached once propagates to every
-- external packet that maps to it — no per-template duplication, no sync drift.
--
-- This migration ships the 6 Increment-1 tables + the diligence-attachments
-- bucket + the canonical NuRock LIHTC checklist seed, and backfills existing
-- deals (adoption + item instantiation). The /diligence page also ensures
-- items lazily on load, so new deals and newly-added canonical items self-heal.
-- =============================================================================

BEGIN;

-- Shared updated_at trigger fn (reuse if present, else create — mirrors 0072/0073).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    CREATE FUNCTION set_updated_at() RETURNS trigger
      LANGUAGE plpgsql AS $fn$
      BEGIN NEW.updated_at = now(); RETURN NEW; END;
      $fn$;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 1. nurock_diligence_templates — checklist template catalog (org-global).
--    One canonical NuRock template + (Increment 2) imported investor/lender
--    templates. Mirrors nurock_schedule_formats.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nurock_diligence_templates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL UNIQUE,
  name          text NOT NULL,
  description   text,
  template_kind text NOT NULL DEFAULT 'custom'
                  CHECK (template_kind IN
                    ('nurock_standard','investor','lender','underwriter','custom')),
  -- The financier org this packet belongs to (LP / lender), nullable.
  financier_name text,
  -- Exactly one canonical template (the NuRock standard list). Enforced by the
  -- partial unique index below.
  is_canonical  boolean NOT NULL DEFAULT false,
  is_active     boolean NOT NULL DEFAULT true,
  source        text NOT NULL DEFAULT 'manual'
                  CHECK (source IN ('manual','import_excel','import_csv','seed')),
  sort_order    int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_nurock_diligence_templates_canonical
  ON nurock_diligence_templates (is_canonical) WHERE is_canonical;
CREATE INDEX IF NOT EXISTS idx_nurock_diligence_templates_kind
  ON nurock_diligence_templates (template_kind, sort_order);

ALTER TABLE nurock_diligence_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nurock_diligence_templates_all ON nurock_diligence_templates;
CREATE POLICY nurock_diligence_templates_all ON nurock_diligence_templates
  FOR ALL USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_nurock_diligence_templates_updated_at ON nurock_diligence_templates;
CREATE TRIGGER trg_nurock_diligence_templates_updated_at
  BEFORE UPDATE ON nurock_diligence_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. nurock_diligence_items — template item definitions (org-global).
--    Holds the canonical NuRock items now; external-template items in Inc. 2.
--    Mirrors nurock_standard_schedule_lines.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nurock_diligence_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id   uuid NOT NULL REFERENCES nurock_diligence_templates(id) ON DELETE CASCADE,
  item_number   int NOT NULL,
  -- Optional stable external reference (e.g. a lender's "Exhibit C-3").
  code          text,
  -- LIHTC DD category key (see seed below); drives UI grouping.
  category      text NOT NULL,
  title         text NOT NULL,
  description   text,
  item_type     text NOT NULL DEFAULT 'document'
                  CHECK (item_type IN ('document','attestation','data','section_header')),
  default_required boolean NOT NULL DEFAULT true,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, item_number)
);

CREATE INDEX IF NOT EXISTS idx_nurock_diligence_items_template
  ON nurock_diligence_items (template_id, category, item_number);

ALTER TABLE nurock_diligence_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nurock_diligence_items_all ON nurock_diligence_items;
CREATE POLICY nurock_diligence_items_all ON nurock_diligence_items
  FOR ALL USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_nurock_diligence_items_updated_at ON nurock_diligence_items;
CREATE TRIGGER trg_nurock_diligence_items_updated_at
  BEFORE UPDATE ON nurock_diligence_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. dm_diligence_deal_templates — per-deal template adoption (junction).
--    Canonical auto-adopted; external opt-in (Inc. 2). Mirrors dm_deal_formats.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dm_diligence_deal_templates (
  deal_id     text NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES nurock_diligence_templates(id) ON DELETE CASCADE,
  adopted_at  timestamptz NOT NULL DEFAULT now(),
  adopted_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (deal_id, template_id)
);

ALTER TABLE dm_diligence_deal_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dm_diligence_deal_templates_all ON dm_diligence_deal_templates;
CREATE POLICY dm_diligence_deal_templates_all ON dm_diligence_deal_templates
  FOR ALL USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 4. dm_diligence_deal_items — THE SPINE. One tracked row per (deal, canonical
--    item). Status / assignee / due / sign-off live here. Mirrors the status
--    primitive in dm_lien_waivers crossed with the per-deal instance pattern.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dm_diligence_deal_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id          text NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  -- The canonical item this instantiates. No ON DELETE CASCADE: catalog items
  -- are retired via is_active=false, never hard-deleted while deals reference
  -- them (prevents orphaning live deal tracking).
  item_id          uuid NOT NULL REFERENCES nurock_diligence_items(id),
  status           text NOT NULL DEFAULT 'not_started'
                     CHECK (status IN
                       ('not_started','in_progress','submitted','approved','waived','na')),
  -- Snapshot of default_required at instantiation; editable per deal.
  is_required      boolean NOT NULL DEFAULT true,
  assignee_user_id uuid,
  due_date         date,
  notes            text,
  approved_at      timestamptz,
  approved_by      uuid,
  -- Required when status in (waived, na) so the readiness metric can't be
  -- silently gamed by dropping items from the denominator without a reason.
  waived_reason    text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (deal_id, item_id),
  -- An approved row must carry approved_at (mirror lien-waiver received CHECK).
  CONSTRAINT dm_diligence_deal_items_approved_chk
    CHECK (status <> 'approved' OR approved_at IS NOT NULL),
  CONSTRAINT dm_diligence_deal_items_waive_reason_chk
    CHECK (status NOT IN ('waived','na') OR waived_reason IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_dm_diligence_deal_items_deal_status
  ON dm_diligence_deal_items (deal_id, status);
CREATE INDEX IF NOT EXISTS idx_dm_diligence_deal_items_assignee
  ON dm_diligence_deal_items (assignee_user_id, status);
CREATE INDEX IF NOT EXISTS idx_dm_diligence_deal_items_due
  ON dm_diligence_deal_items (deal_id, due_date);

ALTER TABLE dm_diligence_deal_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dm_diligence_deal_items_all ON dm_diligence_deal_items;
CREATE POLICY dm_diligence_deal_items_all ON dm_diligence_deal_items
  FOR ALL USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_dm_diligence_deal_items_updated_at ON dm_diligence_deal_items;
CREATE TRIGGER trg_dm_diligence_deal_items_updated_at
  BEFORE UPDATE ON dm_diligence_deal_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. dm_diligence_documents — one row per uploaded file (deal-scoped). Storage
--    key is UUID-safe; display_name carries the human/auto-rename label and is
--    the eventual SharePoint filename. sync_status hooks the storage provider
--    abstraction (Supabase now → SharePoint when the app registration lands).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dm_diligence_documents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id           text NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  file_path         text NOT NULL,         -- key in diligence-attachments bucket
  original_filename text NOT NULL,
  display_name      text,                  -- auto-rename label (see storage.ts)
  mime_type         text,
  byte_size         bigint,
  uploaded_by       uuid,
  sharepoint_path   text,
  sync_status       text NOT NULL DEFAULT 'local'
                      CHECK (sync_status IN ('local','syncing','synced','error')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dm_diligence_documents_deal
  ON dm_diligence_documents (deal_id);

ALTER TABLE dm_diligence_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dm_diligence_documents_all ON dm_diligence_documents;
CREATE POLICY dm_diligence_documents_all ON dm_diligence_documents
  FOR ALL USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_dm_diligence_documents_updated_at ON dm_diligence_documents;
CREATE TRIGGER trg_dm_diligence_documents_updated_at
  BEFORE UPDATE ON dm_diligence_documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- 6. dm_diligence_item_documents — M:N link (deal-item ↔ document). One file
--    can satisfy many items; one item can hold many files. Propagation to
--    external items (Inc. 2) rides the crosswalk, so this never points at
--    external items.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dm_diligence_item_documents (
  deal_item_id uuid NOT NULL REFERENCES dm_diligence_deal_items(id) ON DELETE CASCADE,
  document_id  uuid NOT NULL REFERENCES dm_diligence_documents(id) ON DELETE CASCADE,
  deal_id      text NOT NULL,   -- denormalized for cheap per-deal queries
  linked_by    uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (deal_item_id, document_id)
);

CREATE INDEX IF NOT EXISTS idx_dm_diligence_item_documents_doc
  ON dm_diligence_item_documents (document_id);
CREATE INDEX IF NOT EXISTS idx_dm_diligence_item_documents_deal
  ON dm_diligence_item_documents (deal_id);

ALTER TABLE dm_diligence_item_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dm_diligence_item_documents_all ON dm_diligence_item_documents;
CREATE POLICY dm_diligence_item_documents_all ON dm_diligence_item_documents
  FOR ALL USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- Private storage bucket for DD files (mirrors invoice/lien-waiver buckets).
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('diligence-attachments', 'diligence-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Realtime: deal-item status changes drive live readiness KPIs.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
      AND tablename = 'dm_diligence_deal_items'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE dm_diligence_deal_items;
  END IF;
END;
$$;

-- ===========================================================================
-- SEED — canonical NuRock LIHTC standard due-diligence checklist.
-- Categories (order matters → item_number ranges keep groups contiguous):
--   org_docs, title_survey, environmental, zoning_land_use, lihtc_application,
--   lihtc_carryover, lihtc_8609, market_study, appraisal, insurance,
--   financials, construction_docs, partnership_lp, financing_commitments,
--   tax_compliance
-- ===========================================================================
INSERT INTO nurock_diligence_templates
  (slug, name, description, template_kind, is_canonical, source, sort_order)
VALUES
  ('nurock-standard', 'NuRock Standard Due Diligence',
   'NuRock''s canonical LIHTC closing due-diligence checklist. Every deal tracks these items; investor and lender checklists map to them.',
   'nurock_standard', true, 'seed', 0)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO nurock_diligence_items
  (template_id, item_number, category, title, description, item_type)
SELECT t.id, v.item_number, v.category, v.title, v.description, 'document'
FROM nurock_diligence_templates t
CROSS JOIN (VALUES
  -- org_docs (100s)
  (100,'org_docs','Partnership / Operating Agreement','Executed LP agreement or LLC operating agreement for the ownership entity.'),
  (101,'org_docs','Certificate of Limited Partnership / Articles','Filed certificate of LP or articles of organization.'),
  (102,'org_docs','Certificate of Good Standing','Current good-standing certificate from the state of formation.'),
  (103,'org_docs','EIN Letter / W-9','IRS EIN assignment letter and signed W-9 for the entity.'),
  (104,'org_docs','Organizational Chart','Ownership structure chart through to ultimate principals.'),
  (105,'org_docs','Authorizing Resolutions / Incumbency','Resolutions authorizing the transaction and signatories.'),
  -- title_survey (200s)
  (200,'title_survey','Title Commitment / Pro Forma Policy','Current title commitment with pro forma owner''s/lender''s policy.'),
  (201,'title_survey','ALTA/NSPS Land Title Survey','As-built ALTA survey with surveyor certification.'),
  (202,'title_survey','Title Exception Documents','Copies of all recorded exceptions listed in Schedule B.'),
  (203,'title_survey','Legal Description','Recorded legal description matching survey and title.'),
  -- environmental (300s)
  (300,'environmental','Phase I Environmental Site Assessment','ASTM-compliant Phase I ESA.'),
  (301,'environmental','Phase II ESA (if required)','Phase II investigation where the Phase I recommends.'),
  (302,'environmental','Asbestos / Lead-Based Paint Survey','ACM/LBP survey (acq-rehab and pre-1978 structures).'),
  (303,'environmental','Environmental Reliance Letters','Reliance letters extending the ESA to lender and investor.'),
  -- zoning_land_use (400s)
  (400,'zoning_land_use','Zoning Verification Letter','Municipal letter confirming permitted use and compliance.'),
  (401,'zoning_land_use','Site Plan Approval','Approved site plan / development order.'),
  (402,'zoning_land_use','Building Permits','Issued building permits for the scope of work.'),
  (403,'zoning_land_use','Utility Availability Letters','Will-serve letters from each utility provider.'),
  (404,'zoning_land_use','Certificate of Occupancy','C/O issued at completion (placed-in-service evidence).'),
  -- lihtc_application (500s)
  (500,'lihtc_application','LIHTC Application (QAP)','Allocating-agency application package as submitted.'),
  (501,'lihtc_application','Reservation / Determination Letter','Credit reservation or 42(m) determination letter.'),
  (502,'lihtc_application','Tax-Exempt Bond Documents','Bond inducement / TEFRA / issuance docs (bond deals).'),
  -- lihtc_carryover (600s)
  (600,'lihtc_carryover','Carryover Allocation Agreement','Executed carryover allocation from the allocating agency.'),
  (601,'lihtc_carryover','10% Test Cost Certification','CPA-certified 10% basis test for carryover.'),
  (602,'lihtc_carryover','Carryover Basis Backup','Cost backup supporting the carryover basis figure.'),
  -- lihtc_8609 (700s)
  (700,'lihtc_8609','Final Cost Certification','CPA final cost certification of eligible basis.'),
  (701,'lihtc_8609','Form 8609 (per BIN)','IRS Form 8609 issued for each building identification number.'),
  (702,'lihtc_8609','Placed-in-Service Documentation','Evidence of PIS date per building.'),
  -- market_study (800s)
  (800,'market_study','Market Study','Current third-party market study.'),
  (801,'market_study','Rent Comparability Study','RCS supporting underwritten rents (where applicable).'),
  -- appraisal (900s)
  (900,'appraisal','As-Complete / As-Stabilized Appraisal','MAI appraisal with as-complete and as-stabilized values.'),
  (901,'appraisal','Land / As-Is Appraisal','Land or as-is valuation supporting acquisition basis.'),
  -- insurance (1000s)
  (1000,'insurance','Builder''s Risk Policy','Course-of-construction builder''s risk coverage.'),
  (1001,'insurance','General Liability (COI)','GL certificate naming required additional insureds.'),
  (1002,'insurance','Property & Casualty','Permanent property insurance binder/policy.'),
  (1003,'insurance','Flood Insurance','Flood coverage where any structure is in a SFHA.'),
  -- financials (1100s)
  (1100,'financials','Development Budget / Sources & Uses','Final development budget tying to the closing S&U.'),
  (1101,'financials','15-Year Operating Pro Forma','Stabilized 15-year operating projection.'),
  (1102,'financials','Borrower / Guarantor Financials','Current financial statements for borrower and guarantors.'),
  (1103,'financials','Contingent Liability Schedule','Schedule of guarantor contingent liabilities (REO/SREO).'),
  (1104,'financials','Credit / Background Checks','Credit reports and background/OFAC checks on principals.'),
  -- construction_docs (1200s)
  (1200,'construction_docs','Construction Contract (AIA)','Executed GMP/stipulated-sum construction contract (AIA A102/A201).'),
  (1201,'construction_docs','Plans & Specifications','Full permitted plan and specification set.'),
  (1202,'construction_docs','Architect Agreement','Executed owner-architect agreement (AIA B101).'),
  (1203,'construction_docs','Construction Schedule','Baseline construction schedule with milestones.'),
  (1204,'construction_docs','Geotechnical / Soils Report','Soils report for the site.'),
  (1205,'construction_docs','Payment & Performance Bonds','Bonds or approved subguard for the GC.'),
  (1206,'construction_docs','GC Schedule of Values / Qualifications','SOV and GC qualifications / references.'),
  -- partnership_lp (1300s)
  (1300,'partnership_lp','Investor Letter of Intent','LP/investor LOI or equity term sheet.'),
  (1301,'partnership_lp','Equity / Investment Agreement','Executed equity investment / admission documents.'),
  (1302,'partnership_lp','Capital Contribution Schedule','Installment schedule with milestone conditions.'),
  (1303,'partnership_lp','Investor DD Questionnaire','Completed investor due-diligence questionnaire.'),
  -- financing_commitments (1400s)
  (1400,'financing_commitments','Construction Loan Commitment','Executed construction loan commitment / term sheet.'),
  (1401,'financing_commitments','Permanent Loan Commitment','Executed permanent loan commitment / forward.'),
  (1402,'financing_commitments','Subordinate / Soft Loan Commitments','HOME, HTF, AHP and other soft-source commitments.'),
  (1403,'financing_commitments','Intercreditor / Subordination Agreements','Subordination and intercreditor agreements among lenders.'),
  -- tax_compliance (1500s)
  (1500,'tax_compliance','Tax Abatement / PILOT Agreement','Property-tax abatement or PILOT documentation.'),
  (1501,'tax_compliance','Extended Use Agreement (LURA)','Recorded LURA / extended-use agreement.'),
  (1502,'tax_compliance','Utility Allowance Documentation','Approved utility allowance schedule/methodology.')
) AS v(item_number, category, title, description)
WHERE t.slug = 'nurock-standard'
ON CONFLICT (template_id, item_number) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Backfill existing deals: adopt the canonical template + instantiate one
-- tracked deal-item per canonical item. New deals/items self-heal lazily on
-- the /diligence page (ensureDealDiligenceItems), so this is just so existing
-- deals show a populated checklist immediately.
-- ---------------------------------------------------------------------------
INSERT INTO dm_diligence_deal_templates (deal_id, template_id)
SELECT d.id, t.id
FROM deals d
CROSS JOIN nurock_diligence_templates t
WHERE t.is_canonical = true
ON CONFLICT (deal_id, template_id) DO NOTHING;

INSERT INTO dm_diligence_deal_items (deal_id, item_id, is_required)
SELECT d.id, i.id, i.default_required
FROM deals d
JOIN nurock_diligence_templates t ON t.is_canonical = true
JOIN nurock_diligence_items i ON i.template_id = t.id AND i.is_active = true
ON CONFLICT (deal_id, item_id) DO NOTHING;

COMMIT;
