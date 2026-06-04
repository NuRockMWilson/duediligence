BEGIN;

-- ============================================================================
-- Phase 8.14.x — Separate report-format rows into their own table
--
-- Report formats (FHFC DFCC, etc.) move OUT of dm_draw_schedule_lines into a
-- dedicated dm_report_schedule_lines. dm_draw_schedule_lines reverts to
-- NuRock-Standard-only (operational), so operational reads can never
-- double-count, report regeneration never re-parks operational rows, and
-- custom-schedule deals no longer need a force-realign to get report formats.
--
--   realign_deal_to_excel_format        -> operational (NuRock) only, then
--                                          refreshes reports at the end
--   regenerate_report_schedule_lines    -> rebuilds a deal's report rows only
--                                          (delete + insert; no parking, no
--                                          force, never touches operational)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. dm_report_schedule_lines
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dm_report_schedule_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id text NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  format_id uuid NOT NULL REFERENCES nurock_schedule_formats(id),
  item_number integer NOT NULL,
  section text NOT NULL,
  description text NOT NULL,
  original_budget numeric NOT NULL DEFAULT 0,
  revised_budget numeric NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dm_report_schedule_lines_deal_format_item_key
    UNIQUE (deal_id, format_id, item_number)
);

ALTER TABLE dm_report_schedule_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dm_report_schedule_lines_all ON dm_report_schedule_lines;
CREATE POLICY dm_report_schedule_lines_all ON dm_report_schedule_lines
  FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS dm_report_schedule_lines_deal_format_idx
  ON dm_report_schedule_lines USING btree (deal_id, format_id, item_number);

-- ----------------------------------------------------------------------------
-- 2. Move any existing non-default rows out of the operational table.
--    (Non-default rows are never FK-referenced by dm_draw_lines — invoice
--    auto-mapping only ever targets the default format — so this is safe.)
-- ----------------------------------------------------------------------------
INSERT INTO dm_report_schedule_lines
  (deal_id, format_id, item_number, section, description,
   original_budget, revised_budget, metadata, created_at, updated_at)
SELECT
  deal_id, format_id, item_number, section, description,
  original_budget, revised_budget, metadata, created_at, updated_at
FROM dm_draw_schedule_lines
WHERE format_id <> '250bd7b0-acc0-4fef-8294-b5dc7e89a1ee'
  AND item_number < 10000
ON CONFLICT (deal_id, format_id, item_number) DO NOTHING;

DELETE FROM dm_draw_schedule_lines
WHERE format_id <> '250bd7b0-acc0-4fef-8294-b5dc7e89a1ee';

