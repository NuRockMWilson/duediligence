-- =============================================================================
-- Migration 0084 — Affiliate reimbursements (mass reimbursement toward sources)
-- =============================================================================
-- "Paid By" on an invoice points at a dm_affiliates row (NuRock Development /
-- Construction, or a deal's pre-development source). Each such invoice is an
-- amount FRONTED by that payer that must be reimbursed at closing.
--
-- Previously reimbursement was tracked per-invoice (dm_invoices.reimbursement_
-- date — blank = still owed). That's the wrong grain: reimbursements happen in
-- lump sums against a payer, not invoice-by-invoice. This table records each
-- reimbursement EVENT so the Payables tab can show, per payer:
--
--   fronted      = Σ dm_invoices.gross_amount where paid_by_affiliate_id = X
--   reimbursed   = Σ dm_affiliate_reimbursements.amount where affiliate_id = X
--   outstanding  = fronted − reimbursed   (what's still owed at close)
--
-- One row per reimbursement event (a payer can be reimbursed in several
-- tranches). Mirrors dm_retainage_releases (0073) in shape + conventions.
--
-- Additive + idempotent. The legacy dm_invoices.reimbursement_date column is
-- left in place (no longer read) so this migration is non-destructive.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS dm_affiliate_reimbursements (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- deals.id is TEXT (not uuid), so deal_id must be TEXT for the FK to match.
  -- Denormalized for cheap per-deal queries + RLS scoping without a join.
  deal_id            text NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  -- Payer being reimbursed. Nullable so a reimbursement survives the affiliate
  -- row being removed (the denormalized name preserves display continuity).
  affiliate_id       uuid REFERENCES dm_affiliates(id) ON DELETE SET NULL,
  affiliate_name     text NOT NULL,
  -- Reimbursed amount (positive dollars).
  amount             numeric NOT NULL CHECK (amount > 0),
  reimbursement_date date NOT NULL,
  notes              text,
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dm_affiliate_reimbursements_deal
  ON dm_affiliate_reimbursements (deal_id);
CREATE INDEX IF NOT EXISTS idx_dm_affiliate_reimbursements_affiliate
  ON dm_affiliate_reimbursements (affiliate_id);

-- ---------------------------------------------------------------------------
-- RLS — PUBLIC policy (omit TO clause; "TO authenticated" silently fails in
-- this project's setup, per the convention on every dm_ table).
-- ---------------------------------------------------------------------------
ALTER TABLE dm_affiliate_reimbursements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dm_affiliate_reimbursements_all ON dm_affiliate_reimbursements;
CREATE POLICY dm_affiliate_reimbursements_all
  ON dm_affiliate_reimbursements
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

DROP TRIGGER IF EXISTS trg_dm_affiliate_reimbursements_updated_at ON dm_affiliate_reimbursements;
CREATE TRIGGER trg_dm_affiliate_reimbursements_updated_at
  BEFORE UPDATE ON dm_affiliate_reimbursements
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Realtime: reflect reimbursements live on the Payables page (same publication
-- the notifications + draws + retainage releases use).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'dm_affiliate_reimbursements'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE dm_affiliate_reimbursements;
  END IF;
END;
$$;

COMMIT;
