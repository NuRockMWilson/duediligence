import { createClient } from "@/lib/supabase/server";
import { getUwModel } from "./uw-model";
import { getForecastData } from "@/lib/forecast/server";
import { NUROCK_STANDARD_FORMAT_ID } from "@/lib/formats";
import { formatDate } from "@/lib/format";
import {
  computeDeferredDevFeePlug,
  isDeferredDevFeeKind,
} from "@/lib/finance/deferred-dev-fee";
import { classifyCoi } from "@/lib/finance/coi-status";

// ============================================================================
// Dashboard Rollup — single server call producing every datum the dashboard
// shell needs. Layout stays mock-shaped; values are live.
// ============================================================================

// ----- Public types (shape matches mock constants exactly) ------------------

export type DashboardDeal = {
  name: string;
  city: string;
  county: string;
  units: number;
  structure: string;
  stage: string;
  constructionMonth: number;
  constructionTotalMonths: number;
  periodEnd: string;
};

export type DashboardKpis = {
  totalProjectCost: number;
  totalProjectCostDelta: number;
  drawnToDate: number;
  drawCount: number;
  hardCostPctComplete: number;
  forecastVariance: number;
  forecastVariancePct: number;
  openInvoices: number;
  openInvoiceAmount: number;
  retainageHeld: number;
  retainagePctOfHardCosts: number;
};

export type DashboardScheduleMilestone = {
  label: string;
  date: string;
  note: string;
  noteTone: "good" | "warn" | "neutral";
  status: "done" | "active" | "future";
};

export type DashboardLineItem = {
  vendor: string;
  invoice: string;
  date: string;
  amount: number;
  dfcc: string;
  sageAcct: string;
};

export type DashboardCategoryRow = {
  name: string;
  budget: number;
  drawn: number;
  remaining: number;
  pct: number;
  variance: number;
  kind: "cost" | "contingency";
  totalItemCount: number;
  lineItems: DashboardLineItem[];
};

/**
 * Contingency Burn-Down line. One row per draw-schedule line whose description
 * matches "Contingency" — typically "Construction Contingency" (in the
 * construction_contract section) and "Soft Cost Contingency" (in soft_costs).
 *
 *   originalBudget   — line's original_budget at promote time
 *   revisedBudget    — current revised_budget on the schedule (change orders
 *                      that MOVE contingency to other lines reduce this)
 *   drawn            — sum of net_amount across dm_draw_lines tied to the
 *                      schedule line (i.e., invoices coded to this line)
 *   budgetReduction  — originalBudget − revisedBudget (consumed via budget
 *                      moves rather than direct draws)
 *   totalConsumed    — drawn + budgetReduction
 *   remaining        — revisedBudget − drawn
 *   recentBurns      — top-5 invoice line draws against this schedule line,
 *                      newest first
 */
export type DashboardContingencyLine = {
  name: string;
  section: string;
  originalBudget: number;
  revisedBudget: number;
  drawn: number;
  budgetReduction: number;
  totalConsumed: number;
  remaining: number;
  recentBurns: Array<{
    vendor: string;
    invoice: string;
    date: string;
    amount: number;
  }>;
};

export type DashboardActivityItem = {
  icon: "draw" | "invoice" | "co" | "cert" | "waiver" | "equity";
  boldPrefix: string;
  rest: string;
  detail: string;
};

export type DashboardPayInMilestone = {
  label: string;
  trigger: string;
  amount: number;
  status: "received" | "triggered" | "pending";
  date: string;
};

export type DashboardFundingSource = {
  name: string;
  drawn: number;
  total: number;
  terms: string;
  tone: "navy" | "tan";
  milestones?: DashboardPayInMilestone[];
  /** ISO yyyy-mm-dd. When set, the source's commitment isn't available
   *  capital until this date. Inferred from name/kind against keyDates. */
  availableFromIso?: string | null;
  /** Human label for the availability anchor (e.g., "Perm Closing"). */
  availableFromLabel?: string | null;
};

export type DashboardAlert = {
  severity: "red" | "amber" | "blue";
  title: string;
  detail: string;
};

export type DashboardForecast = {
  remaining: number;
  components: { label: string; value: number; pct: number; tone: "navy" | "tan" }[];
  monteCarloLow: number | null;
  monteCarloHigh: number | null;
  probOnBudget: number | null;
};

export type DashboardScurvePoint = [number, number];

/** Compact cash-flow forecast summary for the dashboard KPI tile (Phase 8 r4).
 *  Null when the deal can't be forecast yet (no promoted budget / start date). */
export type DashboardForecastSummary = {
  minCash: number;
  minCashMonthIso: string | null;
  peakRevolverBalance: number;
  fundingGap: number;
  fundingGapMonthIso: string | null;
  fullyFunded: boolean;
} | null;

export type DashboardData = {
  deal: DashboardDeal;
  activeDrawNumber: number | null;
  kpis: DashboardKpis;
  scurveActual: DashboardScurvePoint[];
  scurvePlanned: DashboardScurvePoint[];
  scurveTodayX: number;
  scurveActualLabel: string | null;
  scurvePlannedLabel: string | null;
  scurveAxisLabels: string[];
  scheduleProgress: number;
  scheduleStart: string | null;
  scheduleTarget: string | null;
  scheduleVarianceLabel: string | null;
  scheduleVarianceTone: "good" | "warn" | "neutral";
  scheduleMilestones: DashboardScheduleMilestone[];
  categoryVariance: DashboardCategoryRow[];
  contingencyLines: DashboardContingencyLine[];
  recentActivity: DashboardActivityItem[];
  fundingSources: DashboardFundingSource[];
  alerts: DashboardAlert[];
  forecast: DashboardForecast;
  forecastSummary: DashboardForecastSummary;
};

