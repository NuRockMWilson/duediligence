import { createClient } from "@/lib/supabase/server";
import { getUwModel, type UwInfo } from "./uw-model";
import { getBudgetActuals, type BudgetActuals, type GlActivityRow } from "./budget-actuals";

// ============================================================================
// Budget Rollup — Phase 7.2.5 mapping architecture + eligible-basis fix
// ----------------------------------------------------------------------------
// Three-way join:
//   1. UW model lines     — deals.model.constructionBudget
//   2. UW → GL mapping    — dm_underwriting_line_gl  (universal, many-to-one)
//   3. Invoice actuals    — dm_invoice_lines aggregated by gl_account
//
// IMPORTANT — costEligible interpretation: stored as a DECIMAL FRACTION
// (0.0 to 1.0) in the UW model JSON, NOT as a dollar amount. To get the
// dollar value of eligible basis: line.amount × line.costEligible. Summing
// costEligible directly across lines produces nonsense (sum of fractions).
// ============================================================================

export type BudgetLineRollup = {
  modelLineId: string;
  description: string;
  category: string;
  uwBudget: number;
  costEligible: number;        // 0.0 - 1.0 fraction (% of line in eligible basis)
  eligibleAmount: number;      // dollar amount = uwBudget × costEligible
  ineligibleBasisAllocation: string | null;
  glAccounts: string[];
  actualInvoiced: number;
  actualPaid: number;
  actualEligible: number;
  invoiceLineCount: number;
  variance: number;
  pctDrawn: number;
  balance: number;
};

export type BudgetCategoryGroup = {
  category: string;
  lines: BudgetLineRollup[];
  uwBudget: number;
  actualInvoiced: number;
  actualPaid: number;
  eligibleAmount: number;      // dollar amount, sum of lines' eligibleAmount
  balance: number;
};

/** GlActivityRow enriched with UW line attribution (resolved via
 *  dm_underwriting_line_gl). Used by the Live Activity card and the
 *  Unmapped Activity card. */
export type EnrichedGlActivityRow = GlActivityRow & {
  uwLineDescription: string | null;
  uwLineSourceId: string | null;
};

export type BudgetRollup = {
  info: UwInfo | null;
  byLine: BudgetLineRollup[];
  byCategory: BudgetCategoryGroup[];
  totals: {
    uwBudget: number;
    eligibleAmount: number;
    actualInvoiced: number;
    actualPaid: number;
    actualEligible: number;
    balance: number;
    pctDrawn: number;
    variance: number;
  };
  liveActivity: {
    byGl: EnrichedGlActivityRow[];
    totalInvoiced: number;
    totalPaid: number;
    totalEligible: number;
    invoiceCount: number;
    lineCount: number;
  };
  unmappedActivity: EnrichedGlActivityRow[];
  diagnostics: {
    modelPresent: boolean;
    budgetLineCount: number;
    glAccountsInChart: number;
    glAccountsLinkedToModelLines: number;
    glAccountsWithActivity: number;
    glAccountsUnmapped: number;
    overrideCount: number;
    sharedGlCount: number;
    ulGlMappingsTotal: number;
  };
};

const EMPTY_DIAGNOSTICS = {
  modelPresent: false,
  budgetLineCount: 0,
  glAccountsInChart: 0,
  glAccountsLinkedToModelLines: 0,
  glAccountsWithActivity: 0,
  glAccountsUnmapped: 0,
  overrideCount: 0,
  sharedGlCount: 0,
  ulGlMappingsTotal: 0,
};

// =============================================================================
// Main entry
// =============================================================================

