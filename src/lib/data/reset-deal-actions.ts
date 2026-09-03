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
import { assertDiligenceCan } from "@/lib/auth/access";

export async function resetDealBudgetAction(dealId: string): Promise<ResetDealResult> {
  // THE MOST DESTRUCTIVE ENDPOINT IN THIS REPO, AND IT WAS COMPLETELY OPEN.
  // resetDealBudgetToUw delegates to the realign RPC with zero_unmapped=TRUE, so
  // it rewrites a deal's budget schedule and zeroes any line not mapped to the
  // UW budget. As a bare "use server" export it was reachable by POST from any
  // authenticated session, with only the UW lock — a DATA state, not a
  // permission — standing in the way. An unlocked deal could be reset by anyone
  // who could sign in.
  //
  // Guarded at "edit" to match every other mutation in this repo rather than
  // inventing a stricter tier here. FLAGGED FOR MICHAEL: a budget reset is
  // arguably approve-or-admin work, and if he wants it narrower this is the one
  // line to change. Deliberately not narrowed on my own judgment, because
  // devmgmt gates the same operation at edit and a cross-app disagreement about
  // who may reset a budget is worse than either answer.
  await assertDiligenceCan("edit");

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
  // A read, but a read of one deal's lock state and override count — deal data,
  // so it takes the same "view" floor as every other deal read.
  await assertDiligenceCan("view");
  const [uwLock, manualOverrideCount] = await Promise.all([
    getDealUwLockState(dealId),
    countManualOverrides(dealId),
  ]);
  return { uwLock, manualOverrideCount };
}
