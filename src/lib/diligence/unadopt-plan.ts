// =============================================================================
// What an unadopt will delete, and what it will keep
// =============================================================================
// PURE, AND EXTRACTED BECAUSE THIS COUNT HAS BEEN WRONG THREE TIMES.
//
//   Round 58  the toast said "0 rows deleted" after deleting 274 — the counts
//             were computed correctly and thrown away by a bare `return {}`.
//   Round 60c the toast said "248 rows deleted" while the dialog had promised
//             249, with nothing accounting for the missing one. The KEPT count
//             was derived from a set that had already been filtered to
//             status = 'not_started', so a row kept because someone had WORKED
//             it could not appear in it. kept was structurally incapable of
//             being anything but zero for the commonest case.
//
// Both were reporting failures over a delete that was itself correct, which is
// the recurring shape here: the operation works and the sentence describing it
// does not. So the decision lives in one tested place, and the property the
// tests assert is the one that broke — REMOVED AND KEPT PARTITION THE INPUT.
// A count derived from a subset cannot satisfy that.
//
// THE RULE ITSELF is unchanged and deliberate: an unadopt deletes rows nobody
// has touched and keeps rows carrying work, so detaching a lender's checklist
// never destroys what has already been collected against it. (Removing a PARTY
// from a deal follows a different, all-or-nothing rule — see removeDealEntity,
// which explains why the two diverge.)
// =============================================================================

/** The minimum needed to decide a row's fate. */
export interface UnadoptCandidate {
  id: string;
  status: string;
}

export interface UnadoptPlan {
  /** Rows safe to delete: not started, and carrying no documents or sign-offs. */
  removable: string[];
  /** Everything else — worked, documented, or signed off. */
  kept: number;
  /** Every row the packet contributed. removable.length + kept === this. */
  total: number;
}

/**
 * Decide which of a packet's rows go and which stay.
 *
 * `touched` is the set of row ids carrying documents or sign-offs. Only
 * not-started rows need that lookup: a row with any other status is kept on its
 * status alone.
 */
export function planUnadopt(
  candidates: UnadoptCandidate[],
  touched: Set<string>
): UnadoptPlan {
  const removable = candidates
    .filter((c) => c.status === "not_started" && !touched.has(c.id))
    .map((c) => c.id);
  return {
    removable,
    // THE COMPLEMENT OVER EVERY ROW, not over the not-started ones. Deriving
    // kept from the filtered set is exactly the round-60c bug.
    kept: candidates.length - removable.length,
    total: candidates.length,
  };
}

/** Rows that still need the document/sign-off lookup — the delete candidates. */
export function needsHistoryCheck(candidates: UnadoptCandidate[]): string[] {
  return candidates
    .filter((c) => c.status === "not_started")
    .map((c) => c.id);
}