export async function getBudgetRollup(dealId: string): Promise<BudgetRollup> {
  const [model, actuals, mapping, chartSize] = await Promise.all([
    getUwModel(dealId),
    getBudgetActuals(dealId),
    getUlToGlMapping(),
    getChartOfAccountsSize(),
  ]);

  // Build source_line_id -> UW line description lookup (for enriching activity)
  const sourceLineIdToDescription = new Map<string, string>();
  if (model) {
    for (const uwLine of model.constructionBudget) {
      sourceLineIdToDescription.set(uwLine.id, uwLine.description);
    }
  }

  // Reverse map for enrichment: gl_account -> (source_line_id, description)
  const glToUwLine = new Map<string, { sourceId: string; description: string }>();
  for (const [sourceId, glAccounts] of mapping.sourceLineToGls) {
    const description = sourceLineIdToDescription.get(sourceId);
    if (!description) continue;
    for (const gl of glAccounts) {
      // First mapping wins (many UW lines can map to same GL — display the
      // first one we encounter; future enhancement: aggregate or pick "primary")
      if (!glToUwLine.has(gl)) {
        glToUwLine.set(gl, { sourceId, description });
      }
    }
  }

  // Enrich activity rows with their resolved UW line description
  const enrichRow = (row: GlActivityRow): EnrichedGlActivityRow => {
    const enrichment = glToUwLine.get(row.gl_account);
    return {
      ...row,
      uwLineDescription: enrichment?.description ?? null,
      uwLineSourceId: enrichment?.sourceId ?? null,
    };
  };

  const enrichedByGl = actuals.byGl.map(enrichRow);

  if (!model || model.constructionBudget.length === 0) {
    return {
      info: model?.info ?? null,
      byLine: [],
      byCategory: [],
      totals: {
        uwBudget: 0,
        eligibleAmount: 0,
        actualInvoiced: 0,
        actualPaid: 0,
        actualEligible: 0,
        balance: 0,
        pctDrawn: 0,
        variance: 0,
      },
      liveActivity: {
        byGl: enrichedByGl,
        totalInvoiced: actuals.totalInvoiced,
        totalPaid: actuals.totalPaid,
        totalEligible: actuals.totalEligible,
        invoiceCount: actuals.invoiceCount,
        lineCount: actuals.lineCount,
      },
      unmappedActivity: enrichedByGl.filter((r) => !r.uwLineDescription),
      diagnostics: {
        ...EMPTY_DIAGNOSTICS,
        modelPresent: model !== null,
        glAccountsInChart: chartSize,
        glAccountsLinkedToModelLines: mapping.distinctGlCount,
        glAccountsWithActivity: actuals.byGl.length,
        ulGlMappingsTotal: mapping.totalRows,
        sharedGlCount: mapping.sharedGlCount,
      },
    };
  }

  // GL-keyed actuals lookup
  const actualsByGl = new Map<string, GlActivityRow>(
    actuals.byGl.map((a) => [a.gl_account, a])
  );

  // Per-line rollup
  const byLine: BudgetLineRollup[] = [];
  const linkedGls = new Set<string>();

  for (const uwLine of model.constructionBudget) {
    const glAccounts = mapping.sourceLineToGls.get(uwLine.id) ?? [];

    let actualInvoiced = 0;
    let actualPaid = 0;
    let actualEligible = 0;
    let invoiceLineCount = 0;

    for (const gl of glAccounts) {
      const a = actualsByGl.get(gl);
      if (!a) continue;
      actualInvoiced += a.totalInvoiced;
      actualPaid += a.totalPaid;
      actualEligible += a.totalEligible;
      invoiceLineCount += a.lineCount;
      linkedGls.add(gl);
    }

    // CRITICAL: dollar eligible basis = amount × costEligible (decimal fraction)
    const eligibleAmount = uwLine.amount * uwLine.costEligible;

    byLine.push({
      modelLineId: uwLine.id,
      description: uwLine.description,
      category: uwLine.category,
      uwBudget: uwLine.amount,
      costEligible: uwLine.costEligible,
      eligibleAmount,
      ineligibleBasisAllocation: uwLine.ineligibleBasisAllocation,
      glAccounts,
      actualInvoiced,
      actualPaid,
      actualEligible,
      invoiceLineCount,
      variance: actualInvoiced - uwLine.amount,
      pctDrawn: uwLine.amount > 0 ? (actualInvoiced / uwLine.amount) * 100 : 0,
      balance: uwLine.amount - actualInvoiced,
    });
  }

  // Group by category (preserve order of first appearance)
  const seenCategories: string[] = [];
  const catMap = new Map<string, BudgetLineRollup[]>();
  for (const line of byLine) {
    if (!catMap.has(line.category)) seenCategories.push(line.category);
    const arr = catMap.get(line.category) ?? [];
    arr.push(line);
    catMap.set(line.category, arr);
  }

  const byCategory: BudgetCategoryGroup[] = seenCategories.map((cat) => {
    const lines = catMap.get(cat) ?? [];
    return {
      category: cat,
      lines,
      uwBudget: lines.reduce((s, l) => s + l.uwBudget, 0),
      actualInvoiced: lines.reduce((s, l) => s + l.actualInvoiced, 0),
      actualPaid: lines.reduce((s, l) => s + l.actualPaid, 0),
      eligibleAmount: lines.reduce((s, l) => s + l.eligibleAmount, 0),
      balance: lines.reduce((s, l) => s + l.balance, 0),
    };
  });

  // Unmapped — GLs with invoiced activity but no resolved UW line link
  const unmappedActivity = enrichedByGl.filter((r) => !r.uwLineDescription);

  // Totals
  const uwBudget = model.constructionBudget.reduce((s, l) => s + l.amount, 0);
  const eligibleAmount = model.constructionBudget.reduce(
    (s, l) => s + l.amount * l.costEligible,
    0
  );
  const actualInvoiced = actuals.totalInvoiced;
  const actualPaid = actuals.totalPaid;
  const actualEligible = actuals.totalEligible;
  const balance = uwBudget - actualInvoiced;
  const pctDrawn = uwBudget > 0 ? (actualInvoiced / uwBudget) * 100 : 0;
  const variance = actualInvoiced - uwBudget;

  return {
    info: model.info,
    byLine,
    byCategory,
    totals: {
      uwBudget,
      eligibleAmount,
      actualInvoiced,
      actualPaid,
      actualEligible,
      balance,
      pctDrawn,
      variance,
    },
    liveActivity: {
      byGl: enrichedByGl,
      totalInvoiced: actuals.totalInvoiced,
      totalPaid: actuals.totalPaid,
      totalEligible: actuals.totalEligible,
      invoiceCount: actuals.invoiceCount,
      lineCount: actuals.lineCount,
    },
    unmappedActivity,
    diagnostics: {
      modelPresent: true,
      budgetLineCount: model.constructionBudget.length,
      glAccountsInChart: chartSize,
      glAccountsLinkedToModelLines: mapping.distinctGlCount,
      glAccountsWithActivity: actuals.byGl.length,
      glAccountsUnmapped: unmappedActivity.length,
      overrideCount: 0,
      sharedGlCount: mapping.sharedGlCount,
      ulGlMappingsTotal: mapping.totalRows,
    },
  };
}

