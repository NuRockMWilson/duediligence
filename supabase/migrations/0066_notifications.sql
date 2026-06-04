BEGIN;

-- ============================================================================
-- Phase 1 — Notifications (cross-app, deal-scoped)
--
-- Unblocks live workflow signals: PM->CFO handoff, lender approval, COI
-- expiring, missing lien waivers, drift after promote, etc. Designed to span
-- the underwriting + dev-mgmt + future DD apps on the shared Supabase.
-- ============================================================================

CREATE TABLE IF NOT EXISTS dm_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id uuid NOT NULL,           -- auth.users.id (joins to app_users.user_id)
  deal_id text REFERENCES deals(id) ON DELETE CASCADE,
  kind text NOT NULL,                        -- e.g. 'pm_handoff','lender_approval','coi_expiring','uw_drift'
  subject text NOT NULL,
  body text,
  href text,                                 -- in-app deep link to the relevant page
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- PUBLIC RLS policy (per project convention — TO authenticated silently fails
-- at runtime on this project).
ALTER TABLE dm_notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dm_notifications_all ON dm_notifications;
CREATE POLICY dm_notifications_all ON dm_notifications
  FOR ALL USING (true) WITH CHECK (true);

-- Recipient feed: unread first, newest first.
CREATE INDEX IF NOT EXISTS dm_notifications_recipient_unread_idx
  ON dm_notifications (recipient_user_id, read_at, created_at DESC);

-- Per-deal activity feed.
CREATE INDEX IF NOT EXISTS dm_notifications_deal_idx
  ON dm_notifications (deal_id, created_at DESC);

COMMIT;
