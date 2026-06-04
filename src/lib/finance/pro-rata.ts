// ============================================================================
// Pro-Rata Allocation Algorithm
// ----------------------------------------------------------------------------
// Pure functions, no I/O. The Active Draw rollup and server actions call into
// these to compute per-source targets and apply them to invoices.
//
// Two modes:
//   pro_rata_invoice    — every invoice gets the same percentage split
//   pro_rata_aggregate  — bin-pack: minimize the number of split invoices
//
// Both modes use equity-first ordering: equity sources consume their
// available capacity in position order, THEN remaining splits across loan
// sources by commitment ratio.
// ============================================================================

/**
 * Funding source kinds that are treated as "equity" for the equity-first rule.
 * Anything not in this set is treated as a loan.
 *
 * Sourced from the Foxcroft DISTINCT kinds plus gp_capital (which doesn't
 * appear on Foxcroft but does on other deals). Update this when new equity
 * kinds are added.
 */
export const EQUITY_KINDS = new Set<string>([
  "lihtc_equity",
  "gp_capital",
  "deferred_dev_fee",
]);

export function isEquityKind(kind: string | null | undefined): boolean {
  return typeof kind === "string" && EQUITY_KINDS.has(kind);
}

// ----- Types ---------------------------------------------------------------

export type AllocationMode =
  | "manual"
  | "pro_rata_invoice"
  | "pro_rata_aggregate";

export interface ProRataSource {
  id: string;
  kind: string;
  position: number;
  commitmentAmount: number;
  /**
   * Total amount allocated to this source in submitted-or-later draws,
   * EXCLUDING the current draft draw. Used to compute remaining capacity.
   */
  drawnAmount: number;
  /**
   * Sum of released tranches for this source. For loans where the full
   * commitment is treated as available, set this to commitmentAmount.
   */
  releasedAmount: number;
}

export interface ProRataInvoice {
  id: string;
  netAmount: number;
}

export interface AllocationSplit {
  sourceId: string;
  amount: number;
}

export interface InvoiceAllocation {
  invoiceId: string;
  splits: AllocationSplit[];
}

// ----- Capacity ------------------------------------------------------------

/**
 * Compute remaining capacity for a source on this draw.
 *   equity → released - drawn  (can never use more than what's released)
 *   loan   → commitment - drawn  (can use up to the cap)
 */
export function computeAvailable(source: ProRataSource): number {
  if (isEquityKind(source.kind)) {
    return Math.max(0, source.releasedAmount - source.drawnAmount);
  }
  return Math.max(0, source.commitmentAmount - source.drawnAmount);
}

/** Sum of available capacity across all equity sources. */
export function totalAvailableEquity(sources: ProRataSource[]): number {
  return sources
    .filter((s) => isEquityKind(s.kind))
    .reduce((sum, s) => sum + computeAvailable(s), 0);
}

// ----- Target computation --------------------------------------------------

/**
 * Compute the pro-rata distribution target for a draw amount across sources.
 *
 * Algorithm:
 *  1. Equity sources (position-ordered) consume their available capacity
 *     until drawNet is exhausted OR equity capacity is exhausted.
 *  2. Remaining amount distributes across loan sources by commitment ratio,
 *     capped at each loan's available capacity.
 *  3. If loan available < target after capping, leftover stays unallocated
 *     (the diagnostic surfaces this at submit time).
 *
 * Returns: { [sourceId]: targetDollarAmount }
 */
