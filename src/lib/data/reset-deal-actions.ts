"use server";

// ============================================================================
// Phase 8.11c — Server action: reset deal budget to UW
// ----------------------------------------------------------------------------
// Thin "use server" wrapper around resetDealBudgetToUw so the client-side
// ResetToUwButton can invoke it without needing direct DB access. After a
// successful reset, callers should refresh the schedule data on their side
// (typically via router.refresh() or revalidatePath).
// ============================================================================

import {
  resetDealBudgetToUw,
  getDealUwLockState,
  countManualOverrides,
  type ResetDealResult,
  type UwLockState,
} from "@/lib/data/reset-deal-to-uw";

export async function resetDealBudgetAction(dealId: string): Promise<ResetDealResult> {
  // Double-check lock state on the server before delegating. The SQL function
  // also enforces this, but checking here lets us return a friendlier error
  // before round-tripping through the RPC.
  const lock = await getDealUwLockState(dealId);
  if (lock.locked) {
    return {
      success: false,
      error: `Underwriting is locked (locked ${new Date(lock.lockedAt!).toLocaleDateString()}). Use Change Orders for budget changes after lock.`,
    };
  }
  return resetDealBudgetToUw(dealId);
}

export async function getResetPreviewAction(dealId: string): Promise<{
  uwLock: UwLockState;
  manualOverrideCount: number;
}> {
  const [uwLock, manualOverrideCount] = await Promise.all([
    getDealUwLockState(dealId),
    countManualOverrides(dealId),
  ]);
  return { uwLock, manualOverrideCount };
}
