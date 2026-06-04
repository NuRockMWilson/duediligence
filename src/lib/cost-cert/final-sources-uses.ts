// =============================================================================
// Cost Cert — Final actual Sources & Uses (r2)
// =============================================================================
// The cost-cert S&U statement: actual (invoiced) uses by section vs the
// promoted budget (with variance), against the permanent capital stack
// (committed + funded). Construction loan is excluded from the permanent
// totals (it's bridge debt, repaid at conversion); deferred developer fee uses
// the live plug so the stack balances even if the stored snapshot is stale.
// Pure — the page assembles inputs from its existing line + source data.
// =============================================================================

export interface FinalUsesRow {
  section: string;
  budget: number;
  actual: number;
  variance: number; // budget − actual (positive = under budget / not fully spent)
}

export interface FinalSourceRow {
  name: string;
  kind: string;
  committed: number;
  funded: number;
  isBridge: boolean;
}

export interface FinalSourcesUses {
  uses: FinalUsesRow[];
  usesTotal: { budget: number; actual: number; variance: number };
  sources: FinalSourceRow[];
  sourcesTotal: { committed: number; funded: number };
  /** Permanent committed sources − actual uses. ~0 = balanced. */
  committedVsActual: number;
  /** Permanent committed sources − budget uses. */
  committedVsBudget: number;
}

export interface FinalSourcesUsesInput {
  lines: Array<{ section: string; revisedBudget: number; actualCost: number }>;
  sources: Array<{
    name: string;
    kind: string | null;
    commitment: number;
    drawn: number;
  }>;
  /** Live-plug deferred developer fee (computed by the caller). */
  ddfPlug: number;
}

const SECTION_LABELS: Record<string, string> = {
  acquisition: "Acquisition",
  construction_contract: "Construction",
  construction: "Construction",
  soft_costs: "Soft Costs",
  soft: "Soft Costs",
  financing: "Financing",
  developer_fee: "Developer Fee",
  reserves: "Reserves",
  other: "Other",
};

function sectionLabel(s: string): string {
  if (!s) return "Other";
  return SECTION_LABELS[s.toLowerCase()] ?? s.replace(/_/g, " ");
}

const isBridgeKind = (kind: string | null): boolean =>
  (kind ?? "").toLowerCase() === "construction_loan";

const isDdfKind = (kind: string | null): boolean =>
  (kind ?? "").toLowerCase() === "deferred_dev_fee";

export function computeFinalSourcesUses(
  input: FinalSourcesUsesInput
): FinalSourcesUses {
  // ----- Uses by section -----
  const bySection = new Map<string, { budget: number; actual: number }>();
  for (const l of input.lines) {
    const key = sectionLabel(l.section);
    const agg = bySection.get(key) ?? { budget: 0, actual: 0 };
    agg.budget += l.revisedBudget;
    agg.actual += l.actualCost;
    bySection.set(key, agg);
  }
  const uses: FinalUsesRow[] = Array.from(bySection.entries())
    .map(([section, v]) => ({
      section,
      budget: v.budget,
      actual: v.actual,
      variance: v.budget - v.actual,
    }))
    .filter((r) => r.budget !== 0 || r.actual !== 0)
    .sort((a, b) => b.budget - a.budget);

  const usesTotal = uses.reduce(
    (t, r) => ({
      budget: t.budget + r.budget,
      actual: t.actual + r.actual,
      variance: t.variance + r.variance,
    }),
    { budget: 0, actual: 0, variance: 0 }
  );

  // ----- Sources (permanent stack) -----
  const sources: FinalSourceRow[] = input.sources
    .map((s) => {
      const bridge = isBridgeKind(s.kind);
      const committed = isDdfKind(s.kind) ? input.ddfPlug : s.commitment;
      return {
        name: s.name || (s.kind ?? "Source"),
        kind: s.kind ?? "",
        committed,
        funded: s.drawn,
        isBridge: bridge,
      };
    })
    .filter((s) => s.committed !== 0 || s.funded !== 0)
    .sort((a, b) => Number(a.isBridge) - Number(b.isBridge) || b.committed - a.committed);

  // Permanent totals exclude bridge (construction-loan) debt.
  const sourcesTotal = sources.reduce(
    (t, s) =>
      s.isBridge
        ? t
        : { committed: t.committed + s.committed, funded: t.funded + s.funded },
    { committed: 0, funded: 0 }
  );

  return {
    uses,
    usesTotal,
    sources,
    sourcesTotal,
    committedVsActual: sourcesTotal.committed - usesTotal.actual,
    committedVsBudget: sourcesTotal.committed - usesTotal.budget,
  };
}
