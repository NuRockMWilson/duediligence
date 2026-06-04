-- =============================================================================
-- Phase 8.0 — FHFC Cost Cert Four-Format Schema Foundation
-- =============================================================================
-- Adds the three FHFC cost certification formats (FHFC DFCC, FHFC Quarterly,
-- 10% Test) alongside the existing NuRock Standard in nurock_schedule_formats.
-- Seeds 85 lines for FHFC DFCC from the FHFC HC Development FCC form (the
-- COSTS tab of the Foxcroft Cove Development Workbook). FHFC Quarterly and
-- 10% Test land as empty format placeholders — lines seeded in a later round.
--
-- Replaces cost_account_map.standard_line_id with a new generalized mapping
-- table gl_to_format_line(gl_account, format_id, schedule_line_id,
-- other_description). PK (gl_account, format_id) — one line per GL per
-- format; per-deal splits go through the existing dm_*-prefixed deal-scoped
-- override tables. Backfills the new table from existing standard_line_id
-- data using is_default=true to identify the NuRock Standard format
-- (resilient to slug naming).
--
-- cost_account_map.standard_line_id is preserved as a deprecated dead column
-- for this round; will be dropped in a future round after UI cutover is
-- verified against the new mapping table.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. New formats
-- ---------------------------------------------------------------------------
-- Idempotent on slug uniqueness; safe to re-run.

insert into nurock_schedule_formats (slug, name, description, is_default, sort_order)
values
  ('fhfc_dfcc', 'FHFC DFCC',
   'Florida Housing HC Development Final Cost Certification',
   false, 10),
  ('fhfc_quarterly', 'FHFC Quarterly',
   'Florida Housing Quarterly Compliance Report',
   false, 20),
  ('ten_percent_test', '10% Test',
   'Carryover Allocation 10% Test (Section 42(h)(1)(E))',
   false, 30)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- 2. gl_to_format_line — new generalized mapping table
-- ---------------------------------------------------------------------------
-- One schedule line per GL per format. A GL not mapped in a given format
-- simply has no row for that (gl_account, format_id) pair. Per-deal
-- overrides live in the existing dm_gl_mapping_overrides + dm_schedule_line_to_standard
-- tables and continue to work; this table is the global default.

create table if not exists gl_to_format_line (
  gl_account text not null
    references cost_account_map(gl_account) on update cascade on delete cascade,
  format_id uuid not null
    references nurock_schedule_formats(id) on delete cascade,
  schedule_line_id uuid not null
    references nurock_standard_schedule_lines(id) on delete cascade,
  other_description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (gl_account, format_id)
);

create index if not exists gl_to_format_line_format_id_idx
  on gl_to_format_line (format_id);
create index if not exists gl_to_format_line_schedule_line_id_idx
  on gl_to_format_line (schedule_line_id);

comment on table gl_to_format_line is
  'Phase 8.0 — global default GL → schedule line mapping per cost cert format. '
  'Replaces cost_account_map.standard_line_id (kept deprecated, to be dropped '
  'in a future round). Per-deal overrides live in dm_gl_mapping_overrides + '
  'dm_schedule_line_to_standard.';
comment on column gl_to_format_line.other_description is
  'When schedule_line_id is an "Other (Explain in detail)" line, the '
  'format-specific narration text for this GL. Null otherwise.';

-- ---------------------------------------------------------------------------
-- 3. Backfill from cost_account_map.standard_line_id
-- ---------------------------------------------------------------------------
-- Identifies the NuRock Standard format via is_default=true rather than
-- assuming a specific slug. Fails loudly if no default format exists.

do $$
declare
  v_default_format_id uuid;
  v_backfilled integer;
begin
  select id into v_default_format_id
  from nurock_schedule_formats
  where is_default = true
  limit 1;

  if v_default_format_id is null then
    raise exception 'No default format found in nurock_schedule_formats (is_default=true). Cannot backfill cost_account_map.standard_line_id.';
  end if;

  insert into gl_to_format_line (gl_account, format_id, schedule_line_id)
  select cam.gl_account, v_default_format_id, cam.standard_line_id
  from cost_account_map cam
  where cam.standard_line_id is not null
  on conflict (gl_account, format_id) do nothing;

  get diagnostics v_backfilled = row_count;
  raise notice 'Backfilled % rows into gl_to_format_line from cost_account_map.standard_line_id', v_backfilled;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Mark cost_account_map.standard_line_id as deprecated
