BEGIN;

-- ============================================================================
-- Phase 8.14.x — Report-format inclusions (corrects 0061's active-format model)
--
-- The operational draw schedule is ALWAYS NuRock Standard. Other formats
-- (FHFC DFCC, etc.) are opt-in *report views* of the same draw data for
-- investors/lenders. A format is only generated/shown for a deal when it is
-- explicitly selected for inclusion.
--
-- This migration:
--   1. creates dm_deal_formats (presence = "included report format for deal")
--   2. seeds every deal with NuRock Standard
--   3. drops the unused deals.active_format_id added in 0061
--   4. re-scopes realign to generate default UNION the deal's included formats
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. dm_deal_formats — per-deal report-format inclusions
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dm_deal_formats (
  deal_id    text NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  format_id  uuid NOT NULL REFERENCES nurock_schedule_formats(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (deal_id, format_id)
);

-- PUBLIC RLS policy (no TO clause — see project convention; TO authenticated
-- silently fails at runtime on this project).
ALTER TABLE dm_deal_formats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dm_deal_formats_all ON dm_deal_formats;
CREATE POLICY dm_deal_formats_all ON dm_deal_formats
  FOR ALL USING (true) WITH CHECK (true);

-- ----------------------------------------------------------------------------
-- 2. Seed NuRock Standard inclusion for every existing deal
-- ----------------------------------------------------------------------------
INSERT INTO dm_deal_formats (deal_id, format_id)
SELECT d.id, (SELECT id FROM nurock_schedule_formats WHERE is_default = TRUE LIMIT 1)
FROM deals d
ON CONFLICT (deal_id, format_id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 3. Drop the unused active-format pointer added in 0061
-- ----------------------------------------------------------------------------
ALTER TABLE deals DROP CONSTRAINT IF EXISTS deals_active_format_id_fkey;
ALTER TABLE deals DROP COLUMN IF EXISTS active_format_id;

-- ----------------------------------------------------------------------------
-- 4. realign_deal_to_excel_format — generate default UNION included formats
--    (identical to the 0061 multi-format body except the compute WHERE clause,
--     which now restricts to the deal's included formats instead of every
--     buildable format.)
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

  -- Preserved amounts scoped per (format_id, description) so manual edits in
  -- one format do not bleed into another format's rows.
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

  -- Generate rows for the default (operational) format ALWAYS, plus any report
  -- formats the deal has opted into via dm_deal_formats. Formats with no
  -- schedule-line definitions naturally produce nothing.
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
    AND (
      sl.format_id = v_default_format_id
      OR sl.format_id IN (
        SELECT df.format_id FROM dm_deal_formats df WHERE df.deal_id = p_deal_id
      )
    )
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
