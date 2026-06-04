// =============================================================================
// Paid By affiliates loader (org-wide + deal-scoped pre-development sources)
// =============================================================================
// One resilient fetch for the invoice "Paid By" picker and the Payables
// reimbursement rollup. Returns org-wide affiliates (deal_id null — NuRock
// Development/Construction) plus the given deal's pre-development sources.
//
// MIGRATION-SAFE: the deal_id column ships in migration 0080. If that migration
// hasn't been applied yet, the deal-scoped query errors; we fall back to the
// legacy org-only query so the picker still works (just without deal sources)
// rather than collapsing to "Deal directly" only.
// =============================================================================

import type { createClient } from "@/lib/supabase/server";

type DevmgmtClient = Awaited<ReturnType<typeof createClient>>;

export interface PaidByAffiliate {
  id: string;
  name: string;
  is_active: boolean;
  deal_id: string | null;
}

export interface AffiliateReimbursement {
  id: string;
  affiliate_id: string | null;
  affiliate_name: string;
  amount: number;
  reimbursement_date: string;
  notes: string | null;
}

/**
 * Mass reimbursements recorded against this deal's "Paid By" payers
 * (dm_affiliate_reimbursements, migration 0084). MIGRATION-SAFE: if the table
 * isn't present yet the query errors; we return [] so Payables still renders
 * (every payer simply shows $0 reimbursed / fully owed).
 */
export async function loadAffiliateReimbursements(
  supabase: DevmgmtClient,
  dealId: string
): Promise<AffiliateReimbursement[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  const res = await sb
    .from("dm_affiliate_reimbursements")
    .select("id, affiliate_id, affiliate_name, amount, reimbursement_date, notes")
    .eq("deal_id", dealId)
    .order("reimbursement_date", { ascending: false });

  if (res.error) {
    console.warn(
      "[affiliates] reimbursement load failed (apply migration 0084?):",
      res.error?.message
    );
    return [];
  }
  return (res.data ?? []) as AffiliateReimbursement[];
}

export async function loadPaidByAffiliates(
  supabase: DevmgmtClient,
  dealId: string
): Promise<PaidByAffiliate[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const scoped = await sb
    .from("dm_affiliates")
    .select("id, name, is_active, deal_id")
    .or(`deal_id.is.null,deal_id.eq.${dealId}`)
    .order("name", { ascending: true });

  if (!scoped.error) {
    return (scoped.data ?? []) as PaidByAffiliate[];
  }

  // Fallback: deal_id column not present (migration 0080 not applied yet).
  console.warn(
    "[affiliates] deal-scoped query failed; falling back to org-wide only. Apply migration 0080. ",
    scoped.error?.message
  );
  const legacy = await sb
    .from("dm_affiliates")
    .select("id, name, is_active")
    .order("name", { ascending: true });
  return ((legacy.data ?? []) as Array<{
    id: string;
    name: string;
    is_active: boolean;
  }>).map((a) => ({ ...a, deal_id: null }));
}