-- ----------------------------------------------------------------------------
-- 3. regenerate_report_schedule_lines — rebuild a deal's report rows
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.regenerate_report_schedule_lines(p_deal_id text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_default_format_id UUID;
BEGIN
  SELECT id INTO v_default_format_id
  FROM nurock_schedule_formats WHERE is_default = TRUE LIMIT 1;

  CREATE TEMP TABLE IF NOT EXISTS rr_uw (
    uw_id TEXT PRIMARY KEY,
    uw_amount NUMERIC
  ) ON COMMIT DROP;
  TRUNCATE rr_uw;
  INSERT INTO rr_uw (uw_id, uw_amount)
  SELECT elem->>'id', COALESCE((elem->>'amount')::NUMERIC, 0)
  FROM deals d, LATERAL jsonb_array_elements(d.model->'constructionBudget') AS elem
  WHERE d.id = p_deal_id
    AND elem->>'id' IS NOT NULL
    AND elem->>'id' <> '';

  -- Full rebuild for this deal — report rows are derived views, not
  -- FK-referenced, so a clean delete + insert is safe.
  DELETE FROM dm_report_schedule_lines WHERE deal_id = p_deal_id;

  INSERT INTO dm_report_schedule_lines
    (deal_id, format_id, item_number, section, description,
     original_budget, revised_budget, metadata)
  SELECT
    p_deal_id,
    sl.format_id,
    sl.line_number,
    sl.section,
    sl.description,
    COALESCE(ROUND(s.raw, 2), 0),
    COALESCE(ROUND(s.raw, 2), 0),
    jsonb_build_object(
      'generated_at', NOW()::TEXT,
      'format_id', sl.format_id::TEXT,
      'aggregated_from_uw', s.raw IS NOT NULL
    )
  FROM nurock_standard_schedule_lines sl
  JOIN dm_deal_formats df
    ON df.deal_id = p_deal_id
   AND df.format_id = sl.format_id
  CROSS JOIN LATERAL (
    SELECT (
      SELECT SUM(u.uw_amount * gtfl.split_fraction)
      FROM rr_uw u
      JOIN dm_underwriting_line_gl ulg ON ulg.source_line_id = u.uw_id
      JOIN gl_to_format_line gtfl
        ON gtfl.gl_account = ulg.gl_account
       AND gtfl.format_id = sl.format_id
       AND gtfl.schedule_line_id = sl.id
    ) AS raw
  ) s
  WHERE sl.notes IS NULL
    AND sl.format_id <> v_default_format_id;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 4. realign_deal_to_excel_format — operational (NuRock) only, then refresh
--    reports. (Same body as the 0062 multi-format version, but the compute is
--    restricted to the default format and report rows are produced by
--    regenerate_report_schedule_lines instead of being written here.)
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

  SELECT COALESCE(is_custom_schedule, FALSE) INTO v_is_custom
  FROM deals WHERE id = p_deal_id;

  IF v_is_custom AND NOT p_force THEN
    RAISE EXCEPTION 'Deal % has is_custom_schedule = TRUE. Realigning to NuRock Standard will wipe its custom schedule layout. To proceed anyway, pass p_force = TRUE.', p_deal_id;
  END IF;

  SELECT id INTO v_default_format_id
  FROM nurock_schedule_formats WHERE is_default = TRUE LIMIT 1;

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

  CREATE TEMP TABLE IF NOT EXISTS v9_preserved_amounts (
    pa_description TEXT PRIMARY KEY,
    pa_revised_budget NUMERIC
  ) ON COMMIT DROP;
  TRUNCATE v9_preserved_amounts;
  INSERT INTO v9_preserved_amounts (pa_description, pa_revised_budget)
  SELECT
    LOWER(TRIM(dsl.description)),
    MAX(dsl.revised_budget)
  FROM dm_draw_schedule_lines dsl
  WHERE dsl.deal_id = p_deal_id
    AND dsl.revised_budget > 0
  GROUP BY LOWER(TRIM(dsl.description));

  CREATE TEMP TABLE IF NOT EXISTS v9_computed_rows (
    cr_schedule_line_id UUID,
    cr_line_number INT,
    cr_section TEXT,
    cr_description TEXT,
    cr_amount NUMERIC,
    cr_source_basis TEXT
  ) ON COMMIT DROP;
  TRUNCATE v9_computed_rows;

  INSERT INTO v9_computed_rows (
    cr_schedule_line_id, cr_line_number, cr_section,
    cr_description, cr_amount, cr_source_basis
  )
  SELECT
    sl.id,
    sl.line_number,
    sl.section,
    sl.description,
    COALESCE(
      ROUND((
        SELECT SUM(u.uw_amount * gtfl.split_fraction)
        FROM v9_uw_for_deal u
        JOIN dm_underwriting_line_gl ulg ON ulg.source_line_id = u.uw_id
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
           WHERE pa.pa_description = LOWER(TRIM(sl.description))),
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
    AND sl.format_id = v_default_format_id
  ORDER BY sl.line_number;

  IF NOT p_dry_run THEN
    DELETE FROM dm_realign_orphans WHERE deal_id = p_deal_id;

    INSERT INTO dm_realign_orphans (
      deal_id, source_line_id, uw_description, uw_category, uw_amount
    )
    SELECT
      p_deal_id, u.uw_id, u.uw_desc, u.uw_category, u.uw_amount
    FROM v9_uw_for_deal u
    LEFT JOIN dm_underwriting_line_gl ulg ON ulg.source_line_id = u.uw_id
    WHERE u.uw_amount > 0
      AND ulg.gl_account IS NULL;

    GET DIAGNOSTICS v_orphan_count = ROW_COUNT;
    IF v_orphan_count > 0 THEN
      RAISE NOTICE '% UW line(s) had no GL mapping. Check dm_realign_orphans.', v_orphan_count;
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    cr.cr_line_number, cr.cr_section, cr.cr_description,
    cr.cr_amount, cr.cr_source_basis
  FROM v9_computed_rows cr
  ORDER BY cr.cr_line_number;

  IF p_dry_run THEN
    RAISE NOTICE '--- DRY RUN ---  No changes written. Re-run with FALSE to apply.';
    RETURN;
  END IF;

  IF v_is_custom AND p_force THEN
    RAISE NOTICE 'FORCING realign on custom-schedule deal %.', p_deal_id;
  END IF;

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
    v_default_format_id,
    cr.cr_line_number,
    cr.cr_description,
    cr.cr_section,
    cr.cr_amount,
    cr.cr_amount,
    jsonb_build_object(
      'aligned_to_excel_format', TRUE,
      'aligned_at', NOW()::TEXT,
      'realign_version', 'v10-split-tables',
      'format_id', v_default_format_id::TEXT,
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

  -- Keep report-format rows in sync after an operational realign.
  PERFORM regenerate_report_schedule_lines(p_deal_id);
END;
$function$;

COMMIT;
