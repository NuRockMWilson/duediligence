BEGIN;

-- ============================================================================
-- Phase 8.15 — Report Builder foundation
--
-- The Report Builder lets users create report formats and define their rows
-- from the app (previously formats were SQL-seeded only). Ensure
-- nurock_schedule_formats is writable under a PUBLIC RLS policy, consistent
-- with this project's convention (TO authenticated silently fails at runtime;
-- policies omit the TO clause). nurock_standard_schedule_lines is already
-- writable (the Standard Schedule page creates lines today).
-- ============================================================================

ALTER TABLE nurock_schedule_formats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nurock_schedule_formats_all ON nurock_schedule_formats;
CREATE POLICY nurock_schedule_formats_all ON nurock_schedule_formats
  FOR ALL USING (true) WITH CHECK (true);

COMMIT;
