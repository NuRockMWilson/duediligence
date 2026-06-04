-- =============================================================================
-- Migration 0071 — Realign merge-in-place (kills the duplicate-row bug)
-- =============================================================================
-- ROOT CAUSE (confirmed on Foxcroft Cove, diagnostic Query B2):
--   The realign function (migration 0067) re-syncs a deal's draw schedule to
--   the NuRock Standard template via PARK + REINSERT:
--     1. Park existing live rows by adding +offset to item_number (→ ≥10000)
--     2. Insert fresh rows at item_number 1..32
--     3. Delete parked rows that have NO FK refs
--   Step 3's guard intentionally PRESERVES parked rows that still have
--   dm_draw_lines pointing at them. So any deal that was realigned twice
--   AFTER draw activity started ends up with BOTH a live row (item < 10000)
--   AND a parked twin (item ≥ 10000) for every line that had draw lines.
--   Both rows carry the same budget, so the schedule total double-counts.
--
--   Foxcroft had 6 such duplicates totaling ~$5.48M, which exactly explained
--   its $5,485,511 variance vs the UW model TDC ($43,459,835).
--
-- THE FIX — two parts, one transaction:
--
--   PART A (one-time data cleanup, ALL deals):
--     Collapse every parked duplicate into its live twin. Re-point any
--     dm_draw_lines FK refs from the parked row to the live row (matched by
--     normalized description), then delete the now-orphaned parked rows.
--     Live rows are NOT modified — original/revised budgets (incl. any
--     change-order revisions) are preserved exactly. Only duplicate rows go.
--
--   PART B (prevent recurrence):
--     Replace realign_deal_to_excel_format with a MERGE-IN-PLACE strategy:
--       - UPDATE existing live rows by item_number (preserves their UUID, so
--         FK refs from dm_draw_lines stay valid — no parking needed)
--       - INSERT computed rows that don't yet exist
--       - Self-heal: collapse any stray parked rows into live twins
--       - DELETE live rows removed from the template (FK-safe)
--     Net: realign is now idempotent and never creates a parked twin.
--
-- NOT TOUCHED:
--   - regenerate_report_schedule_lines (0063) already rebuilds report rows
--     from the template filtered to item_number < 10000, so the report table
--     never had the bug. After Part A the default-format report (which reads
--     operational rows live) is automatically correct.
--   - revised_budget semantics on realign are preserved verbatim from 0067
--     (original = revised = computed amount). Change-order preservation
--     across realigns is a separate concern, intentionally out of scope here.
-- =============================================================================

BEGIN;

-- =============================================================================
-- PART A — One-time cleanup of existing parked-row duplicates (ALL deals)
-- =============================================================================
DO $cleanup$
DECLARE
  v_repointed   INT := 0;
  v_deleted     INT := 0;
  v_survivors   INT := 0;
  v_deals_fixed INT := 0;
BEGIN
  -- Count deals that have at least one parked row, for the audit log.
  SELECT COUNT(DISTINCT deal_id) INTO v_deals_fixed
  FROM dm_draw_schedule_lines
  WHERE item_number >= 10000;

  -- 1. Re-point FK refs: any dm_draw_lines pointing at a parked row now
  --    points at the canonical live twin (lowest item_number live row with
  --    the same normalized description, within the same deal+format).
  WITH live_canonical AS (
    SELECT DISTINCT ON (deal_id, format_id, LOWER(TRIM(description)))
           id,
           deal_id,
           format_id,
           LOWER(TRIM(description)) AS norm_desc
    FROM dm_draw_schedule_lines
    WHERE item_number < 10000
    ORDER BY deal_id, format_id, LOWER(TRIM(description)), item_number
  )
  UPDATE dm_draw_lines dl
     SET draw_schedule_line_id = lc.id
    FROM dm_draw_schedule_lines parked
    JOIN live_canonical lc
      ON lc.deal_id   = parked.deal_id
     AND lc.format_id = parked.format_id
     AND lc.norm_desc = LOWER(TRIM(parked.description))
   WHERE parked.item_number >= 10000
     AND dl.draw_schedule_line_id = parked.id;
  GET DIAGNOSTICS v_repointed = ROW_COUNT;

  -- 2. Delete parked rows that now have no FK refs (the vast majority — all
  --    the ones we just re-pointed, plus any that never had refs).
  DELETE FROM dm_draw_schedule_lines parked
   WHERE parked.item_number >= 10000
     AND NOT EXISTS (
       SELECT 1 FROM dm_draw_lines dl
       WHERE dl.draw_schedule_line_id = parked.id
     );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  -- 3. Any parked rows still standing? (Would only happen if a parked row
  --    has FK refs AND no live twin to re-point to — e.g. a template line
  --    that was renamed between realigns. Surface for manual review.)
  SELECT COUNT(*) INTO v_survivors
  FROM dm_draw_schedule_lines
  WHERE item_number >= 10000;

  RAISE NOTICE '=== PART A — parked-row cleanup ===';
  RAISE NOTICE '  Deals with parked rows:        %', v_deals_fixed;
  RAISE NOTICE '  dm_draw_lines re-pointed:      %', v_repointed;
  RAISE NOTICE '  Parked rows deleted:           %', v_deleted;
  IF v_survivors > 0 THEN
    RAISE WARNING '  Parked rows REMAINING (FK refs, no live twin): % — review manually', v_survivors;
  ELSE
    RAISE NOTICE '  Parked rows remaining:         0  (clean)';
  END IF;
END;
$cleanup$;

