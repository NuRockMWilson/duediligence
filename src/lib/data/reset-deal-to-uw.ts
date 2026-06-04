// ============================================================================
// Phase 8.11c — Reset deal budget to UW
// ----------------------------------------------------------------------------
// Wraps the `reset_deal_budget_to_uw` RPC and exposes a small helper for
// reading the deal's UW lock state (the button needs to hide once UW locks).
//
// Both helpers use the server-side Supabase client; they're safe to call
// from server components, route handlers, or via "use server" actions.
// ============================================================================

import { createClient } from "@/lib/supabase/server";

export interface ResetDealResult {
  success: boolean;
  manual_overrides_cleared?: number;
  status?: string;
  error?: string;
}

/**
 * Reset all manual budget overrides on a deal and realign the schedule
 * to current UW model values. Server-side RPC enforces UW-lock guard.
 */
export async function resetDealBudgetToUw(dealId: string): Promise<ResetDealResult> {
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc("reset_deal_budget_to_uw", {
    p_deal_id: dealId,
  });
  if (error) {
    return { success: false, error: error.message ?? String(error) };
  }
  // RPC returns a single row (RETURNS TABLE → array of one)
  const row = Array.isArray(data) ? data[0] : data;
  return {
    success: true,
    manual_overrides_cleared: row?.manual_overrides_cleared ?? 0,
    status: row?.status,
  };
}

export interface UwLockState {
  locked: boolean;
  lockedAt: string | null;
  lockedBy: string | null;
}

/**
 * Read the UW lock state for a deal. Used by the dev-mgmt UI to gate
 * destructive actions (reset-to-UW, etc.) once underwriting is locked.
 */
export async function getDealUwLockState(dealId: string): Promise<UwLockState> {
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("deals")
    .select("model")
    .eq("id", dealId)
    .maybeSingle();
  if (error || !data?.model?.audit?.lockedAt) {
    return { locked: false, lockedAt: null, lockedBy: null };
  }
  return {
    locked: true,
    lockedAt: data.model.audit.lockedAt as string,
    lockedBy: (data.model.audit.lockedBy as string) ?? null,
  };
}

/**
 * Count of rows currently flagged with a manual budget override.
 * Used by the confirmation dialog to tell the user what they're about
 * to lose ("3 overrides will be discarded").
 */
export async function countManualOverrides(dealId: string): Promise<number> {
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count, error } = await (supabase as any)
    .from("dm_draw_schedule_lines")
    .select("id", { count: "exact", head: true })
    .eq("deal_id", dealId)
    .eq("metadata->>budget_manually_overridden", "true");
  if (error) return 0;
  return count ?? 0;
}
