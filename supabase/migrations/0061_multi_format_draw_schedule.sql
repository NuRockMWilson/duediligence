BEGIN;

-- ============================================================================
-- Phase 8.14.x — Multi-format draw schedule (full multi-format operational)
--
-- Adds format_id to dm_draw_schedule_lines so a deal can hold the draw
-- schedule in multiple formats simultaneously (NuRock Standard, FHFC DFCC,
-- etc.), widens the uniqueness key to include format_id, adds an active-format
-- pointer on deals, and rewrites realign_deal_to_excel_format to build rows
-- for every format that has schedule-line definitions (not just the default).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. dm_draw_schedule_lines.format_id
-- ----------------------------------------------------------------------------
ALTER TABLE dm_draw_schedule_lines
  ADD COLUMN IF NOT EXISTS format_id uuid;

UPDATE dm_draw_schedule_lines
   SET format_id = (SELECT id FROM nurock_schedule_formats WHERE is_default = TRUE LIMIT 1)
 WHERE format_id IS NULL;

ALTER TABLE dm_draw_schedule_lines
  ALTER COLUMN format_id SET NOT NULL;

ALTER TABLE dm_draw_schedule_lines
  ALTER COLUMN format_id SET DEFAULT '250bd7b0-acc0-4fef-8294-b5dc7e89a1ee';

ALTER TABLE dm_draw_schedule_lines
  DROP CONSTRAINT IF EXISTS dm_draw_schedule_lines_format_id_fkey;
ALTER TABLE dm_draw_schedule_lines
  ADD CONSTRAINT dm_draw_schedule_lines_format_id_fkey
  FOREIGN KEY (format_id) REFERENCES nurock_schedule_formats(id);

-- ----------------------------------------------------------------------------
-- 2. Widen uniqueness from (deal_id, item_number) to (deal_id, format_id, item_number)
-- ----------------------------------------------------------------------------
ALTER TABLE dm_draw_schedule_lines
  DROP CONSTRAINT IF EXISTS dm_draw_schedule_lines_deal_id_item_number_key;
DROP INDEX IF EXISTS dm_draw_schedule_lines_deal_id_item_number_key;

ALTER TABLE dm_draw_schedule_lines
  ADD CONSTRAINT dm_draw_schedule_lines_deal_format_item_key
  UNIQUE (deal_id, format_id, item_number);

DROP INDEX IF EXISTS dm_draw_schedule_lines_deal_idx;
CREATE INDEX dm_draw_schedule_lines_deal_format_idx
  ON dm_draw_schedule_lines USING btree (deal_id, format_id, item_number);

-- ----------------------------------------------------------------------------
-- 3. deals.active_format_id — which format the operational draw flow runs in
-- ----------------------------------------------------------------------------
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS active_format_id uuid;

UPDATE deals
   SET active_format_id = (SELECT id FROM nurock_schedule_formats WHERE is_default = TRUE LIMIT 1)
 WHERE active_format_id IS NULL;

ALTER TABLE deals
  ALTER COLUMN active_format_id SET NOT NULL;

ALTER TABLE deals
  ALTER COLUMN active_format_id SET DEFAULT '250bd7b0-acc0-4fef-8294-b5dc7e89a1ee';

ALTER TABLE deals
  DROP CONSTRAINT IF EXISTS deals_active_format_id_fkey;
ALTER TABLE deals
  ADD CONSTRAINT deals_active_format_id_fkey
  FOREIGN KEY (active_format_id) REFERENCES nurock_schedule_formats(id);

-- ----------------------------------------------------------------------------
-- 4. realign_deal_to_excel_format — multi-format rewrite
--    (based on the live v9-default-only source; the only behavioral change is
--     that it now builds/inserts rows for EVERY format present in
--     nurock_standard_schedule_lines, tagged with that format_id, and scopes
--     preserved amounts per (format_id, description).)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.realign_deal_to_excel_format(
  p_deal_id text,
  p_dry_run boolean DEFAULT true,
  p_zero_unmapped boolean DEFAULT false,
  p_force boolean DEFAULT false
)
 RETURNS TABLE(item_number integer, section text, description text, computed_amount numeric, source_basis text)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_deal_exists BOOLEAN;
  v_is_custom BOOLEAN;
  v_schedule_id UUID;
  v_inserted INT;
  v_parked INT;
  v_deleted INT;
  v_orphan_count INT;
  v_default_format_id UUID;
