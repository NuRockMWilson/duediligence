// =============================================================================
// Deferred Developer Fee — live plug
// =============================================================================
// In a LIHTC sources & uses, the Deferred Developer Fee (DDF) is the PLUG: it
// absorbs whatever gap remains after every other committed source is applied
// to total uses. The underwriting model computes it exactly this way
// (buildSourcesUses → ddfPermanent = net uses − other net sources, surfaced
// to dev-mgmt via promoteDealToDevelopment).
//
// dm_funding_sources stores a SNAPSHOT of the DDF taken at promote time. When
// the UW model's uses later change (and the schedule is re-realigned) without
// a re-promote, that snapshot goes stale — Sources stop balancing to Uses.
// Foxcroft hit this: a $12,619 stale DDF made Net Sources exceed Net Uses.
//
// Rather than depend on a fresh snapshot, dev-mgmt computes the DDF as a live
// plug at read time. The Sources display then ALWAYS balances to Uses, and the
// staleness can never recur. The stored value remains for audit/export, but
// the displayed/effective DDF is this computed plug.
//
// Pure + dependency-free so it can be unit-tested and reused across rollups
// (schedule page, dashboard Sources & Uses bridge, etc.).
// =============================================================================

export interface PlugSourceInput {
  /** dm_funding_sources.kind — e.g. "construction_loan", "permanent_loan",
   *  "lihtc_equity", "construction_to_perm", "deferred_dev_fee". */
  kind: string | null;
  /** dm_funding_sources.commitment_amount (already coerced to a number). */
  commitment: number;
}

/**
 * Compute the Deferred Developer Fee as the sources/uses plug.
 *
 *   DDF = max(0, netUses − Σ(other net sources))
 *
 * "Net" excludes:
 *   - construction_loan sources (paid off at perm close — net 0 to project)
 *   - the deferred_dev_fee source itself (it's the plug being solved for)
 *
 * Clamped at 0: if the other sources already cover or exceed uses, the deal is
 * fully- or over-sourced and the plug is 0. A genuine over-source then shows
 * as Sources > Uses (which the variance banner still flags) rather than a
 * nonsensical negative DDF.
 */
export function computeDeferredDevFeePlug(
  netUses: number,
  sources: PlugSourceInput[]
): number {
  const otherNet = sources.reduce((sum, s) => {
    const k = (s.kind ?? "").toLowerCase();
    if (k === "construction_loan" || k === "deferred_dev_fee") return sum;
    return sum + (Number.isFinite(s.commitment) ? s.commitment : 0);
  }, 0);
  const plug = netUses - otherNet;
  // 2-decimal round to match dollar-cent storage; clamp negatives to 0.
  return Math.max(0, Math.round(plug * 100) / 100);
}

/** True when a funding-source kind is the deferred developer fee plug. */
export function isDeferredDevFeeKind(kind: string | null | undefined): boolean {
  return (kind ?? "").toLowerCase() === "deferred_dev_fee";
}