-- =============================================================================
-- PART B — Merge-in-place realign (no more park + reinsert)
-- =============================================================================
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
  v_updated INT;
  v_inserted INT;
  v_collapsed INT;
  v_repointed INT;
  v_removed INT;
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

  -- Build the computed rows (UW model → GL mapping → standard schedule lines).
  -- Unchanged from migration 0067.
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

  -- The function always returns the computed rows as its result set.
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

  -- =====================================================================
  -- MERGE IN PLACE  (replaces the old park + reinsert + delete-orphans)
  -- =====================================================================
  -- item_number == standard schedule line_number, so it's the stable
  -- natural key per (deal_id, default_format). We UPDATE matching rows in
  -- place — preserving each row's UUID so dm_draw_lines FK refs stay valid
  -- — and INSERT only the computed rows that don't exist yet. No row is
  -- ever parked, so no duplicate twin can be created.
  -- =====================================================================

  -- 1. UPDATE existing live rows. revised_budget = original_budget =
  --    computed amount, matching 0067's reinsert semantics exactly.
  UPDATE dm_draw_schedule_lines dsl
     SET description     = cr.cr_description,
         section         = cr.cr_section,
         original_budget = cr.cr_amount,
         revised_budget  = cr.cr_amount,
         metadata = jsonb_build_object(
           'aligned_to_excel_format', TRUE,
           'aligned_at', NOW()::TEXT,
           'realign_version', 'v12-merge-in-place',
           'format_id', v_default_format_id::TEXT,
           'aggregated_from_uw', cr.cr_source_basis = 'UW → GL → schedule mapping',
           'zeroed_via_reset', cr.cr_source_basis = 'manual (zeroed — reset mode)'
         ),
         updated_at = NOW()
    FROM v9_computed_rows cr
   WHERE dsl.deal_id     = p_deal_id
     AND dsl.format_id   = v_default_format_id
     AND dsl.item_number = cr.cr_line_number;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- 2. INSERT computed rows that have no live row at their item_number yet.
  INSERT INTO dm_draw_schedule_lines (
    schedule_id, deal_id, format_id, item_number, description, section,
    original_budget, revised_budget, metadata, created_at, updated_at
  )
  SELECT
    v_schedule_id, p_deal_id, v_default_format_id,
    cr.cr_line_number, cr.cr_description, cr.cr_section,
    cr.cr_amount, cr.cr_amount,
    jsonb_build_object(
      'aligned_to_excel_format', TRUE,
      'aligned_at', NOW()::TEXT,
      'realign_version', 'v12-merge-in-place',
      'format_id', v_default_format_id::TEXT,
      'aggregated_from_uw', cr.cr_source_basis = 'UW → GL → schedule mapping',
      'zeroed_via_reset', cr.cr_source_basis = 'manual (zeroed — reset mode)'
    ),
    NOW(), NOW()
  FROM v9_computed_rows cr
  WHERE NOT EXISTS (
    SELECT 1 FROM dm_draw_schedule_lines dsl
    WHERE dsl.deal_id     = p_deal_id
      AND dsl.format_id   = v_default_format_id
      AND dsl.item_number = cr.cr_line_number
  );
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- 3. Self-heal: collapse any stray parked rows (item ≥ 10000) left over
  --    from the legacy park-reinsert version. Re-point their FK refs to the
  --    live twin (now guaranteed to exist post-merge), then delete them.
  UPDATE dm_draw_lines dl
     SET draw_schedule_line_id = live.id
    FROM dm_draw_schedule_lines parked
    JOIN LATERAL (
      SELECT l.id
      FROM dm_draw_schedule_lines l
      WHERE l.deal_id     = parked.deal_id
        AND l.format_id   = parked.format_id
        AND l.item_number < 10000
        AND LOWER(TRIM(l.description)) = LOWER(TRIM(parked.description))
      ORDER BY l.item_number
      LIMIT 1
    ) live ON TRUE
   WHERE parked.deal_id     = p_deal_id
     AND parked.format_id   = v_default_format_id
     AND parked.item_number >= 10000
     AND dl.draw_schedule_line_id = parked.id;
  GET DIAGNOSTICS v_repointed = ROW_COUNT;

  DELETE FROM dm_draw_schedule_lines dsl
   WHERE dsl.deal_id     = p_deal_id
     AND dsl.format_id   = v_default_format_id
     AND dsl.item_number >= 10000
     AND NOT EXISTS (
       SELECT 1 FROM dm_draw_lines dl WHERE dl.draw_schedule_line_id = dsl.id
     );
  GET DIAGNOSTICS v_collapsed = ROW_COUNT;

  -- 4. DELETE live rows that are no longer in the template (rare — only if
  --    the standard schedule shrinks), FK-safe.
  DELETE FROM dm_draw_schedule_lines dsl
   WHERE dsl.deal_id     = p_deal_id
     AND dsl.format_id   = v_default_format_id
     AND dsl.item_number < 10000
     AND NOT EXISTS (
       SELECT 1 FROM v9_computed_rows cr WHERE cr.cr_line_number = dsl.item_number
     )
     AND NOT EXISTS (
       SELECT 1 FROM dm_draw_lines dl WHERE dl.draw_schedule_line_id = dsl.id
     );
  GET DIAGNOSTICS v_removed = ROW_COUNT;

  RAISE NOTICE 'Merge: % updated, % inserted, % parked re-pointed, % parked collapsed, % removed',
    v_updated, v_inserted, v_repointed, v_collapsed, v_removed;

  -- Keep report-format rows in sync after an operational realign.
  PERFORM regenerate_report_schedule_lines(p_deal_id);
END;
$function$;

COMMIT;