-- ---------------------------------------------------------------------------
-- Column stays for this round to give UI time to cut over. Drop in a
-- later round once gl_to_format_line is the single source of truth.

comment on column cost_account_map.standard_line_id is
  'DEPRECATED (Phase 8.0) — superseded by gl_to_format_line. Will be dropped '
  'in a future round. Do not reference in new code.';

-- ---------------------------------------------------------------------------
-- 5. Seed FHFC DFCC lines (85 rows)
-- ---------------------------------------------------------------------------
-- Lines transcribed from the FHFC HC Development FCC form (COSTS tab of
-- Foxcroft Cove Development Workbook). Three kinds, distinguished via notes:
--   - section_header (9 rows): B.1, B.2, ..., B.9 — UI rendering anchors
--   - entry (64 rows, notes IS NULL): valid GL mapping targets
--   - subtotal (11 rows): computed from underlying entry lines
--   - grand_total (1 row): B.9 TDC, computed from subtotals
--
-- Description format: "<FHFC ref> <Line label>" so the GL → Mappings tab
-- can render unambiguously when the same label appears across formats.

do $$
declare
  v_dfcc_id uuid;
  v_seeded integer;
begin
  select id into v_dfcc_id from nurock_schedule_formats where slug = 'fhfc_dfcc';
  if v_dfcc_id is null then
    raise exception 'fhfc_dfcc format not found; cannot seed lines';
  end if;

  -- Skip seed if any lines already exist for this format (idempotent re-run)
  if exists (select 1 from nurock_standard_schedule_lines where format_id = v_dfcc_id) then
    raise notice 'fhfc_dfcc already has lines seeded; skipping seed step';
    return;
  end if;

  insert into nurock_standard_schedule_lines (format_id, line_number, section, description, notes)
  select v_dfcc_id, line_number, section, description, notes
  from (values
  (1, 'actual_construction_cost', 'B.1. Actual Construction Cost', 'section_header'),
  (2, 'actual_construction_cost', 'B.1.(a)(1) Building Costs — Accessory Buildings', NULL),
  (3, 'actual_construction_cost', 'B.1.(a)(2) Building Costs — Demolition', NULL),
  (4, 'actual_construction_cost', 'B.1.(a)(3) Building Costs — New Rental Units', NULL),
  (5, 'actual_construction_cost', 'B.1.(a)(4) Building Costs — Off-Site (Explain in detail)', NULL),
  (6, 'actual_construction_cost', 'B.1.(a)(5) Building Costs — Recreational Amenities', NULL),
  (7, 'actual_construction_cost', 'B.1.(a)(6) Building Costs — Rehabilitation of Existing Common Areas', NULL),
  (8, 'actual_construction_cost', 'B.1.(a)(7) Building Costs — Rehabilitation of Existing Rental Units', NULL),
  (9, 'actual_construction_cost', 'B.1.(a)(8) Building Costs — Site Work', NULL),
  (10, 'actual_construction_cost', 'B.1.(a)(9) Building Costs — Other (Explain in detail)', NULL),
  (11, 'actual_construction_cost', 'B.1.(a)(10) Total Building Costs', 'subtotal'),
  (12, 'actual_construction_cost', 'B.1.(b)(1) Building Contractor — General Requirements (on-site)', NULL),
  (13, 'actual_construction_cost', 'B.1.(b)(2) Building Contractor''s Profit', NULL),
  (14, 'actual_construction_cost', 'B.1.(b)(3) Building Contractor''s Overhead', NULL),
  (15, 'actual_construction_cost', 'B.1.(b)(4) Total Building Contractor Costs/Fees', 'subtotal'),
  (16, 'actual_construction_cost', 'B.1.(c) Total Actual General Contractor Cost', 'subtotal'),
  (17, 'actual_construction_cost', 'B.1.(d)(1) Construction Costs Outside of GC Contract — Miscellaneous (Explain in detail)', NULL),
  (18, 'actual_construction_cost', 'B.1.(e) Total Actual Construction Cost', 'subtotal'),
  (19, 'general_development_costs', 'B.2. General Development Costs', 'section_header'),
  (20, 'general_development_costs', 'B.2.(a) Accounting Fees', NULL),
  (21, 'general_development_costs', 'B.2.(b) Appraisal', NULL),
  (22, 'general_development_costs', 'B.2.(c) Architect''s Fee — Design', NULL),
  (23, 'general_development_costs', 'B.2.(d) Architect''s Fee — Supervision', NULL),
  (24, 'general_development_costs', 'B.2.(e) Builder''s Risk Insurance', NULL),
  (25, 'general_development_costs', 'B.2.(f) Building Permit', NULL),
  (26, 'general_development_costs', 'B.2.(g) Brokerage Fees', NULL),
  (27, 'general_development_costs', 'B.2.(h) Capital Needs Assessment', NULL),
  (28, 'general_development_costs', 'B.2.(i) Engineering Fee', NULL),
  (29, 'general_development_costs', 'B.2.(j) Environmental Report', NULL),
  (30, 'general_development_costs', 'B.2.(k) FHFC Administrative Fee', NULL),
  (31, 'general_development_costs', 'B.2.(l) FHFC Application Fee', NULL),
  (32, 'general_development_costs', 'B.2.(m) FHFC Compliance Fee', NULL),
  (33, 'general_development_costs', 'B.2.(n) FHFC PRL/Underwriting Fee', NULL),
  (34, 'general_development_costs', 'B.2.(o) Green Building Cert./Inspections', NULL),
  (35, 'general_development_costs', 'B.2.(p) Impact Fees (net) (List in detail)', NULL),
  (36, 'general_development_costs', 'B.2.(q) Inspection Fees', NULL),
  (37, 'general_development_costs', 'B.2.(r) Insurance', NULL),
  (38, 'general_development_costs', 'B.2.(s) Legal Fees', NULL),
  (39, 'general_development_costs', 'B.2.(t) Market Study', NULL),
  (40, 'general_development_costs', 'B.2.(u) Marketing/Advertising', NULL),
  (41, 'general_development_costs', 'B.2.(v) Property Taxes', NULL),
  (42, 'general_development_costs', 'B.2.(w) Soil Test Report', NULL),
  (43, 'general_development_costs', 'B.2.(x) Survey', NULL),
  (44, 'general_development_costs', 'B.2.(y) Tenant Relocation Costs', NULL),
  (45, 'general_development_costs', 'B.2.(z) Title Insurance', NULL),
  (46, 'general_development_costs', 'B.2.(aa) Utility Connection Fees', NULL),
  (47, 'general_development_costs', 'B.2.(ab) Other (Explain in detail)', NULL),
  (48, 'general_development_costs', 'B.2.(ac) Total General Development Costs', 'subtotal'),
  (49, 'financial_costs', 'B.3. Financial Costs', 'section_header'),
  (50, 'financial_costs', 'B.3.(a) Construction Loan Origination Fee', NULL),
  (51, 'financial_costs', 'B.3.(b) Construction Loan Credit Enhancement', NULL),
  (52, 'financial_costs', 'B.3.(c) Construction Loan Interest', NULL),
  (53, 'financial_costs', 'B.3.(d) Construction Loan Closing Costs', NULL),
  (54, 'financial_costs', 'B.3.(e) Permanent Loan Origination Fee', NULL),
  (55, 'financial_costs', 'B.3.(f) Permanent Loan Credit Enhancement', NULL),
  (56, 'financial_costs', 'B.3.(g) Permanent Loan Closing Costs', NULL),
  (57, 'financial_costs', 'B.3.(h) Bridge Loan Origination Fee', NULL),
  (58, 'financial_costs', 'B.3.(i) Bridge Loan Interest', NULL),
  (59, 'financial_costs', 'B.3.(j) Other (Explain in detail)', NULL),
  (60, 'financial_costs', 'B.3.(k) Total Financial Costs', 'subtotal'),
  (61, 'development_cost_subtotal', 'B.4. Development Cost Subtotal (B.1.(c) + B.2.(ac) + B.3.(k))', 'section_header'),
  (62, 'development_cost_subtotal', 'B.4.total Development Cost Subtotal', 'subtotal'),
  (63, 'acquisition_buildings', 'B.5. Acquisition Cost of Existing Building(s) Excluding Land', 'section_header'),
  (64, 'acquisition_buildings', 'B.5.(a) Existing Building(s), owned', NULL),
  (65, 'acquisition_buildings', 'B.5.(b) Building Acquisition — Other (Explain in detail)', NULL),
  (66, 'acquisition_buildings', 'B.5.(c) Developer fee associated with Acquisition', NULL),
  (67, 'acquisition_buildings', 'B.5.(d) Developer fee associated with Acquisition (excess)', NULL),
  (68, 'acquisition_buildings', 'B.5.(e) Total Building Acquisition Cost excluding Land', 'subtotal'),
  (69, 'developer_fees', 'B.6. Developer Fees', 'section_header'),
  (70, 'developer_fees', 'B.6.(a) Developer''s Administrative Overhead', NULL),
  (71, 'developer_fees', 'B.6.(b) Developer''s Profit', NULL),
  (72, 'developer_fees', 'B.6.(c) Acquisition Costs in excess of appraised value', NULL),
  (73, 'developer_fees', 'B.6.(d) Developer Fees — Other (Explain in detail)', NULL),
  (74, 'developer_fees', 'B.6.(e) Total Developer Fees', 'subtotal'),
  (75, 'contingency_reserves', 'B.7. Contingency Reserves', 'section_header'),
  (76, 'contingency_reserves', 'B.7.(a) Reserves Required by Lender', NULL),
  (77, 'contingency_reserves', 'B.7.(b) Other Reserves', NULL),
  (78, 'contingency_reserves', 'B.7.(c) Total Contingency Reserves', 'subtotal'),
  (79, 'acquisition_land', 'B.8. Acquisition Cost of Land', 'section_header'),
  (80, 'acquisition_land', 'B.8.(a) Land, owned (lesser of actual costs or appraised value)', NULL),
  (81, 'acquisition_land', 'B.8.(b) Land Lease Costs (lesser of actual costs or appraised value)', NULL),
  (82, 'acquisition_land', 'B.8.(c) Land Acquisition — Other (Explain in detail)', NULL),
  (83, 'acquisition_land', 'B.8.(d) Total Land Cost', 'subtotal'),
  (84, 'total_development_cost', 'B.9. Total Development Cost (B.4. + B.5.(c) + B.6.(e) + B.7.(c) + B.8.(d))', 'section_header'),
  (85, 'total_development_cost', 'B.9.total Total Development Cost', 'grand_total')
  ) as t(line_number, section, description, notes);

  get diagnostics v_seeded = row_count;
  raise notice 'Seeded % FHFC DFCC lines', v_seeded;
end $$;

commit;

-- ===========================================================================
-- Post-deploy verification (read-only, runs after COMMIT)
-- ===========================================================================
-- These three SELECTs run as separate statements after the migration
-- commits. In the Supabase SQL Editor they produce three result tables;
-- if anything is off, it shows here. Safe to re-run any time.

-- (1) All four formats present, in order
select slug, name, is_default, sort_order
from nurock_schedule_formats
order by sort_order, slug;
-- Expected: nurock_standard (is_default=true), fhfc_dfcc, fhfc_quarterly, ten_percent_test

-- (2) FHFC DFCC line counts by kind — should total 85
select coalesce(notes, 'entry') as kind, count(*) as line_count
from nurock_standard_schedule_lines
where format_id = (select id from nurock_schedule_formats where slug = 'fhfc_dfcc')
group by coalesce(notes, 'entry')
order by 1;
-- Expected: entry=64, grand_total=1, section_header=9, subtotal=11

-- (3) Backfill row count vs source row count — should match
select
  (select count(*) from gl_to_format_line
     where format_id = (select id from nurock_schedule_formats where is_default = true))
    as backfilled_rows,
  (select count(*) from cost_account_map where standard_line_id is not null)
    as source_rows;
-- Expected: backfilled_rows = source_rows