export function computeProRataTargets(
  drawNet: number,
  sources: ProRataSource[]
): Record<string, number> {
  const targets: Record<string, number> = {};
  for (const s of sources) targets[s.id] = 0;
  if (drawNet <= 0.01 || sources.length === 0) return targets;

  let remaining = drawNet;

  // Phase 1: equity first
  const equitySources = sources
    .filter((s) => isEquityKind(s.kind))
    .sort((a, b) => a.position - b.position);

  for (const src of equitySources) {
    if (remaining <= 0.01) break;
    const avail = computeAvailable(src);
    const take = Math.min(avail, remaining);
    targets[src.id] = roundTo2(take);
    remaining -= take;
  }

  // Phase 2: loans by commitment ratio, capped at available
  if (remaining > 0.01) {
    const loanSources = sources.filter((s) => !isEquityKind(s.kind));
    const eligibleLoans = loanSources.filter(
      (s) => computeAvailable(s) > 0.01 && s.commitmentAmount > 0
    );
    const totalCommit = eligibleLoans.reduce(
      (sum, s) => sum + s.commitmentAmount,
      0
    );
    if (totalCommit > 0.01) {
      // First pass: compute desired by ratio, cap at available
      let stillRemaining = remaining;
      const uncapped: { src: ProRataSource; desired: number }[] = [];
      for (const src of eligibleLoans) {
        const ratio = src.commitmentAmount / totalCommit;
        const desired = remaining * ratio;
        const avail = computeAvailable(src);
        if (desired <= avail) {
          uncapped.push({ src, desired });
        } else {
          targets[src.id] = roundTo2(avail);
          stillRemaining -= avail;
        }
      }
      // Second pass: distribute stillRemaining across uncapped by their commit ratio
      if (uncapped.length > 0 && stillRemaining > 0.01) {
        const uncappedCommit = uncapped.reduce(
          (sum, x) => sum + x.src.commitmentAmount,
          0
        );
        if (uncappedCommit > 0.01) {
          for (const { src } of uncapped) {
            const ratio = src.commitmentAmount / uncappedCommit;
            const share = stillRemaining * ratio;
            targets[src.id] = roundTo2(
              Math.min(share, computeAvailable(src))
            );
          }
        }
      } else {
        // No capping needed — just use desired
        for (const { src, desired } of uncapped) {
          targets[src.id] = roundTo2(desired);
        }
      }
    }
  }

  return targets;
}

// ----- Mode: pro_rata_invoice ---------------------------------------------

/**
 * Every invoice gets the same percentage split.
 *
 * Example: targets = { L1: $750k, L2: $250k }, drawNet = $1M, percentages =
 * { L1: 75%, L2: 25% }. Each $100k invoice → $75k L1 + $25k L2.
 *
 * Rounding: per-invoice splits are rounded to 2 decimals; the LAST split per
 * invoice absorbs the rounding residual to ensure invoice total matches net.
 */
export function applyProRataByInvoice(
  invoices: ProRataInvoice[],
  targets: Record<string, number>
): InvoiceAllocation[] {
  const drawNet = invoices.reduce((s, i) => s + i.netAmount, 0);
  if (drawNet <= 0.01) {
    return invoices.map((inv) => ({ invoiceId: inv.id, splits: [] }));
  }

  // Build active sources (target > 0) sorted by amount descending for stable
  // residual placement.
  const activeSources = Object.entries(targets)
    .filter(([, amt]) => amt > 0.01)
    .sort((a, b) => b[1] - a[1]);

  if (activeSources.length === 0) {
    return invoices.map((inv) => ({ invoiceId: inv.id, splits: [] }));
  }

  const percentages: { sourceId: string; pct: number }[] = activeSources.map(
    ([sourceId, amt]) => ({ sourceId, pct: amt / drawNet })
  );

  return invoices.map((inv) => {
    const splits: AllocationSplit[] = [];
    let running = 0;
    for (let i = 0; i < percentages.length; i++) {
      const { sourceId, pct } = percentages[i];
      if (i === percentages.length - 1) {
        // Last split absorbs rounding residual
        const amount = roundTo2(inv.netAmount - running);
        if (amount > 0.01) splits.push({ sourceId, amount });
      } else {
        const amount = roundTo2(inv.netAmount * pct);
        if (amount > 0.01) {
          splits.push({ sourceId, amount });
          running += amount;
        }
      }
    }
    return { invoiceId: inv.id, splits };
  });
}

// ----- Mode: pro_rata_aggregate -------------------------------------------

/**
 * Bin-pack invoices into sources to MINIMIZE the number of split invoices
 * while hitting the target ratio.
 *
 * Algorithm (first-fit-decreasing):
 *  1. Sort invoices largest-to-smallest
 *  2. Process sources in equity-first → position-ascending order
 *  3. For each invoice, try to place it entirely in the source with the
 *     most remaining capacity. If none can hold it whole, split across
 *     consecutive sources in order until invoice is funded.
 *
 * Example: 4 × $100k invoices, targets = { L1: $300k, L2: $100k }:
 *   Inv #1 ($100k) → L1 (L1 has $200k left)
 *   Inv #2 ($100k) → L1 (L1 has $100k left)
 *   Inv #3 ($100k) → L1 (L1 has $0 left)
 *   Inv #4 ($100k) → L2 (L2 has $0 left)
 * Result: 0 split invoices, hit target exactly.
 *
 * Example: 3 × $100k invoices, targets = { L1: $240k, L2: $60k }:
 *   Inv #1 ($100k) → L1 (L1 has $140k left)
 *   Inv #2 ($100k) → L1 (L1 has $40k left)
 *   Inv #3 ($100k) → L1 $40k + L2 $60k (split)
 * Result: 1 split invoice, hit target exactly.
 */