BEGIN
  SELECT EXISTS (SELECT 1 FROM deals WHERE id = p_deal_id) INTO v_deal_exists;
  IF NOT v_deal_exists THEN
    RAISE EXCEPTION 'Deal % not found in deals table', p_deal_id;
  END IF;

  -- ---- Migration 0058: custom-schedule safeguard ----
  SELECT COALESCE(is_custom_schedule, FALSE) INTO v_is_custom
  FROM deals
  WHERE id = p_deal_id;

  IF v_is_custom AND NOT p_force THEN
    RAISE EXCEPTION 'Deal % has is_custom_schedule = TRUE. Realigning to NuRock Standard will wipe its custom schedule layout. To proceed anyway, pass p_force = TRUE.', p_deal_id;
  END IF;

  SELECT id INTO v_default_format_id
  FROM nurock_schedule_formats
  WHERE is_default = TRUE
  LIMIT 1;

  IF v_default_format_id IS NULL THEN
    RAISE EXCEPTION 'No default schedule format exists. Mark one format is_default = TRUE.';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS v9_uw_for_deal (
    uw_id TEXT PRIMARY KEY,
    uw_desc TEXT,
    uw_category TEXT,
    uw_amount NUMERIC
  ) ON COMMIT DROP;
  TRUNCATE v9_uw_for_deal;
  INSERT INTO v9_uw_for_deal (uw_id, uw_desc, uw_category, uw_amount)
  SELECT
    elem->>'id',
    elem->>'description',
    elem->>'category',
    COALESCE((elem->>'amount')::NUMERIC, 0)
  FROM deals d, LATERAL jsonb_array_elements(d.model->'constructionBudget') AS elem
  WHERE d.id = p_deal_id
    AND elem->>'id' IS NOT NULL
    AND elem->>'id' <> '';

  -- Preserved amounts are now scoped per (format_id, description) so manual
  -- edits in one format do not bleed into another format's rows.
  CREATE TEMP TABLE IF NOT EXISTS v9_preserved_amounts (
    pa_format_id UUID,
    pa_description TEXT,
    pa_revised_budget NUMERIC,
    PRIMARY KEY (pa_format_id, pa_description)
  ) ON COMMIT DROP;
  TRUNCATE v9_preserved_amounts;
  INSERT INTO v9_preserved_amounts (pa_format_id, pa_description, pa_revised_budget)
  SELECT
    dsl.format_id,
    LOWER(TRIM(dsl.description)),
    MAX(dsl.revised_budget)
  FROM dm_draw_schedule_lines dsl
  WHERE dsl.deal_id = p_deal_id
    AND dsl.revised_budget > 0
  GROUP BY dsl.format_id, LOWER(TRIM(dsl.description));

  CREATE TEMP TABLE IF NOT EXISTS v9_computed_rows (
    cr_format_id UUID,
    cr_schedule_line_id UUID,
    cr_line_number INT,
    cr_section TEXT,
    cr_description TEXT,
    cr_amount NUMERIC,
    cr_source_basis TEXT
  ) ON COMMIT DROP;
  TRUNCATE v9_computed_rows;

  -- Compute rows for EVERY format that has schedule-line definitions.
  -- Formats with no nurock_standard_schedule_lines rows (e.g. FHFC Quarterly,
  -- 10% Test today) simply produce nothing.
  INSERT INTO v9_computed_rows (
    cr_format_id, cr_schedule_line_id, cr_line_number, cr_section,
    cr_description, cr_amount, cr_source_basis
  )
  SELECT
    sl.format_id,
    sl.id,
    sl.line_number,
    sl.section,
    sl.description,
    COALESCE(
      ROUND((
        SELECT SUM(u.uw_amount * gtfl.split_fraction)
        FROM v9_uw_for_deal u
        JOIN dm_underwriting_line_gl ulg
          ON ulg.source_line_id = u.uw_id
        JOIN gl_to_format_line gtfl
          ON gtfl.gl_account = ulg.gl_account
         AND gtfl.format_id = sl.format_id
         AND gtfl.schedule_line_id = sl.id
      ), 2),
      CASE
        WHEN p_zero_unmapped THEN 0
        ELSE COALESCE(
          (SELECT pa.pa_revised_budget
           FROM v9_preserved_amounts pa
           WHERE pa.pa_format_id = sl.format_id
             AND pa.pa_description = LOWER(TRIM(sl.description))),
          0
        )
      END
    ),
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM v9_uw_for_deal u
        JOIN dm_underwriting_line_gl ulg ON ulg.source_line_id = u.uw_id
        JOIN gl_to_format_line gtfl
          ON gtfl.gl_account = ulg.gl_account
         AND gtfl.format_id = sl.format_id
         AND gtfl.schedule_line_id = sl.id
      ) THEN 'UW → GL → schedule mapping'
      WHEN p_zero_unmapped THEN 'manual (zeroed — reset mode)'
      ELSE 'manual (preserved from existing if present)'
    END
  FROM nurock_standard_schedule_lines sl
  WHERE sl.notes IS NULL
  ORDER BY sl.format_id, sl.line_number;

  IF NOT p_dry_run THEN
    DELETE FROM dm_realign_orphans WHERE deal_id = p_deal_id;

    INSERT INTO dm_realign_orphans (
      deal_id, source_line_id, uw_description, uw_category, uw_amount
    )
    SELECT
      p_deal_id,
      u.uw_id,
      u.uw_desc,
      u.uw_category,
      u.uw_amount
    FROM v9_uw_for_deal u
    LEFT JOIN dm_underwriting_line_gl ulg ON ulg.source_line_id = u.uw_id
    WHERE u.uw_amount > 0
      AND ulg.gl_account IS NULL;

    GET DIAGNOSTICS v_orphan_count = ROW_COUNT;
    IF v_orphan_count > 0 THEN
      RAISE NOTICE '% UW line(s) had no GL mapping and did not flow to any schedule format. Check dm_realign_orphans for details.', v_orphan_count;
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    cr.cr_line_number,
    cr.cr_section,
    cr.cr_description,
    cr.cr_amount,
    cr.cr_source_basis
  FROM v9_computed_rows cr
  ORDER BY cr.cr_format_id, cr.cr_line_number;

  IF p_dry_run THEN
    RAISE NOTICE '--- DRY RUN ---  No changes written. Re-run with FALSE to apply.';
    RETURN;
  END IF;

  IF v_is_custom AND p_force THEN
    RAISE NOTICE 'FORCING realign on custom-schedule deal %. Custom layout will be replaced with standard format rows.', p_deal_id;
  END IF;

  RAISE NOTICE '--- APPLYING realignment to deal % (zero_unmapped=%, force=%) ---', p_deal_id, p_zero_unmapped, p_force;

  SELECT dsl.schedule_id INTO v_schedule_id
  FROM dm_draw_schedule_lines dsl
  WHERE dsl.deal_id = p_deal_id AND dsl.schedule_id IS NOT NULL
  LIMIT 1;
  IF v_schedule_id IS NULL THEN
    SELECT s.id INTO v_schedule_id FROM dm_schedules s WHERE s.deal_id = p_deal_id LIMIT 1;
  END IF;
  IF v_schedule_id IS NULL THEN
    RAISE EXCEPTION 'No dm_schedules row for deal %. Promote it via the dev-mgmt UI first.', p_deal_id;
  END IF;

  -- Park ALL active rows across every format. The widened uniqueness key
  -- (deal_id, format_id, item_number) means parked rows of different formats
  -- no longer collide at item_number + 10000.
  UPDATE dm_draw_schedule_lines dsl
     SET item_number = dsl.item_number + 10000,
         updated_at = NOW()
   WHERE dsl.deal_id = p_deal_id
     AND dsl.item_number < 10000;
  GET DIAGNOSTICS v_parked = ROW_COUNT;
  RAISE NOTICE 'Parked % rows', v_parked;

  INSERT INTO dm_draw_schedule_lines (
    schedule_id, deal_id, format_id, item_number, description, section,
    original_budget, revised_budget, metadata, created_at, updated_at
  )
  SELECT
    v_schedule_id,
    p_deal_id,
    cr.cr_format_id,
    cr.cr_line_number,
    cr.cr_description,
    cr.cr_section,
    cr.cr_amount,
    cr.cr_amount,
    jsonb_build_object(
      'aligned_to_excel_format', TRUE,
      'aligned_at', NOW()::TEXT,
      'realign_version', 'v9-multi-format',
      'format_id', cr.cr_format_id::TEXT,
      'aggregated_from_uw', cr.cr_source_basis = 'UW → GL → schedule mapping',
      'zeroed_via_reset', cr.cr_source_basis = 'manual (zeroed — reset mode)'
    ),
    NOW(), NOW()
  FROM v9_computed_rows cr;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RAISE NOTICE 'Inserted % rows', v_inserted;

  DELETE FROM dm_draw_schedule_lines dsl
   WHERE dsl.deal_id = p_deal_id
     AND dsl.item_number >= 10000
     AND NOT EXISTS (
       SELECT 1 FROM dm_draw_lines dl
       WHERE dl.draw_schedule_line_id = dsl.id
     );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RAISE NOTICE 'Deleted % parked rows', v_deleted;

  IF v_parked - v_deleted > 0 THEN
    RAISE NOTICE 'WARNING: % parked rows preserved due to FK refs', v_parked - v_deleted;
  END IF;
END;
$function$;

COMMIT;
