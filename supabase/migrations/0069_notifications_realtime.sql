-- =============================================================================
-- Migration 0069 — Enable realtime for dm_notifications
-- =============================================================================
-- Supabase Realtime broadcasts INSERT/UPDATE/DELETE row events to subscribed
-- clients when a table is part of the `supabase_realtime` publication.
-- Migration 0066 created dm_notifications but didn't add it to the
-- publication, so the bell can only refresh via server-action revalidation —
-- there's no live push.
--
-- This migration:
--   1. Adds dm_notifications to the supabase_realtime publication so
--      INSERT/UPDATE/DELETE events are published.
--   2. Sets REPLICA IDENTITY FULL so UPDATE events include the FULL old/new
--      row (needed for the client to compute diffs without an extra fetch).
--      Default is REPLICA IDENTITY DEFAULT (only PK + changed cols), which
--      means UPDATEs would arrive without recipient_user_id and break the
--      client-side filter.
--
-- Result: when sendNotification inserts a row, every subscribed client whose
-- recipient_user_id matches the row gets a push within ~100ms. The bell's
-- badge ticks up live, no navigation needed. Cross-app pays off: a notification
-- sent from underwriting appears live in devmgmt's bell.
-- =============================================================================

BEGIN;

-- Idempotent membership in the publication. The `IF NOT EXISTS`-style guard
-- has to be done by checking pg_publication_tables since ALTER PUBLICATION
-- doesn't support IF NOT EXISTS.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'dm_notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE dm_notifications;
    RAISE NOTICE 'Added dm_notifications to supabase_realtime publication.';
  ELSE
    RAISE NOTICE 'dm_notifications already in supabase_realtime publication.';
  END IF;
END;
$$;

ALTER TABLE dm_notifications REPLICA IDENTITY FULL;

COMMIT;