export function applyProRataAggregate(
  invoices: ProRataInvoice[],
  sources: ProRataSource[],
  targets: Record<string, number>
): InvoiceAllocation[] {
  // Remaining capacity per source for THIS draw
  const remaining: Record<string, number> = {};
  for (const sid in targets) remaining[sid] = targets[sid];

  // Source order: equity by position, then loans by position
  const orderedSourceIds = [...sources]
    .filter((s) => (targets[s.id] ?? 0) > 0.01)
    .sort((a, b) => {
      const aEq = isEquityKind(a.kind) ? 0 : 1;
      const bEq = isEquityKind(b.kind) ? 0 : 1;
      if (aEq !== bEq) return aEq - bEq;
      return a.position - b.position;
    })
    .map((s) => s.id);

  // Sort invoices large-to-small for first-fit-decreasing
  const sorted = [...invoices].sort((a, b) => b.netAmount - a.netAmount);

  const result: InvoiceAllocation[] = [];

  for (const inv of sorted) {
    let unfunded = inv.netAmount;
    const splits: AllocationSplit[] = [];

    // 1. Try to place entirely in one source
    let placedWhole = false;
    for (const sid of orderedSourceIds) {
      if (remaining[sid] >= unfunded - 0.01) {
        splits.push({ sourceId: sid, amount: roundTo2(unfunded) });
        remaining[sid] = roundTo2(remaining[sid] - unfunded);
        placedWhole = true;
        break;
      }
    }

    // 2. If can't place whole, split across sources in order
    if (!placedWhole) {
      for (const sid of orderedSourceIds) {
        if (unfunded < 0.01) break;
        const avail = remaining[sid];
        if (avail <= 0.01) continue;
        const take = Math.min(avail, unfunded);
        splits.push({ sourceId: sid, amount: roundTo2(take) });
        remaining[sid] = roundTo2(avail - take);
        unfunded = roundTo2(unfunded - take);
      }
    }

    result.push({ invoiceId: inv.id, splits });
  }

  // Re-sort result to match original invoice order
  const indexMap = new Map(invoices.map((inv, i) => [inv.id, i]));
  result.sort(
    (a, b) =>
      (indexMap.get(a.invoiceId) ?? 0) - (indexMap.get(b.invoiceId) ?? 0)
  );

  return result;
}

// ----- Deviation diagnostic -----------------------------------------------

export interface ProRataDeviation {
  sourceId: string;
  targetAmount: number;
  actualAmount: number;
  deviation: number;
  deviationPct: number;
}

/**
 * Compare actual allocations against pro-rata targets to surface deviation.
 * Returns one entry per source where actual differs from target by > 1 cent.
 */
export function computeDeviations(
  targets: Record<string, number>,
  actualBySource: Record<string, number>
): ProRataDeviation[] {
  const sourceIds = new Set([
    ...Object.keys(targets),
    ...Object.keys(actualBySource),
  ]);
  const deviations: ProRataDeviation[] = [];
  for (const sid of sourceIds) {
    const target = targets[sid] ?? 0;
    const actual = actualBySource[sid] ?? 0;
    const diff = actual - target;
    if (Math.abs(diff) < 0.01) continue;
    const pct = target > 0.01 ? (diff / target) * 100 : actual > 0.01 ? 100 : 0;
    deviations.push({
      sourceId: sid,
      targetAmount: target,
      actualAmount: actual,
      deviation: diff,
      deviationPct: pct,
    });
  }
  return deviations;
}

/** Total absolute deviation in dollars across all sources. */
export function totalAbsDeviation(deviations: ProRataDeviation[]): number {
  return deviations.reduce((s, d) => s + Math.abs(d.deviation), 0);
}

// ----- Helpers -------------------------------------------------------------

function roundTo2(n: number): number {
  return Math.round(n * 100) / 100;
}
