-- =============================================================================
-- Migration 0072 — Lien waiver tracking (Ship 4 r2)
-- =============================================================================
-- Each construction draw period, the GC and subs submit lien waivers before
-- the draw can go to the lender:
--   - CONDITIONAL waiver for the CURRENT period (signed in exchange for the
--     payment about to be made)
--   - UNCONDITIONAL waiver for the PRIOR period (confirming prior payment
--     cleared)
--
-- We track one row per (draw, vendor, waiver_type). The vendors in a draw are
-- the distinct vendor_ids on the invoices included in that draw
-- (draw → dm_draw_lines.invoice_id → dm_invoices.vendor_id).
--
-- Status lifecycle:
--   pending   → not yet requested (default for a freshly-detected vendor)
--   requested → ask sent to the vendor (optional intermediate state)
--   received  → waiver collected; received_at + file_path populated
--   waived    → N/A for this vendor this period (e.g., a sub with no current
--               draw activity, or a deal where the lender doesn't require it)
--
-- The active-draw RequiredDocsCard reads this; the draw submit-gate surfaces
-- any non-(received|waived) rows as an advisory (soft block — see the rollup
-- change in code). File uploads mirror the invoice-attachment pattern via a
-- dedicated storage bucket.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS dm_lien_waivers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Denormalized deal_id (text, matches deals.id) for cheap per-deal queries
  -- + RLS scoping without a join back through dm_draws.
  deal_id     text NOT NULL,
  draw_id     uuid NOT NULL REFERENCES dm_draws(id) ON DELETE CASCADE,
  vendor_id   uuid NOT NULL REFERENCES dm_vendors(id),
  waiver_type text NOT NULL CHECK (waiver_type IN ('conditional', 'unconditional')),
  status      text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'requested', 'received', 'waived')),
  -- Populated when status flips to 'received'.
  received_at date,
  -- Supabase Storage path in the lien-waiver-attachments bucket (nullable —
  -- a waiver can be marked received without a scanned copy, then attached
  -- later).
  file_path   text,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  -- One row per (draw, vendor, waiver_type). Upserts key on this.
  UNIQUE (draw_id, vendor_id, waiver_type),
  -- A 'received' row must carry a received_at date (mirror the invoice
  -- payment-consistency pattern so the data can't go half-set).
  CONSTRAINT dm_lien_waivers_received_consistency_chk
    CHECK (status <> 'received' OR received_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_dm_lien_waivers_draw  ON dm_lien_waivers (draw_id);
CREATE INDEX IF NOT EXISTS idx_dm_lien_waivers_deal  ON dm_lien_waivers (deal_id);
CREATE INDEX IF NOT EXISTS idx_dm_lien_waivers_vendor ON dm_lien_waivers (vendor_id);

-- ---------------------------------------------------------------------------
-- RLS — PUBLIC policy (omit TO clause; "TO authenticated" silently fails in
-- this project's setup, per the established convention on every dm_ table).
-- ---------------------------------------------------------------------------
ALTER TABLE dm_lien_waivers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dm_lien_waivers_all ON dm_lien_waivers;
CREATE POLICY dm_lien_waivers_all
  ON dm_lien_waivers
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- updated_at touch trigger (reuse the shared set_updated_at() if present;
-- otherwise create a minimal one).
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

DROP TRIGGER IF EXISTS trg_dm_lien_waivers_updated_at ON dm_lien_waivers;
CREATE TRIGGER trg_dm_lien_waivers_updated_at
  BEFORE UPDATE ON dm_lien_waivers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Storage bucket for scanned waiver PDFs (mirrors invoice-attachments).
-- Private bucket; access via signed URLs from the server, same as invoices.
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('lien-waiver-attachments', 'lien-waiver-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- Realtime: let the active-draw page reflect waiver status live as the team
-- collects them (same publication the notifications + draws use).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'dm_lien_waivers'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE dm_lien_waivers;
  END IF;
END;
$$;

COMMIT;
