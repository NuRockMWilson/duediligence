BEGIN;

-- ============================================================================
-- Phase 8.15.x — Report Builder line types + totals
--
-- A schedule line is either:
--   'detail' — GL accounts roll into it (the existing behavior), or
--   'total'  — it sums a chosen set of other lines (its members), which may
--              themselves be totals (nesting allowed).
--
-- Totals are a format-definition concept. Per-deal amounts for totals are
-- computed at read time (report view) by summing members recursively, so the
-- realign function is intentionally left unchanged.
-- ============================================================================

ALTER TABLE nurock_standard_schedule_lines
  ADD COLUMN IF NOT EXISTS line_type text NOT NULL DEFAULT 'detail';

ALTER TABLE nurock_standard_schedule_lines
  DROP CONSTRAINT IF EXISTS nurock_standard_schedule_lines_line_type_chk;
ALTER TABLE nurock_standard_schedule_lines
  ADD CONSTRAINT nurock_standard_schedule_lines_line_type_chk
  CHECK (line_type IN ('detail', 'total'));

-- Membership: which lines a total sums. Both ends reference schedule lines;
-- deleting either end removes the membership row.
CREATE TABLE IF NOT EXISTS nurock_schedule_line_members (
  parent_line_id uuid NOT NULL
    REFERENCES nurock_standard_schedule_lines(id) ON DELETE CASCADE,
  member_line_id uuid NOT NULL
    REFERENCES nurock_standard_schedule_lines(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (parent_line_id, member_line_id),
  CONSTRAINT nurock_schedule_line_members_no_self CHECK (parent_line_id <> member_line_id)
);

ALTER TABLE nurock_schedule_line_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nurock_schedule_line_members_all ON nurock_schedule_line_members;
CREATE POLICY nurock_schedule_line_members_all ON nurock_schedule_line_members
  FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS nurock_schedule_line_members_parent_idx
  ON nurock_schedule_line_members USING btree (parent_line_id);

COMMIT;