// ============================================================================

export async function getDashboardData(dealId: string): Promise<DashboardData> {
  const supabase = await createClient();

  const [
    dealResult,
    drawsResult,
    invoicesResult,
    sourcesResult,
    ulGlResult,
    glToFormatResult,
    nrSchedLinesResult,
    contingencyLinesResult,
  ] = await Promise.all([
    supabase.from("deals").select("id, name, model").eq("id", dealId).maybeSingle(),
    supabase.from("dm_draws").select("*").eq("deal_id", dealId),
    supabase
      .from("dm_invoices")
      .select("id, vendor_id, vendor_name, invoice_number, invoice_date, net_amount, gross_amount, status, draw_id, created_at")
      .eq("deal_id", dealId),
    supabase
      .from("dm_funding_sources")
      .select("id, name, kind, lender_name, position, commitment_amount, drawn_amount")
      .eq("deal_id", dealId),
    supabase.from("dm_underwriting_line_gl").select("source_line_id, gl_account"),
    supabase.from("gl_to_format_line").select("gl_account, schedule_line_id, format_id"),
    supabase.from("nurock_standard_schedule_lines").select("id, description, section"),
    // Contingency draw-schedule lines for the burn-down card. Filters on
    // description ILIKE '%contingency%' so it picks up "Construction
    // Contingency" (construction_contract section) + "Soft Cost Contingency"
    // (soft_costs section). NuRock Standard format only — that's the schedule
    // the active draws roll up against.
    supabase
      .from("dm_draw_schedule_lines")
      .select("id, description, section, original_budget, revised_budget")
      .eq("deal_id", dealId)
      .eq("format_id", NUROCK_STANDARD_FORMAT_ID)
      .ilike("description", "%contingency%"),
  ]);

  const model = await getUwModel(dealId);

  // ----- Deal header ------------------------------------------------------
  const info = model?.info;
  const draws = (drawsResult.data ?? []) as Array<{
    id: string;
    draw_number: number | null;
    status: string | null;
    period_start: string | null;
    period_end: string | null;
    submitted_at: string | null;
    funded_at: string | null;
    total_gross_amount: number | string | null;
    total_net_amount: number | string | null;
    total_retainage_amount: number | string | null;
  }>;
  const fundedDraws = draws.filter((d) => d.funded_at);
  const drawIds = draws.map((d) => d.id);

  // Schedule dates from deal model.keyDates (the UW model's KeyDates object —
  // closingDate, constructionStart, construction25/50/75Complete, CO, PIS,
  // stabilization, permanentFinancingClosing, etc.). Fall back to dates
  // derived from draws ONLY if keyDates is entirely missing (deal not yet
  // promoted). getUwModel() parses keyDates as part of its return now.
  const keyDates = model?.keyDates ?? {
    closingDate: null,
    taxCreditPartnershipClosing: null,
    constructionStart: null,
    construction25Complete: null,
    construction50Complete: null,
    construction75Complete: null,
    constructionCompleteFirstBuilding: null,
    certificatesOfOccupancy: null,
    placedInService: null,
    operationsStart: null,
    stabilizationDate: null,
    permanentFinancingClosing: null,
    firstTaxCreditMonth: null,
    form8609Delivery: null,
    taxReturnDelivery: null,
    operatingReserveFundingDate: null,
    dispositionDate: null,
  };
  const constructionStart = keyDates.constructionStart
    ?? draws.map((d) => d.period_start).filter(Boolean).sort()[0]
    ?? null;
  // Use Certificate of Occupancy as the construction "target end" — that's
  // when development-management's work formally concludes. Fall back to
  // stabilization or latest draw period if CO isn't set.
  const constructionTargetEnd = keyDates.certificatesOfOccupancy
    ?? keyDates.constructionCompleteFirstBuilding
    ?? keyDates.stabilizationDate
    ?? draws.map((d) => d.period_end).filter(Boolean).sort().slice(-1)[0]
    ?? null;
  const constructionMonth = constructionStart
    ? monthsBetween(constructionStart, new Date().toISOString())
    : 0;
  const constructionTotalMonths = constructionStart && constructionTargetEnd
    ? monthsBetween(constructionStart, constructionTargetEnd)
    : 18;
  const periodEnd =
    [...draws].sort((a, b) => (b.period_end ?? "").localeCompare(a.period_end ?? ""))[0]?.period_end
    ?? endOfMonthIso(new Date());

  // ----- Active draw number ----------------------------------------------
  const sortedDesc = [...draws].sort(
    (a, b) => (b.draw_number ?? 0) - (a.draw_number ?? 0)
  );
  const activeDraw = sortedDesc.find((d) => !d.funded_at) ?? sortedDesc[0] ?? null;
  const activeDrawNumber = activeDraw?.draw_number ?? null;

  // ----- Construction budget (UW model) ----------------------------------
  type CbItem = { id: string; amount: number; category: string; description: string };
  const cbItems: CbItem[] = (model?.constructionBudget ?? []) as CbItem[];
  const totalProjectCost = cbItems.reduce((s, l) => s + (l.amount ?? 0), 0);

  // Category buckets from UW model
  const categoryBudget = new Map<string, { amount: number; lineIds: string[] }>();
  for (const item of cbItems) {
    const cat = (item.category ?? "Uncategorized").trim() || "Uncategorized";
    const entry = categoryBudget.get(cat) ?? { amount: 0, lineIds: [] };
    entry.amount += item.amount ?? 0;
    entry.lineIds.push(item.id);
    categoryBudget.set(cat, entry);
  }

  // ----- UL → GL → category lookup -------------------------------------
  type UlGl = { source_line_id: string; gl_account: string };
  const ulGls = (ulGlResult.data ?? []) as UlGl[];
  const ulToGls = new Map<string, string[]>();
  for (const r of ulGls) {
    if (!r.source_line_id || !r.gl_account) continue;
    const list = ulToGls.get(r.source_line_id) ?? [];
    if (!list.includes(r.gl_account)) list.push(r.gl_account);
    ulToGls.set(r.source_line_id, list);
  }
  // GL → category (reverse: GL points at multiple ULs which sit in categories;
  // we use first match for simple bucket mapping)
  const ulCategoryById = new Map<string, string>();
  for (const item of cbItems) {
    ulCategoryById.set(item.id, (item.category ?? "Uncategorized").trim() || "Uncategorized");
  }
  const glToCategory = new Map<string, string>();
  for (const r of ulGls) {
    const cat = ulCategoryById.get(r.source_line_id);
    if (cat && !glToCategory.has(r.gl_account)) {
      glToCategory.set(r.gl_account, cat);
    }
  }

  // ----- Draw lines ----------------------------------------------------
  let drawLines: Array<{
    draw_id: string;
    invoice_id: string | null;
    gl_account: string;
    net_amount: number | string | null;
    retainage_amount: number | string | null;
    draw_schedule_line_id: string | null;
  }> = [];
  if (drawIds.length > 0) {
    const { data, error } = await supabase
      .from("dm_draw_lines")
      .select(
        "draw_id, invoice_id, gl_account, net_amount, retainage_amount, draw_schedule_line_id"
      )
      .in("draw_id", drawIds);
    if (error) console.error("[dashboard-rollup] dm_draw_lines:", error);
    drawLines = data ?? [];
  }

  // Drawn by category, retainage total, hard-cost drawn
  const categoryDrawn = new Map<string, number>();
  let retainageHeld = 0;
  for (const dl of drawLines) {
    const amt = Number(dl.net_amount) || 0;
    retainageHeld += Number(dl.retainage_amount) || 0;
    const cat = glToCategory.get(dl.gl_account);
    if (!cat) continue;
    categoryDrawn.set(cat, (categoryDrawn.get(cat) ?? 0) + amt);
  }

  // Net retainage held against recorded releases (Retainage module). "Held"
  // means still outstanding = withheld − released, matching the Retainage page.
  // Best-effort: a missing dm_retainage_releases table (pre-migration) just
  // leaves the gross figure.
  try {
    const { data: relRows } = await (supabase as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (c: string, v: string) => Promise<{ data: Array<{ amount: number | string | null }> | null }>;
        };
      };
    })
      .from("dm_retainage_releases")
      .select("amount")
      .eq("deal_id", dealId);
    const released = (relRows ?? []).reduce((s, r) => s + (Number(r.amount) || 0), 0);
    retainageHeld = Math.max(0, retainageHeld - released);
  } catch (e) {
    console.error("[dashboard-rollup] retainage releases:", e);
  }

  // ----- KPIs ----------------------------------------------------------
  const drawnToDate = fundedDraws.reduce(
    (s, d) => s + (Number(d.total_net_amount) || 0),
    0
  );
  const drawCount = fundedDraws.length;

  // Hard cost = sum of Construction Costs + Other Construction Costs categories
  const HARD_COST_CATEGORIES = new Set([
    "Construction Costs",
    "Other Construction Costs",
  ]);
  let hardCostBudget = 0;
  for (const [cat, entry] of categoryBudget) {
    if (HARD_COST_CATEGORIES.has(cat)) hardCostBudget += entry.amount;
  }
  let hardCostDrawn = 0;
  for (const [cat, amt] of categoryDrawn) {
    if (HARD_COST_CATEGORIES.has(cat)) hardCostDrawn += amt;
  }
  const hardCostPctComplete = hardCostBudget > 0 ? (hardCostDrawn / hardCostBudget) * 100 : 0;
  const retainagePctOfHardCosts = hardCostDrawn > 0 ? (retainageHeld / hardCostDrawn) * 100 : 0;

  // Open invoices = approved invoices not in any draw
  const invoices = (invoicesResult.data ?? []) as Array<{
    id: string;
    vendor_name: string | null;
    invoice_number: string | null;
    invoice_date: string | null;
    net_amount: number | string | null;
    gross_amount: number | string | null;
    status: string | null;
    draw_id: string | null;
    created_at: string | null;
  }>;
  const openInvoiceList = invoices.filter(
    (inv) =>
      inv.draw_id == null &&
      (inv.status === "approved" || inv.status === "pending_approval" || inv.status === "ready")
  );
  const openInvoices = openInvoiceList.length;
  const openInvoiceAmount = openInvoiceList.reduce(
    (s, inv) => s + (Number(inv.net_amount ?? inv.gross_amount) || 0),
    0
  );

  // ----- Planned drawdown curve + schedule-pace variance (Ship 4 r4) ----
  // The "plan" is the construction-progress S-curve derived from the UW
  // keyDates milestones: constructionStart (0%) → 25% → 50% → 75% → CO
  // (100%). Expected cumulative draws at any month = interpolated % × TDC.
  // We compare that to actual cumulative funded draws at today to get:
  //   - forecastVariance ($): planned − actual  (>0 = drawing UNDER plan)
  //   - schedulePaceDeltaPct: actual% − planned% (>0 = AHEAD of pace)
  type PaceAnchor = { monthIndex: number; frac: number };
  const paceAnchors: PaceAnchor[] = [];
  if (constructionStart) {
    paceAnchors.push({ monthIndex: 0, frac: 0 });
    const addAnchor = (dateIso: string | null | undefined, frac: number) => {
      if (!dateIso) return;
      const mi = Math.max(0, monthsBetween(constructionStart, dateIso));
      paceAnchors.push({ monthIndex: mi, frac });
    };
    addAnchor(keyDates.construction25Complete, 0.25);
    addAnchor(keyDates.construction50Complete, 0.5);
    addAnchor(keyDates.construction75Complete, 0.75);
    addAnchor(
      keyDates.certificatesOfOccupancy ??
        keyDates.constructionCompleteFirstBuilding,
      1.0
    );
  }
  paceAnchors.sort((a, b) => a.monthIndex - b.monthIndex);

  // Piecewise-linear interpolation of planned cumulative fraction at a month.
  const plannedFracAtMonth = (mi: number): number => {
    if (paceAnchors.length === 0) return 0;
    if (mi <= paceAnchors[0].monthIndex) return paceAnchors[0].frac;
    const last = paceAnchors[paceAnchors.length - 1];
    if (mi >= last.monthIndex) return last.frac;
    for (let i = 0; i < paceAnchors.length - 1; i++) {
      const a = paceAnchors[i];
      const b = paceAnchors[i + 1];
      if (mi >= a.monthIndex && mi <= b.monthIndex) {
        const span = b.monthIndex - a.monthIndex || 1;
        const t = (mi - a.monthIndex) / span;
        return a.frac + (b.frac - a.frac) * t;
      }
    }
    return last.frac;
  };

  const todayMonthIndexForPace = constructionStart
    ? Math.max(0, monthsBetween(constructionStart, new Date().toISOString()))
    : 0;
  const plannedFracToday = plannedFracAtMonth(todayMonthIndexForPace);
  const plannedDrawnToday = plannedFracToday * totalProjectCost;
  const actualFracToday =
    totalProjectCost > 0 ? drawnToDate / totalProjectCost : 0;

  // Forecast variance in the SCurveCard's convention: planned − actual.
  // Positive = under plan (drawing slower than projected).
  const totalProjectCostDelta = 0;
  const forecastVariance =
    paceAnchors.length > 0 ? plannedDrawnToday - drawnToDate : 0;
  const forecastVariancePct =
    paceAnchors.length > 0 && totalProjectCost > 0
      ? (forecastVariance / totalProjectCost) * 100
      : 0;

  // Schedule-pace delta in percentage points (actual% − planned%).
  // >0 = ahead of the projected draw pace; <0 = behind.
  const schedulePaceDeltaPct =
    paceAnchors.length > 0 ? (actualFracToday - plannedFracToday) * 100 : 0;

  const kpis: DashboardKpis = {
    totalProjectCost,
    totalProjectCostDelta,
    drawnToDate,
    drawCount,
    hardCostPctComplete,
    forecastVariance,
    forecastVariancePct,
    openInvoices,
    openInvoiceAmount,
    retainageHeld,
    retainagePctOfHardCosts,
  };

  // ----- Category Variance --------------------------------------------
  // Pre-compute per-category draw line aggregates (line items come from
  // draw lines, which carry both gl_account and invoice_id; invoice metadata
  // is looked up separately by invoice_id)
  type CategoryLineSource = {
    invoiceId: string | null;
    glAccount: string;
    netAmount: number;
  };
  const linesByCategory = new Map<string, CategoryLineSource[]>();
  for (const dl of drawLines) {
    const cat = glToCategory.get(dl.gl_account);
    if (!cat) continue;
    const list = linesByCategory.get(cat) ?? [];
    list.push({
      invoiceId: dl.invoice_id,
      glAccount: dl.gl_account,
      netAmount: Number(dl.net_amount) || 0,
    });
    linesByCategory.set(cat, list);
  }
  // Invoice lookup by id — populated for line-item vendor / number / date
  const invoiceById = new Map<string, (typeof invoices)[number]>();
  for (const inv of invoices) {
    invoiceById.set(inv.id, inv);
  }
  // Sage account / DFCC mapping per GL — placeholder until cost_account_map lookup wired
  const glDescByGl = new Map<string, string>();
  // Build category rows
  const CONTINGENCY_KEYWORDS = ["Contingency", "Reserve"];
  const isContingencyCategory = (n: string) =>
    CONTINGENCY_KEYWORDS.some((k) => n.toLowerCase().includes(k.toLowerCase()));

  const categoryVariance: DashboardCategoryRow[] = [];
  const seenCats = new Set<string>();
  for (const [cat, entry] of categoryBudget) {
    seenCats.add(cat);
    const drawn = categoryDrawn.get(cat) ?? 0;
    const remaining = entry.amount - drawn;
    const pct = entry.amount > 0 ? (drawn / entry.amount) * 100 : 0;
    const variance = 0; // requires UW baseline; placeholder
    const catLines = (linesByCategory.get(cat) ?? [])
      .slice()
      .sort((a, b) => b.netAmount - a.netAmount);
    const lineItems: DashboardLineItem[] = catLines.slice(0, 4).map((cl) => {
      const inv = cl.invoiceId ? invoiceById.get(cl.invoiceId) : null;
      return {
        vendor: inv?.vendor_name ?? "—",
        invoice: inv?.invoice_number ?? (cl.invoiceId ? cl.invoiceId.slice(0, 8) : "—"),
        date: formatShortDate(inv?.invoice_date),
        amount: cl.netAmount,
        dfcc: glDescByGl.get(cl.glAccount) ?? "",
        sageAcct: cl.glAccount,
      };
    });
    categoryVariance.push({
      name: cat,
      budget: entry.amount,
      drawn,
      remaining,
      pct,
      variance,
      kind: isContingencyCategory(cat) ? "contingency" : "cost",
      totalItemCount: catLines.length,
      lineItems,
    });
  }
  categoryVariance.sort((a, b) => b.budget - a.budget);

  // ----- Contingency Burn-Down (per-line, exact) -----------------------
  // Replaces the old "filter categoryVariance by kind === 'contingency'"
  // approach (which incorrectly bucketed Operating Reserves under
  // contingency and missed the specific draw-schedule lines the user
  // tracks against). Now we read the actual lines from the active draw
  // schedule and roll up invoice-coded burns + budget reductions per line.
  type ContingencyRow = {
    id: string;
    description: string | null;
    section: string | null;
    original_budget: number | string | null;
    revised_budget: number | string | null;
  };
  const contingencyRows = (contingencyLinesResult.data ?? []) as ContingencyRow[];

  // Sum net_amount per draw_schedule_line_id (across all draws, not just
  // submitted — the burn-down reflects committed consumption regardless of
  // draw funding status).
  const drawnBySchedLine = new Map<string, number>();
  // Collect invoice-keyed burns per schedule line for the "Recent Burns"
  // list. We track each draw-line as its own burn event.
  const burnsBySchedLine = new Map<
    string,
    Array<{ invoiceId: string | null; netAmount: number }>
  >();
  for (const dl of drawLines) {
    const sl = dl.draw_schedule_line_id;
    if (!sl) continue;
    const amt = Number(dl.net_amount) || 0;
    drawnBySchedLine.set(sl, (drawnBySchedLine.get(sl) ?? 0) + amt);
    const list = burnsBySchedLine.get(sl) ?? [];
    list.push({ invoiceId: dl.invoice_id, netAmount: amt });
    burnsBySchedLine.set(sl, list);
  }

  const contingencyLines: DashboardContingencyLine[] = contingencyRows.map((r) => {
    const originalBudget = Number(r.original_budget) || 0;
    const revisedBudget =
      r.revised_budget != null && r.revised_budget !== ""
        ? Number(r.revised_budget) || 0
        : originalBudget;
    const drawn = drawnBySchedLine.get(r.id) ?? 0;
    // Budget reduction = original − revised. Positive when contingency was
    // moved OUT to other lines via change orders / reforecasts. Negative
    // values (contingency added) clamp to 0 — they aren't "consumed".
    const budgetReduction = Math.max(0, originalBudget - revisedBudget);
    const totalConsumed = drawn + budgetReduction;
    const remaining = revisedBudget - drawn;
    // Build recentBurns from the draw-line list, joining invoice metadata.
    const burns = burnsBySchedLine.get(r.id) ?? [];
    const recentBurns = burns
      .map((b) => {
        const inv = b.invoiceId ? invoiceById.get(b.invoiceId) : null;
        return {
          vendor: inv?.vendor_name ?? "—",
          invoice: inv?.invoice_number ?? (b.invoiceId ? b.invoiceId.slice(0, 8) : "—"),
          date: inv?.invoice_date ?? "",
          amount: b.netAmount,
        };
      })
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .slice(0, 5)
      .map((b) => ({ ...b, date: formatShortDate(b.date || null) }));

    return {
      name: r.description ?? "(unnamed)",
      section: r.section ?? "",
      originalBudget,
      revisedBudget,
      drawn,
      budgetReduction,
      totalConsumed,
      remaining,
      recentBurns,
    };
  });
  // Sort by largest original budget first so "Construction Contingency"
  // (~$1M+) appears before "Soft Cost Contingency" (~$100k).
  contingencyLines.sort((a, b) => b.originalBudget - a.originalBudget);

  // ----- Funding sources -----------------------------------------------
  const rawSources = (sourcesResult.data ?? []) as Array<{
    id: string;
    name: string;
    kind: string | null;
    lender_name: string | null;
    position: number | null;
    commitment_amount: number | string | null;
    drawn_amount: number | string | null;
  }>;
  // Funding-source availability inference. Each source's commitment becomes
  // "available capital" only on or after a specific keyDate:
  //   construction loan        → constructionStart
  //   permanent loan / 1st mtg → permanentFinancingClosing
  //   LIHTC equity             → closingDate (initial pay-in; later
  //                              installments tracked at milestone level)
  //   soft loan, DDF, other    → closingDate (default — most softs available
  //                              at closing). DDF is technically accrued
  //                              during construction and paid post-stab, but
  //                              for "available capital" purposes it's a
  //                              source the deal can rely on.
  function inferAvailability(name: string, kind: string | null): {
    iso: string | null;
    label: string | null;
  } {
    const haystack = `${name ?? ""} ${kind ?? ""}`.toLowerCase();
    if (
      /perm|first mortgage|1st mortgage|permanent/.test(haystack) &&
      !/construction/.test(haystack)
    ) {
      return {
        iso: keyDates.permanentFinancingClosing ?? null,
        label: "Perm Closing",
      };
    }
    if (/construction/.test(haystack)) {
      return {
        iso: keyDates.constructionStart ?? keyDates.closingDate ?? null,
        label: "Construction Start",
      };
    }
    if (/equity|lihtc|lp|gp/.test(haystack)) {
      return {
        iso:
          keyDates.taxCreditPartnershipClosing ?? keyDates.closingDate ?? null,
        label: "TC Closing",
      };
    }
    if (/ddf|deferred dev/.test(haystack)) {
      return {
        iso: keyDates.closingDate ?? null,
        label: "Closing (accrued)",
      };
    }
    // Default: most soft loans + everything else available at closing
    return {
      iso: keyDates.closingDate ?? null,
      label: keyDates.closingDate ? "Closing" : null,
    };
  }

  // Deferred Developer Fee = live sources/uses plug (see
  // lib/finance/deferred-dev-fee.ts). Computed from total project cost (uses)
  // and the other committed sources so the S&U Bridge always balances even
  // when the stored DDF snapshot is stale.
  const ddfPlug = computeDeferredDevFeePlug(
    totalProjectCost,
    rawSources.map((s) => ({
      kind: s.kind,
      commitment: Number(s.commitment_amount) || 0,
    }))
  );

  const fundingSources: DashboardFundingSource[] = rawSources
    .slice()
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((s) => {
      const commitment = isDeferredDevFeeKind(s.kind)
        ? ddfPlug
        : Number(s.commitment_amount) || 0;
      const drawn = Number(s.drawn_amount) || 0;
      const kindLower = (s.kind ?? "").toLowerCase();
      const tone: "navy" | "tan" = kindLower.includes("equity") ? "tan" : "navy";
      const lender = s.lender_name ? ` (${s.lender_name})` : "";
      const avail = inferAvailability(s.name, s.kind);
      return {
        name: `${s.name}${lender}`,
        drawn,
        total: commitment,
        terms: s.kind ?? "",
        tone,
        availableFromIso: avail.iso,
        availableFromLabel: avail.label,
      };
    });

  // ----- S-Curve actual line (monthly cumulative funded draws) ----------
  // Build per-month buckets from funded draws sorted by funded_at
  const sortedFundedDraws = fundedDraws
    .slice()
    .sort((a, b) => (a.funded_at ?? "").localeCompare(b.funded_at ?? ""));
  const monthlyCumulative: Array<{ monthIndex: number; cumNet: number }> = [];
  let cum = 0;
  for (const d of sortedFundedDraws) {
    if (!d.funded_at) continue;
    cum += Number(d.total_net_amount) || 0;
    const mi = constructionStart
      ? Math.max(0, monthsBetween(constructionStart, d.funded_at))
      : monthlyCumulative.length;
    monthlyCumulative.push({ monthIndex: mi, cumNet: cum });
  }
  // Map to SVG coords:
  //   x: 60 (start) → 780 (end), spanning constructionTotalMonths
  //   y: 230 (zero) → 30 (max), spanning $0 → ~$45M visual ceiling
  const xMin = 60, xMax = 780;
  const yMin = 230, yMax = 30;
  const yCeiling = Math.max(totalProjectCost, 45_000_000);
  const scurveActual: DashboardScurvePoint[] = monthlyCumulative.map(({ monthIndex, cumNet }) => {
    const xFrac = constructionTotalMonths > 0 ? monthIndex / constructionTotalMonths : 0;
    const yFrac = cumNet / yCeiling;
    const x = xMin + Math.min(1, xFrac) * (xMax - xMin);
    const y = yMin - Math.min(1, yFrac) * (yMin - yMax);
    return [Math.round(x), Math.round(y)];
  });

  // Planned curve (Ship 4 r4) — construction-progress S-curve from the
  // keyDates milestone anchors computed above (paceAnchors). Each anchor's
  // cumulative fraction × TDC gives the planned cumulative draw in dollars,
  // mapped to the same SVG coords as the actual line.
  const scurvePlanned: DashboardScurvePoint[] = paceAnchors.map(
    ({ monthIndex, frac }) => {
      const xFrac =
        constructionTotalMonths > 0 ? monthIndex / constructionTotalMonths : 0;
      const yFrac = (frac * totalProjectCost) / yCeiling;
      const x = xMin + Math.min(1, xFrac) * (xMax - xMin);
      const y = yMin - Math.min(1, yFrac) * (yMin - yMax);
      return [Math.round(x), Math.round(y)] as DashboardScurvePoint;
    }
  );

  // Today X
  const todayMonthIndex = constructionStart
    ? Math.max(0, monthsBetween(constructionStart, new Date().toISOString()))
    : 0;
  const todayFrac = constructionTotalMonths > 0 ? todayMonthIndex / constructionTotalMonths : 0;
  const scurveTodayX = Math.round(xMin + Math.min(1, todayFrac) * (xMax - xMin));

  // Today labels (at the today marker on each line)
  const lastActual = scurveActual[scurveActual.length - 1];
  const scurveActualLabel = lastActual
    ? `$${(monthlyCumulative[monthlyCumulative.length - 1].cumNet / 1_000_000).toFixed(2)}M`
    : null;
  // Planned label at today — the projected cumulative draw $ at this month.
  const scurvePlannedLabel =
    paceAnchors.length > 0
      ? `$${(plannedDrawnToday / 1_000_000).toFixed(2)}M`
      : null;

  // X-axis labels — 10 ticks across the construction window
  const scurveAxisLabels: string[] = [];
  if (constructionStart) {
    const startD = new Date(constructionStart);
    for (let i = 0; i < 10; i++) {
      const frac = i / 9;
      const monthsFromStart = Math.round(frac * constructionTotalMonths);
      const tickD = new Date(startD);
      tickD.setMonth(tickD.getMonth() + monthsFromStart);
      scurveAxisLabels.push(
        tickD.toLocaleDateString("en-US", { month: "short", year: "2-digit" }).toUpperCase()
      );
    }
  }

  // ----- Schedule milestones (derived from model.keyDates) --------------
  // Each LIHTC milestone with a date in keyDates becomes a milestone row.
  // Status:
  //   date <  today   → "done"
  //   date == nearest-future-date  → "active"
  //   else            → "future"
  // The nearest-future is the first keyDate that's >= today across all
  // populated dates, so the Gantt's "active" pip lands on whatever's
  // up next.
  const scheduleProgress = constructionTotalMonths > 0
    ? Math.min(100, (todayMonthIndex / constructionTotalMonths) * 100)
    : 0;
  const scheduleStart = constructionStart;
  const scheduleTarget = constructionTargetEnd;

  const todayIso = new Date().toISOString().slice(0, 10);
  const MILESTONE_ORDER: Array<{ key: keyof typeof keyDates; label: string }> = [
    { key: "closingDate", label: "Closing" },
    { key: "taxCreditPartnershipClosing", label: "Tax Credit Partnership Closing" },
    { key: "constructionStart", label: "Construction Start" },
    { key: "construction25Complete", label: "25% Complete" },
    { key: "construction50Complete", label: "50% Complete" },
    { key: "construction75Complete", label: "75% Complete" },
    { key: "constructionCompleteFirstBuilding", label: "Construction Complete (1st Bldg)" },
    { key: "certificatesOfOccupancy", label: "Certificates of Occupancy" },
    { key: "placedInService", label: "Placed in Service" },
    { key: "operationsStart", label: "Operations Start" },
    { key: "stabilizationDate", label: "Stabilization" },
    { key: "permanentFinancingClosing", label: "Permanent Loan Closing" },
    { key: "form8609Delivery", label: "Form 8609 Delivery" },
  ];
  const datedMilestones: Array<{ key: string; label: string; date: string }> = [];
  for (const m of MILESTONE_ORDER) {
    const date = keyDates[m.key];
    if (date) datedMilestones.push({ key: m.key, label: m.label, date });
  }
  // Find the nearest future milestone — that's the "active" one.
  const nextFuture = datedMilestones
    .filter((m) => m.date >= todayIso)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  const scheduleMilestones: DashboardScheduleMilestone[] = datedMilestones.map(
    (m) => {
      const status: "done" | "active" | "future" =
        m.date < todayIso
          ? "done"
          : nextFuture && m.key === nextFuture.key
            ? "active"
            : "future";
      return {
        label: m.label,
        date: m.date,
        note: "",
        noteTone: "neutral",
        status,
      };
    }
  );
  // Schedule-pace badge (Ship 4 r4) — actual draw % vs the planned
  // construction-progress curve at today. Within ±2 pts = "On pace";
  // behind = amber warn; ahead = green good. Neutral until construction
  // starts (no anchors / pre-start).
  let scheduleVarianceLabel: string | null = null;
  let scheduleVarianceTone: "good" | "warn" | "neutral" = "neutral";
  if (paceAnchors.length > 0 && todayMonthIndexForPace > 0) {
    const d = schedulePaceDeltaPct;
    if (Math.abs(d) < 2) {
      scheduleVarianceLabel = "On pace";
      scheduleVarianceTone = "good";
    } else if (d < 0) {
      scheduleVarianceLabel = `${Math.abs(d).toFixed(0)}% behind pace`;
      scheduleVarianceTone = "warn";
    } else {
      scheduleVarianceLabel = `${d.toFixed(0)}% ahead of pace`;
      scheduleVarianceTone = "good";
    }
  }

  // ----- Recent activity (derived from draws + invoices) --------------
  const recentActivity: DashboardActivityItem[] = [];
  // Funded draws (most recent first)
  for (const d of [...fundedDraws].sort(
    (a, b) => (b.funded_at ?? "").localeCompare(a.funded_at ?? "")
  ).slice(0, 3)) {
    recentActivity.push({
      icon: "draw",
      boldPrefix: `Draw #${d.draw_number ?? "?"}`,
      rest: "funded",
      detail: `$${(Number(d.total_net_amount) || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })} · ${formatShortDate(d.funded_at)}`,
    });
  }
  // Recent invoices (most recent first)
  for (const inv of invoices
    .slice()
    .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))
    .slice(0, 3)) {
    recentActivity.push({
      icon: "invoice",
      boldPrefix: `Invoice ${inv.invoice_number ?? `#${inv.id.slice(0, 6)}`}`,
      rest: `received from ${inv.vendor_name ?? "vendor"}`,
      detail: `$${(Number(inv.net_amount ?? inv.gross_amount) || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })} · ${formatShortDate(inv.invoice_date ?? inv.created_at)}`,
    });
  }

  // ----- Alerts & Tasks — empty list with note until rules are wired --
  // ----- COI expiration alerts (Ship 4 r3) ---------------------------
  // Surface vendors with invoices on this deal whose Certificate of
  // Insurance is expired or expiring within COI_SOON_DAYS. Sourced from
  // the deal's invoice vendors → dm_vendors.coi_expires_at.
  const alerts: DashboardAlert[] = [];
  const dealVendorIds = Array.from(
    new Set(
      invoices
        .map((inv) => (inv as { vendor_id?: string | null }).vendor_id)
        .filter((id): id is string => !!id)
    )
  );
  if (dealVendorIds.length > 0) {
    const { data: coiRows } = await supabase
      .from("dm_vendors")
      .select("id, name, coi_expires_at")
      .in("id", dealVendorIds);
    const todayIsoStr = new Date().toISOString().slice(0, 10);
    const expired: DashboardAlert[] = [];
    const expiring: DashboardAlert[] = [];
    for (const v of (coiRows ?? []) as Array<{
      id: string;
      name: string | null;
      coi_expires_at: string | null;
    }>) {
      const status = classifyCoi(v.coi_expires_at, todayIsoStr);
      const vname = v.name ?? "Vendor";
      if (status === "expired") {
        expired.push({
          severity: "red",
          title: `COI expired — ${vname}`,
          detail: `Insurance certificate expired ${formatShortDate(v.coi_expires_at)}. Collect a renewal before the next draw.`,
        });
      } else if (status === "expiring_soon") {
        expiring.push({
          severity: "amber",
          title: `COI expiring soon — ${vname}`,
          detail: `Insurance certificate expires ${formatShortDate(v.coi_expires_at)}.`,
        });
      }
    }
    // Expired first (red), then expiring (amber).
    alerts.push(...expired, ...expiring);
  }

  // ----- Forecast to Complete -----------------------------------------
  // Bucket remaining by major category groups
  let remainingHardCosts = 0;
  let remainingSoftCosts = 0;
  let remainingDevFee = 0;
  let remainingReserves = 0;
  for (const row of categoryVariance) {
    const rem = row.remaining;
    if (HARD_COST_CATEGORIES.has(row.name)) remainingHardCosts += rem;
    else if (row.name === "Developer Fees") remainingDevFee += rem;
    else if (row.name === "Project Reserves" || isContingencyCategory(row.name)) remainingReserves += rem;
    else remainingSoftCosts += rem;
  }
  const remaining = remainingHardCosts + remainingSoftCosts + remainingDevFee + remainingReserves;
  const totalForPct = Math.max(remaining, 1);
  const forecast: DashboardForecast = {
    remaining,
    components: [
      { label: "Remaining hard costs", value: remainingHardCosts, pct: (remainingHardCosts / totalForPct) * 100, tone: "navy" },
      { label: "Remaining soft costs", value: remainingSoftCosts, pct: (remainingSoftCosts / totalForPct) * 100, tone: "navy" },
      { label: "Remaining dev fee", value: remainingDevFee, pct: (remainingDevFee / totalForPct) * 100, tone: "navy" },
      { label: "Reserves", value: remainingReserves, pct: (remainingReserves / totalForPct) * 100, tone: "tan" },
    ],
    monteCarloLow: null,
    monteCarloHigh: null,
    probOnBudget: null,
  };

  // ----- Cash-flow forecast summary (Phase 8 r4) ----------------------
  // Reuses the forecast engine so the dashboard tile + the Forecasting page
  // never disagree. Wrapped defensively — a forecast failure must never break
  // the dashboard. A projected funding gap also surfaces as a red alert.
  let forecastSummary: DashboardForecastSummary = null;
  try {
    const f = await getForecastData(dealId);
    if (f.months.length > 0 && f.totalUses > 0) {
      forecastSummary = {
        minCash: f.minCash,
        minCashMonthIso: f.minCashMonthIso,
        peakRevolverBalance: f.peakRevolverBalance,
        fundingGap: f.fundingGap,
        fundingGapMonthIso: f.fundingGapMonthIso,
        fullyFunded: f.fullyFunded,
      };
      if (!f.fullyFunded && f.fundingGap > 0) {
        alerts.unshift({
          severity: "red",
          title: `Projected funding gap $${Math.round(f.fundingGap).toLocaleString("en-US")}`,
          detail: `Cash is projected to fall short${
            f.fundingGapMonthIso ? ` around ${formatShortDate(f.fundingGapMonthIso)}` : ""
          } once the construction loan is exhausted. Review the Forecasting tab.`,
        });
      }
    }
  } catch (e) {
    console.error("[dashboard-rollup] forecast summary:", e);
  }

  // ----- Compose ------------------------------------------------------
  const dealRow = dealResult.data;
  const deal: DashboardDeal = {
    name: (info?.projectName ?? dealRow?.name ?? "Untitled Deal"),
    city: info?.city ?? "—",
    county: (info as unknown as { county?: string } | undefined)?.county ?? "—",
    units: info?.totalUnits ?? 0,
    structure: info?.creditStructure?.replace(/_/g, " ") ?? "—",
    stage: "Active",
    constructionMonth: Math.max(0, Math.min(constructionMonth, constructionTotalMonths)),
    constructionTotalMonths: Math.max(constructionTotalMonths, 1),
    periodEnd: formatShortDate(periodEnd),
  };

  return {
    deal,
    activeDrawNumber,
    kpis,
    scurveActual,
    scurvePlanned,
    scurveTodayX,
    scurveActualLabel,
    scurvePlannedLabel,
    scurveAxisLabels,
    scheduleProgress,
    scheduleStart,
    scheduleTarget,
    scheduleVarianceLabel,
    scheduleVarianceTone,
    scheduleMilestones,
    categoryVariance,
    contingencyLines,
    recentActivity,
    fundingSources,
    alerts,
    forecast,
    forecastSummary,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function monthsBetween(startIso: string, endIso: string): number {
  const start = new Date(startIso);
  const end = new Date(endIso);
  return (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
}

function endOfMonthIso(d: Date): string {
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return last.toISOString().slice(0, 10);
}

function formatShortDate(iso: string | null | undefined): string {
  // Delegates to the centralized lib/format helper, which parses date-only
  // ISO (`YYYY-MM-DD`) as a LOCAL date — avoids the UTC-midnight TZ shift
  // that turns "2026-07-01" into "06/30/2026" in US time zones.
  if (!iso) return "—";
  return formatDate(iso, {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  });
}
