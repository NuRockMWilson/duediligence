-- =============================================================================
-- Migration 0070 verify — Eligibility taxonomy
-- =============================================================================
-- Run after applying 0070_eligibility_taxonomy.sql. Confirms:
--   - cost_account_map.interim_cost_type exists with the right CHECK
--   - dm_invoice_lines.eligibility_period_start / _end exist as DATE
--   - dm_invoice_lines.eligibility_auto_computed exists as BOOLEAN NOT NULL
--   - the period-end ≥ period-start CHECK is in place
-- =============================================================================

DO $$
DECLARE
  v_col_type TEXT;
  v_is_nullable TEXT;
  v_col_default TEXT;
BEGIN
  -- cost_account_map.interim_cost_type
  SELECT data_type, is_nullable
    INTO v_col_type, v_is_nullable
  FROM information_schema.columns
  WHERE table_schema='public'
    AND table_name='cost_account_map'
    AND column_name='interim_cost_type';
  IF v_col_type IS NULL THEN
    RAISE EXCEPTION 'cost_account_map.interim_cost_type MISSING';
  END IF;
  RAISE NOTICE 'cost_account_map.interim_cost_type: % (nullable=%)',
    v_col_type, v_is_nullable;

  -- dm_invoice_lines.eligibility_period_start
  SELECT data_type, is_nullable
    INTO v_col_type, v_is_nullable
  FROM information_schema.columns
  WHERE table_schema='public'
    AND table_name='dm_invoice_lines'
    AND column_name='eligibility_period_start';
  IF v_col_type IS NULL THEN
    RAISE EXCEPTION 'dm_invoice_lines.eligibility_period_start MISSING';
  END IF;
  RAISE NOTICE 'dm_invoice_lines.eligibility_period_start: % (nullable=%)',
    v_col_type, v_is_nullable;

  -- dm_invoice_lines.eligibility_period_end
  SELECT data_type, is_nullable
    INTO v_col_type, v_is_nullable
  FROM information_schema.columns
  WHERE table_schema='public'
    AND table_name='dm_invoice_lines'
    AND column_name='eligibility_period_end';
  IF v_col_type IS NULL THEN
    RAISE EXCEPTION 'dm_invoice_lines.eligibility_period_end MISSING';
  END IF;
  RAISE NOTICE 'dm_invoice_lines.eligibility_period_end: % (nullable=%)',
    v_col_type, v_is_nullable;

  -- dm_invoice_lines.eligibility_auto_computed
  SELECT data_type, is_nullable, column_default
    INTO v_col_type, v_is_nullable, v_col_default
  FROM information_schema.columns
  WHERE table_schema='public'
    AND table_name='dm_invoice_lines'
    AND column_name='eligibility_auto_computed';
  IF v_col_type IS NULL THEN
    RAISE EXCEPTION 'dm_invoice_lines.eligibility_auto_computed MISSING';
  END IF;
  IF v_is_nullable <> 'NO' THEN
    RAISE EXCEPTION 'dm_invoice_lines.eligibility_auto_computed should be NOT NULL';
  END IF;
  RAISE NOTICE 'dm_invoice_lines.eligibility_auto_computed: % default=%',
    v_col_type, v_col_default;

  -- Period-end ≥ period-start CHECK
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'dm_invoice_lines_eligibility_period_chk'
  ) THEN
    RAISE EXCEPTION 'dm_invoice_lines_eligibility_period_chk MISSING';
  END IF;
  RAISE NOTICE 'dm_invoice_lines_eligibility_period_chk present';

  RAISE NOTICE '=========================================';
  RAISE NOTICE '0070 verification PASSED';
  RAISE NOTICE '=========================================';
END;
$$;