// =============================================================================
// UW Line → GL mapping (Phase 7.2.5)
// =============================================================================

type UlMapping = {
  sourceLineToGls: Map<string, string[]>;
  totalRows: number;
  distinctGlCount: number;
  sharedGlCount: number;
};

async function getUlToGlMapping(): Promise<UlMapping> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("dm_underwriting_line_gl")
    .select("source_line_id, gl_account");

  if (error) {
    console.error("[budget-rollup] dm_underwriting_line_gl:", error);
    return {
      sourceLineToGls: new Map(),
      totalRows: 0,
      distinctGlCount: 0,
      sharedGlCount: 0,
    };
  }

  type Row = { source_line_id: string; gl_account: string };
  const rows = (data ?? []) as Row[];

  const sourceLineToGls = new Map<string, string[]>();
  const ulsPerGl = new Map<string, number>();

  for (const r of rows) {
    if (!r.source_line_id || !r.gl_account) continue;
    const existing = sourceLineToGls.get(r.source_line_id) ?? [];
    if (!existing.includes(r.gl_account)) {
      existing.push(r.gl_account);
      sourceLineToGls.set(r.source_line_id, existing);
    }
    ulsPerGl.set(r.gl_account, (ulsPerGl.get(r.gl_account) ?? 0) + 1);
  }

  let sharedGlCount = 0;
  for (const count of ulsPerGl.values()) {
    if (count > 1) sharedGlCount += 1;
  }

  return {
    sourceLineToGls,
    totalRows: rows.length,
    distinctGlCount: ulsPerGl.size,
    sharedGlCount,
  };
}

async function getChartOfAccountsSize(): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("cost_account_map")
    .select("*", { count: "exact", head: true });

  if (error) {
    console.error("[budget-rollup] cost_account_map count:", error);
    return 0;
  }
  return count ?? 0;
}
