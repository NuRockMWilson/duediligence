-- =============================================================================
-- Migration 0073 — Retainage releases (Retainage module r1)
-- =============================================================================
-- Retainage is WITHHELD on draw lines (dm_draw_lines.retainage_amount, joined
-- to a vendor via the line's invoice). There was no way to record RELEASING
-- that retainage back to a vendor (typically at substantial / final
-- completion). This table records each release event so the Retainage module
-- can show withheld − released = outstanding per vendor.
--
--   withheld (derived)  = Σ dm_draw_lines.retainage_amount on submitted/funded
--                         draws, grouped by the line's invoice vendor
--   released (this tbl)  = Σ dm_retainage_releases.amount per vendor
--   outstanding          = withheld − released
--
-- One row per release event (a vendor can have several partial releases). The
-- optional milestone_id ties a release to the milestone that triggered it
-- (substantial completion, final completion); draw_id optionally links the
-- release to the draw it was paid through.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS dm_retainage_releases (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Denormalized deal_id (text, matches deals.id) for cheap per-deal queries
  -- + RLS scoping without a join.
  deal_id         text NOT NULL,
  -- Vendor the retainage is released to. Nullable so an "unassigned" bucket
  -- (draw lines with no invoice/vendor) can still be reconciled.
  vendor_id       uuid REFERENCES dm_vendors(id) ON DELETE SET NULL,
  -- Denormalized name for display continuity even if the vendor row changes.
  vendor_name     text NOT NULL,
  -- Released amount (positive dollars).
  amount          numeric NOT NULL CHECK (amount > 0),
  release_date    date NOT NULL,
  -- Optional link to the milestone that triggered the release.
  milestone_id    uuid REFERENCES dm_milestones(id) ON DELETE SET NULL,
  milestone_label text,
  -- Optional link to the draw the release was paid through.
  draw_id         uuid REFERENCES dm_draws(id) ON DELETE SET NULL,
  notes           text,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dm_retainage_releases_deal   ON dm_retainage_releases (deal_id);
CREATE INDEX IF NOT EXISTS idx_dm_retainage_releases_vendor ON dm_retainage_releases (vendor_id);

-- ---------------------------------------------------------------------------
-- RLS — PUBLIC policy (omit TO clause; "TO authenticated" silently fails in
-- this project's setup, per the convention on every dm_ table).
-- ---------------------------------------------------------------------------
ALTER TABLE dm_retainage_releases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dm_retainage_releases_all ON dm_retainage_releases;
CREATE POLICY dm_retainage_releases_all
  ON dm_retainage_releases
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- updated_at touch trigger (reuse the shared set_updated_at() if present).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at'
  ) THEN
    CREATE FUNCTION set_updated_at() RETURNS trigger
      LANGUAGE plpgsql AS $fn$
      BEGIN NEW.updated_at = now(); RETURN NEW; END;
      $fn$;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_dm_retainage_releases_updated_at ON dm_retainage_releases;
CREATE TRIGGER trg_dm_retainage_releases_updated_at
  BEFORE UPDATE ON dm_retainage_releases
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Realtime: reflect releases live on the Retainage page (same publication the
-- notifications + draws use).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'dm_retainage_releases'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE dm_retainage_releases;
  END IF;
END;
$$;

COMMIT;
