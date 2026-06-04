import { createClient } from "@/lib/supabase/server";
import type {
  ScheduleRollup,
  GlDetail,
  MonthBucket,
  DrawColumn,
} from "./schedule-rollup";
import type {
  BudgetLineRollup,
  BudgetCategoryGroup,
} from "./budget-rollup";
import { getMappingByExcelDescription } from "./excel-aggregation-mapping";
import { NUROCK_STANDARD_FORMAT_ID } from "@/lib/formats";
import {
  computeDeferredDevFeePlug,
  isDeferredDevFeeKind,
} from "@/lib/finance/deferred-dev-fee";

// ============================================================================
// Deal Schedule Rollup (Phase 8.4 — Excel-match layout)
// ----------------------------------------------------------------------------
// Adapts the per-deal draw schedule (dm_draw_schedule_lines + dm_draws +
// dm_draw_lines) into the ScheduleRollup shape consumed by ScheduleShell,
// plus Excel-match extras: per-line funding-category allocations, sources
// rows, and per-line GL detail for expandable rows.
//
// Column structure matches the Foxcroft workbook "Draw Schedule" tab:
//
//   Uses section:
//     # | Description | Original | Revision | Revised |
//     Construction Funds | Equity Funds | Other Funds |
//     Draw 1 .. Draw N | Total Drawn | % | Balance to Finish
//
//   Sources During Construction section (same columns, appended below Uses
//   TOTAL):
//     each source row populates ONLY the funds-category column matching
//     its kind. Sources TOTAL should reconcile to Uses TOTAL.
// ============================================================================

// Source-kind to funds-category mapping (matches Excel categorization)
export type FundsCategory = "construction" | "equity" | "other";

export function categorizeSourceKind(kind: string): FundsCategory {
  if (kind === "construction_loan" || kind === "construction_to_perm") {
    return "construction";
  }
  if (kind === "lihtc_equity" || kind === "gp_capital") {
    return "equity";
  }
  return "other"; // permanent_loan, deferred_dev_fee, soft_loan, grant, etc.
}

export interface FundsBreakdown {
  construction: number;
  equity: number;
  other: number;
}

export interface SourceRowData {
  id: string;
  name: string;
  kind: string;
  category: FundsCategory;
  original: number;
  revised: number;
  perDraw: Record<string, number>;
  totalDrawn: number;
  balance: number;
}

export interface GlDetailRow {
  glAccount: string;
  description: string | null;
  perDraw: Record<string, number>;
  total: number;
}

/**
 * A single UW construction-budget line that contributes to an Excel-format
 * dm row. The full breakdown for one dm row is `UwSourceLine[]`.
 */
export interface UwSourceLine {
  /** UW model's line id (e.g. "cb52") */
  sourceLineId: string;
  /** UW line's description as it appears in the model */
  description: string;
  /** Contributing amount — `uwAmount` × `splitFraction` if a fractional
   *  allocation applies (e.g., Developer Fee split). For full allocation,
   *  equals `uwAmount`. */
  amount: number;
  /** Raw UW line amount (before split). Same as `amount` unless split. */
  uwAmount: number;
  /** If <1, the UW line contributes only a fraction to this dm row
   *  (Developer Fee split case). undefined means full allocation. */
  splitFraction?: number;
  /** "linked" = exact source_line_id match; "aggregated" = via
   *  EXCEL_AGGREGATION_MAPPING by description. */
  relationship: "linked" | "aggregated";
}

/**
 * Extras returned alongside the base ScheduleRollup. The shell accepts
 * `ScheduleRollup & Partial<ExcelExtras>` and falls back to base behavior
 * if these aren't present.
 */
export interface ExcelExtras {
  fundsByLine: Record<string, FundsBreakdown>;
  sources: SourceRowData[];
  glDetailsByDealLine: Record<string, GlDetailRow[]>;
  /** Phase 8.6: per-line flag indicating the user has manually overridden
   *  the budget via the inline editor in dev-mgmt. Lines flagged true
   *  should be skipped by future UW promotes. */
  manuallyOverriddenByLine: Record<string, boolean>;
  /** Phase 8.7: per-line breakdown of UW construction-budget lines that
   *  feed this dm row. Used by the row-expansion UI to show "where this
   *  number comes from". Empty array for rows with no UW counterpart
   *  (Predevelopment Costs, Brokerage Fee, etc.). */
  uwBreakdownByLine: Record<string, UwSourceLine[]>;
  /** Phase 8.7: sum of deal.model.constructionBudget amounts — the UW
   *  model's source-of-truth total. The schedule UI compares this to
   *  revisedTotal (dm's sum) and surfaces any variance. */
  uwModelTotal: number;
  /** Phase 8.7: UW lines that don't appear in the dm schedule via either
   *  direct link or aggregation mapping. Should be empty for a healthy deal. */
  uwOrphans: UwSourceLine[];
  uwBudgetTotal: number;
  revisedTotal: number;
  /** True when this deal was set up with a hand-curated schedule
   *  (deals.is_custom_schedule). For these the schedule intentionally
   *  differs from the NuRock Standard ↔ UW mapping, so the variance banner
   *  shows a "custom schedule" note instead of flagging the difference as
   *  an error. */
  isCustomSchedule: boolean;
}


const SECTION_LABELS: Record<string, string> = {
  soft_costs: "Soft Costs",
  construction_contract: "Construction Contract",
  hard_costs: "Hard Costs",
  acquisition: "Acquisition",
  financing: "Financing",
  reserves: "Reserves",
  developer_fee: "Developer Fee",
  other: "Other",
};

const SUBMITTED_STATUSES = new Set([
  "submitted",
  "pm_approved",
  "cfo_approved",
  "lender_approved",
  "funded",
]);

const FUNDED_STATUSES = new Set(["funded"]);

function sectionLabel(section: string | null | undefined): string {
  if (!section) return "Other";
  return (
    SECTION_LABELS[section] ??
    section
      .split("_")
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join(" ")
  );
}

function formatMonthYearLabel(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toLocaleString("en-US", { month: "short", year: "numeric" });
}

/**
 * TZ-safe `new Date(iso)` for date-only Postgres strings.
 *
 * Postgres `date` columns (dm_draws.submitted_at, dm_draws.period_end,
 * dm_draws.funded_at, etc.) serialize as `YYYY-MM-DD` with no timezone.
 * `new Date("2026-07-01")` parses that as UTC midnight, which in any US
 * time zone (UTC-4 / UTC-5) immediately rolls back to June 30 8pm. Any
 * subsequent `.getMonth()` / `.toLocaleString({ month: ... })` then reads
 * the previous calendar day's month. This helper anchors the constructor
 * in LOCAL time so the month + day stay intact.
 *
 * Full ISO timestamps (e.g. `2026-07-01T13:00:00Z`) include timezone info
 * and parse correctly via `new Date()` — those flow through unchanged.
 */
function dateFromIsoLocal(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatMonthKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

interface SchedLineRow {
  id: string;
  item_number: number | null;
  description: string;
  section: string | null;
  original_budget: number | string | null;
  revised_budget: number | string | null;
  metadata: Record<string, unknown> | null;
}

interface DrawRow {
  id: string;
  draw_number: number | null;
  status: string;
  submitted_at: string | null;
  funded_at: string | null;
  period_start: string | null;
  period_end: string | null;
}

interface DrawLineRow {
  id: string;
  draw_id: string;
  draw_schedule_line_id: string | null;
  gl_account: string;
  net_amount: number | string | null;
}

interface FundingSourceRow {
  id: string;
  name: string;
  kind: string;
  position: number;
  commitment_amount: number | string | null;
}

interface AllocationRow {
  draw_line_id: string;
  funding_source_id: string;
  amount: number | string | null;
}

interface CostAccountRow {
  gl_account: string;
  account_description: string;
}

export async function getDealScheduleRollup(
  dealId: string
): Promise<ScheduleRollup & ExcelExtras> {
  const supabase = await createClient();

  // ---- 1. Project info (for the page title in the shell header) ----
  const { data: dealRow } = await supabase
    .from("deals")
    .select("model")
    .eq("id", dealId)
    .maybeSingle();
  const model = (dealRow?.model ?? null) as { info?: ScheduleRollup["info"] } | null;
  const info = model?.info ?? null;

  // ---- 2. Per-deal schedule lines, draws ----
  const [schedRes, drawsRes] = await Promise.all([
    supabase
      .from("dm_draw_schedule_lines")
      .select(
        "id, item_number, description, section, original_budget, revised_budget, metadata"
      )
      .eq("deal_id", dealId)
      .eq("format_id", NUROCK_STANDARD_FORMAT_ID)
      // Defensive: never count "parked" rows (item_number >= 10000) left by
      // the legacy park-and-reinsert realign. Migration 0071 removes them at
      // the source, but this filter keeps every total here correct even if
      // one ever reappears — parked rows are duplicates and would
      // double-count the schedule total (the original $5.48M Foxcroft
      // variance was exactly this).
      .lt("item_number", 10000)
      .order("item_number", { ascending: true }),
    supabase
      .from("dm_draws")
      .select(
        "id, draw_number, status, submitted_at, funded_at, period_start, period_end"
      )
      .eq("deal_id", dealId)
      .order("draw_number", { ascending: true }),
  ]);

  const schedLines = (schedRes.data ?? []) as unknown as SchedLineRow[];
  const draws = (drawsRes.data ?? []) as unknown as DrawRow[];

  // ---- 3. Draw lines for those draws ----
  let drawLines: DrawLineRow[] = [];
  if (draws.length > 0) {
    const { data } = await supabase
      .from("dm_draw_lines")
      .select("id, draw_id, draw_schedule_line_id, gl_account, net_amount")
      .in(
        "draw_id",
        draws.map((d) => d.id)
      );
    drawLines = (data ?? []) as unknown as DrawLineRow[];
  }

  // ---- 3b. Funding sources, allocations, cost account map, UW model ----
  // Sources: for the Sources During Construction section (per-source rows)
  // Allocations: per-draw-line per-source amounts (drives funds-category columns)
  // Cost account map: pretty descriptions for GL accounts in expansion rows
  // UW model: deal.model.constructionBudget for Phase 8.7 source-breakdown rows
  const [sourcesRes, allocationsRes, costMapRes, dealRes, ulgRes, gtflRes] =
    await Promise.all([
    supabase
      .from("dm_funding_sources")
      .select("id, name, kind, position, commitment_amount")
      .eq("deal_id", dealId)
      .order("position", { ascending: true }),
    drawLines.length > 0
      ? supabase
          .from("dm_draw_line_allocations")
          .select("draw_line_id, funding_source_id, amount")
          .in(
            "draw_line_id",
            drawLines.map((dl) => dl.id)
          )
      : Promise.resolve({ data: [] as AllocationRow[] }),
    supabase
      .from("cost_account_map")
      .select("gl_account, account_description"),
    supabase
      .from("deals")
      .select("model, is_custom_schedule")
      .eq("id", dealId)
      .maybeSingle(),
    // GL-path mapping tables — the SAME path realign uses to populate budgets
    // (UW line → dm_underwriting_line_gl → gl_to_format_line → schedule line).
    // Used below to decide whether a UW line "has an Excel home". Without this
    // the orphan/variance banner used only the description-based
    // excel_aggregation_mapping, which disagrees with the GL path and falsely
    // flagged GL-mapped lines (Land, Land Loan Fees, Construction Loan
    // Interest, etc.) as orphans.
    supabase
      .from("dm_underwriting_line_gl")
      .select("source_line_id, gl_account"),
    supabase
      .from("gl_to_format_line")
      .select("gl_account, schedule_line_id")
      .eq("format_id", NUROCK_STANDARD_FORMAT_ID),
  ]);

  const fundingSources = (sourcesRes.data ?? []) as unknown as FundingSourceRow[];
  const allocations = (allocationsRes.data ?? []) as unknown as AllocationRow[];
  const costAccountMap = (costMapRes.data ?? []) as unknown as CostAccountRow[];

  // Build the set of UW source_line_ids that map via the GL path to a schedule
  // line in the NuRock Standard format. A UW line is GL-mapped when it has a
  // dm_underwriting_line_gl row whose gl_account has a gl_to_format_line entry
  // (i.e., the GL has a "home" on the standard schedule). This mirrors how
  // realign decides which UW dollars flow into the draw schedule.
  const ulgRows = (ulgRes.data ?? []) as unknown as Array<{
    source_line_id: string | null;
    gl_account: string | null;
  }>;
  const gtflRows = (gtflRes.data ?? []) as unknown as Array<{
    gl_account: string | null;
    schedule_line_id: string | null;
  }>;
  const glAccountsWithHome = new Set(
    gtflRows
      .filter((r) => r.gl_account && r.schedule_line_id)
      .map((r) => r.gl_account as string)
  );
  const glMappedUwIds = new Set<string>();
  for (const r of ulgRows) {
    if (r.source_line_id && r.gl_account && glAccountsWithHome.has(r.gl_account)) {
      glMappedUwIds.add(r.source_line_id);
    }
  }

  // Parse the UW model's constructionBudget array for Phase 8.7 source-breakdown
  interface UwLine { id: string; description: string; amount: number }
  const dealModel = (dealRes.data?.model ?? null) as
    | { constructionBudget?: Array<{ id?: string; description?: string; amount?: number | string }> }
    | null;
  const uwLines: UwLine[] = (dealModel?.constructionBudget ?? [])
    .filter((l) => l && typeof l.id === "string" && typeof l.description === "string")
    .map((l) => ({
      id: String(l.id),
      description: String(l.description),
      amount: Number(l.amount) || 0,
    }));

  // Lookups
  const sourceById = new Map(fundingSources.map((s) => [s.id, s]));
  const drawLineById = new Map(drawLines.map((dl) => [dl.id, dl]));
  const glDescById = new Map(
    costAccountMap.map((c) => [c.gl_account, c.account_description])
  );
  const uwById = new Map(uwLines.map((l) => [l.id, l]));
  const uwByDescription = new Map(uwLines.map((l) => [l.description, l]));

  // ---- 4. Build matrix: drawScheduleLineId → drawId → amount ----
  const byDrawByLine: Record<string, Record<string, number>> = {};
  for (const ln of drawLines) {
    const sid = ln.draw_schedule_line_id;
    if (!sid) continue;
    if (!byDrawByLine[sid]) byDrawByLine[sid] = {};
    const amt = Number(ln.net_amount) || 0;
    byDrawByLine[sid][ln.draw_id] =
      (byDrawByLine[sid][ln.draw_id] ?? 0) + amt;
  }

  // ---- 5. Draw columns (submitted + draft, in draw_number order) ----
  // The shell renders one column per draw. Submitted draws contribute to
  // Total Drawn; draft draws are visually distinct but excluded from totals.
  const drawColumns: DrawColumn[] = draws
    .filter((d) => SUBMITTED_STATUSES.has(d.status) || d.status === "draft")
    .map((d) => {
      const isSubmitted = SUBMITTED_STATUSES.has(d.status);
      const isFunded = FUNDED_STATUSES.has(d.status);
      const submittedDate = dateFromIsoLocal(d.submitted_at);
      const periodEndDate = dateFromIsoLocal(d.period_end);
      const monthDate = submittedDate ?? periodEndDate;

      // Per-column total = sum across all lines
      let total = 0;
      for (const sid of Object.keys(byDrawByLine)) {
        total += byDrawByLine[sid][d.id] ?? 0;
      }

      return {
        id: d.id,
        drawNumber: d.draw_number ?? 0,
        label: `Draw ${d.draw_number ?? "?"}`,
        monthLabel: formatMonthYearLabel(monthDate),
        status: d.status,
        isSubmitted,
        isFunded,
        submittedAt: d.submitted_at,
        fundedAt: d.funded_at,
        total,
      };
    });

  // ---- 6. drawnByLine = sum across submitted draws only ----
  const submittedDrawIds = new Set(
    drawColumns.filter((c) => c.isSubmitted).map((c) => c.id)
  );
  const drawnByLine: Record<string, number> = {};
  for (const sid of Object.keys(byDrawByLine)) {
    let drawn = 0;
    for (const did of submittedDrawIds) {
      drawn += byDrawByLine[sid][did] ?? 0;
    }
    drawnByLine[sid] = drawn;
  }

  // ---- 7. Adjustments per line = revised − original ----
  const adjustmentsByLine: Record<string, number> = {};
  for (const s of schedLines) {
    adjustmentsByLine[s.id] =
      (Number(s.revised_budget) || 0) - (Number(s.original_budget) || 0);
  }

  // ---- 8. byLine (BudgetLineRollup shape) ----
  const byLine: BudgetLineRollup[] = schedLines.map((s) => {
    const original = Number(s.original_budget) || 0;
    const revised = Number(s.revised_budget) || 0;
    const drawn = drawnByLine[s.id] ?? 0;
    return {
      modelLineId: s.id,
      description: s.description,
      category: sectionLabel(s.section),
      uwBudget: original,
      costEligible: 0,
      eligibleAmount: 0,
      ineligibleBasisAllocation: null,
      glAccounts: [],
      actualInvoiced: drawn,
      actualPaid: drawn,
      actualEligible: 0,
      invoiceLineCount: 0,
      variance: drawn - revised,
      pctDrawn: revised > 0 ? (drawn / revised) * 100 : 0,
      balance: revised - drawn,
    };
  });

  // ---- 9. Group by section (preserve first-appearance order) ----
  const seenSections: string[] = [];
  const sectionMap = new Map<string, BudgetLineRollup[]>();
  for (const line of byLine) {
    if (!sectionMap.has(line.category)) seenSections.push(line.category);
    const arr = sectionMap.get(line.category) ?? [];
    arr.push(line);
    sectionMap.set(line.category, arr);
  }
  const byCategory: BudgetCategoryGroup[] = seenSections.map((section) => {
    const lines = sectionMap.get(section) ?? [];
    return {
      category: section,
      lines,
      uwBudget: lines.reduce((s, l) => s + l.uwBudget, 0),
      actualInvoiced: lines.reduce((s, l) => s + l.actualInvoiced, 0),
      actualPaid: lines.reduce((s, l) => s + l.actualPaid, 0),
      eligibleAmount: 0,
      balance: lines.reduce((s, l) => s + l.balance, 0),
    };
  });

  // ---- 10. Totals (original/adjustments/revised semantics) ----
  const uwBudgetTotal = byLine.reduce((s, l) => s + l.uwBudget, 0);
  const adjustmentsTotal = Object.values(adjustmentsByLine).reduce(
    (s, v) => s + v,
    0
  );
  const revisedTotal = uwBudgetTotal + adjustmentsTotal;
  const drawnTotal = Object.values(drawnByLine).reduce((s, v) => s + v, 0);

  // ---- 11. monthBuckets + sectionByMonth + byMonthByLine (from draw activity) ----
  // Bucket each submitted draw by submitted_at month (fallback period_end).
  // Multiple draws in the same calendar month sum together.
  const sectionByMonth: Record<string, Record<string, number>> = {};
  const byMonthByLine: Record<string, Record<string, number>> = {};
  const monthKeyToTotal = new Map<string, number>();
  const monthKeyToLabel = new Map<string, string>();
  const lineToSection = new Map<string, string>();
  for (const s of schedLines) {
    lineToSection.set(s.id, sectionLabel(s.section));
  }

  for (const d of draws) {
    if (!SUBMITTED_STATUSES.has(d.status)) continue;
    const dateStr = d.submitted_at ?? d.period_end;
    if (!dateStr) continue;
    const date = dateFromIsoLocal(dateStr);
    if (!date) continue;
    const monthKey = formatMonthKey(date);
    monthKeyToLabel.set(monthKey, formatMonthYearLabel(date));

    for (const sid of Object.keys(byDrawByLine)) {
      const amt = byDrawByLine[sid][d.id] ?? 0;
      if (amt === 0) continue;

      // Per-line per-month
      if (!byMonthByLine[sid]) byMonthByLine[sid] = {};
      byMonthByLine[sid][monthKey] =
        (byMonthByLine[sid][monthKey] ?? 0) + amt;

      // Per-section per-month
      const section = lineToSection.get(sid) ?? "Other";
      if (!sectionByMonth[section]) sectionByMonth[section] = {};
      sectionByMonth[section][monthKey] =
        (sectionByMonth[section][monthKey] ?? 0) + amt;

      // Overall month total
      monthKeyToTotal.set(
        monthKey,
        (monthKeyToTotal.get(monthKey) ?? 0) + amt
      );
    }
  }

  const monthBuckets: MonthBucket[] = Array.from(monthKeyToTotal.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, total]) => ({
      key,
      label: monthKeyToLabel.get(key) ?? key,
      total,
    }));

  // ---- 12. glDetailsByLine: empty for the per-deal path (no GL data) ----
  const glDetailsByLine: Record<string, GlDetail[]> = {};
  for (const s of schedLines) glDetailsByLine[s.id] = [];

  // ============================================================================
  // EXCEL EXTRAS — Phase 8.4
  // ----------------------------------------------------------------------------
  // (A) fundsByLine — per Uses line, allocation split across construction/equity/other
  // (B) glDetailsByDealLine — per Uses line, breakdown by GL account with per-draw history
  // (C) sources — per Source row, with per-draw amounts and total drawn
  // ============================================================================

  // (A) and (C) need the allocation matrix:
  //     allocationByLineByCategory[lineId][category] = sum of allocations
  //     allocationBySource[sourceId][drawId] = amount  (for per-draw source columns)
  const fundsByLine: Record<string, FundsBreakdown> = {};
  for (const s of schedLines) {
    fundsByLine[s.id] = { construction: 0, equity: 0, other: 0 };
  }
  const allocationBySource: Record<string, Record<string, number>> = {};
  for (const src of fundingSources) allocationBySource[src.id] = {};
  const sourceDrawnTotals: Record<string, number> = {};
  for (const src of fundingSources) sourceDrawnTotals[src.id] = 0;

  for (const alloc of allocations) {
    const drawLine = drawLineById.get(alloc.draw_line_id);
    if (!drawLine) continue;
    const src = sourceById.get(alloc.funding_source_id);
    if (!src) continue;
    const amt = Number(alloc.amount) || 0;
    if (amt === 0) continue;

    // Only count submitted draws toward fundsByLine and sourceDrawnTotals
    // (drafts shouldn't count as actuals). drawLine.draw_id maps back to a draw row;
    // we filter using submittedDrawIds computed earlier in this function.
    const isSubmittedDraw = submittedDrawIds.has(drawLine.draw_id);
    if (!isSubmittedDraw) continue;

    const schedLineId = drawLine.draw_schedule_line_id;
    const category = categorizeSourceKind(src.kind);

    if (schedLineId && fundsByLine[schedLineId]) {
      fundsByLine[schedLineId][category] += amt;
    }
    allocationBySource[src.id][drawLine.draw_id] =
      (allocationBySource[src.id][drawLine.draw_id] ?? 0) + amt;
    sourceDrawnTotals[src.id] += amt;
  }

  // (C) Build sources array — one row per funding source
  // Deferred Developer Fee is the sources/uses PLUG — computed live from the
  // current schedule (uses) and the other committed sources, so Sources always
  // balance to Uses even when the stored DDF snapshot is stale. See
  // lib/finance/deferred-dev-fee.ts. revisedTotal is the net uses (Σ revised
  // budget across the live schedule lines).
  const ddfPlug = computeDeferredDevFeePlug(
    revisedTotal,
    fundingSources.map((s) => ({
      kind: s.kind,
      commitment: Number(s.commitment_amount) || 0,
    }))
  );

  const sources: SourceRowData[] = fundingSources.map((src) => {
    // Override the DDF commitment with the live plug; all other sources use
    // their stored commitment.
    const commitment = isDeferredDevFeeKind(src.kind)
      ? ddfPlug
      : Number(src.commitment_amount) || 0;
    const totalDrawn = sourceDrawnTotals[src.id] ?? 0;
    return {
      id: src.id,
      name: src.name,
      kind: src.kind,
      category: categorizeSourceKind(src.kind),
      original: commitment,
      revised: commitment, // no separate revision on the source today; show same
      perDraw: allocationBySource[src.id] ?? {},
      totalDrawn,
      balance: commitment - totalDrawn,
    };
  });

  // (B) glDetailsByDealLine — per dm_draw_schedule_lines.id, per GL account, per draw
  // Walk drawLines (which carry both gl_account AND draw_schedule_line_id);
  // group by (schedule_line_id, gl_account); aggregate per-draw amounts.
  const glDetailsByDealLine: Record<string, GlDetailRow[]> = {};
  const _glAcc: Record<
    string,
    Record<string, { perDraw: Record<string, number>; total: number }>
  > = {};
  for (const dl of drawLines) {
    const sid = dl.draw_schedule_line_id;
    if (!sid) continue;
    const gl = dl.gl_account;
    const amt = Number(dl.net_amount) || 0;
    if (amt === 0) continue;
    if (!_glAcc[sid]) _glAcc[sid] = {};
    if (!_glAcc[sid][gl]) _glAcc[sid][gl] = { perDraw: {}, total: 0 };
    _glAcc[sid][gl].perDraw[dl.draw_id] =
      (_glAcc[sid][gl].perDraw[dl.draw_id] ?? 0) + amt;
    _glAcc[sid][gl].total += amt;
  }
  for (const sid of Object.keys(_glAcc)) {
    glDetailsByDealLine[sid] = Object.entries(_glAcc[sid])
      .sort(([glA], [glB]) => glA.localeCompare(glB))
      .map(([glAccount, data]) => ({
        glAccount,
        description: glDescById.get(glAccount) ?? null,
        perDraw: data.perDraw,
        total: data.total,
      }));
  }
  // Ensure every schedule line has a (possibly empty) entry for UI consistency
  for (const s of schedLines) {
    if (!glDetailsByDealLine[s.id]) glDetailsByDealLine[s.id] = [];
  }

  // ---- Per-line manual-override flag (Phase 8.6 — for inline editor) ----
  // metadata.budget_manually_overridden = true means the user edited this
  // line's budget inline; future re-promotes should skip it.
  const manuallyOverriddenByLine: Record<string, boolean> = {};
  for (const s of schedLines) {
    const meta = (s.metadata ?? {}) as Record<string, unknown>;
    manuallyOverriddenByLine[s.id] = meta.budget_manually_overridden === true;
  }

  // ---- Per-line UW source breakdown (Phase 8.7 — for expandable rows) ----
  // Two paths:
  //  (a) Linked rows: metadata.source_line_id is set → single UW line lookup
  //  (b) Aggregated rows: look up the DB-backed aggregation mapping by description
  //      → list of UW lines (with optional splitFraction for Developer Fee)
  // Rows with no UW counterpart (Predevelopment Costs, etc.) get an empty array.
  // Phase 8.10: mapping now comes from `excel_aggregation_mapping` table.
  const mappingByDesc = await getMappingByExcelDescription();
  const uwBreakdownByLine: Record<string, UwSourceLine[]> = {};
  for (const s of schedLines) {
    const meta = (s.metadata ?? {}) as Record<string, unknown>;
    const sourceLineId = meta.source_line_id as string | undefined;

    // (a) Direct link
    if (sourceLineId) {
      const uw = uwById.get(sourceLineId);
      if (uw) {
        uwBreakdownByLine[s.id] = [
          {
            sourceLineId: uw.id,
            description: uw.description,
            amount: uw.amount,
            uwAmount: uw.amount,
            relationship: "linked",
          },
        ];
        continue;
      }
    }

    // (b) Aggregation mapping
    const mapping = mappingByDesc[s.description];
    if (mapping) {
      const split = mapping.splitFraction;
      uwBreakdownByLine[s.id] = mapping.uwDescriptions
        .map((desc) => uwByDescription.get(desc))
        .filter((u): u is UwLine => u !== undefined)
        .map((uw) => ({
          sourceLineId: uw.id,
          description: uw.description,
          amount: split !== undefined ? uw.amount * split : uw.amount,
          uwAmount: uw.amount,
          splitFraction: split,
          relationship: "aggregated",
        }));
      continue;
    }

    // (c) No UW counterpart
    uwBreakdownByLine[s.id] = [];
  }

  // Compute the UW model's grand total (sum of all UW construction budget lines).
  // This is the source-of-truth total that dev-mgmt should mirror.
  const uwModelTotal = uwLines.reduce((sum, l) => sum + l.amount, 0);

  // Identify UW lines that aren't mapped anywhere — these are the source of
  // any UW total vs dev-mgmt total variance (other than manual edits).
  // We consider a UW line "mapped" if any dm row's uwBreakdown references it.
  const mappedUwIds = new Set<string>();
  for (const breakdown of Object.values(uwBreakdownByLine)) {
    for (const uw of breakdown) {
      mappedUwIds.add(uw.sourceLineId);
    }
  }
  // A UW line is "homed" if it maps EITHER via the description-aggregation /
  // direct-link path (mappedUwIds, drives the expandable breakdown rows) OR
  // via the GL path that realign uses to populate budgets (glMappedUwIds).
  // Only lines with NO home under either system are true orphans — those are
  // the ones that legitimately don't reach the draw schedule and explain a
  // variance. This stops the banner from crying "no Excel home" for lines
  // whose dollars ARE in the schedule via the GL path.
  const uwOrphans: UwSourceLine[] = uwLines
    .filter(
      (l) =>
        l.amount > 0 && !mappedUwIds.has(l.id) && !glMappedUwIds.has(l.id)
    )
    .map((l) => ({
      sourceLineId: l.id,
      description: l.description,
      amount: l.amount,
      uwAmount: l.amount,
      relationship: "aggregated" as const,
    }));

  // ---- 13. Assemble ----
  return {
    info,
    byLine,
    byCategory,
    totals: {
      uwBudget: uwBudgetTotal,
      eligibleAmount: 0,
      actualInvoiced: drawnTotal,
      actualPaid: drawnTotal,
      actualEligible: 0,
      balance: revisedTotal - drawnTotal,
      pctDrawn: revisedTotal > 0 ? (drawnTotal / revisedTotal) * 100 : 0,
      variance: drawnTotal - revisedTotal,
    },
    liveActivity: {
      byGl: [],
      totalInvoiced: drawnTotal,
      totalPaid: drawnTotal,
      totalEligible: 0,
      invoiceCount: 0,
      lineCount: 0,
    },
    unmappedActivity: [],
    diagnostics: {
      modelPresent: schedLines.length > 0,
      budgetLineCount: schedLines.length,
      glAccountsInChart: 0,
      glAccountsLinkedToModelLines: 0,
      glAccountsWithActivity: 0,
      glAccountsUnmapped: 0,
      overrideCount: 0,
      sharedGlCount: 0,
      ulGlMappingsTotal: 0,
    },
    scheduleFormat: {
      id: "deal-specific",
      name: "NuRock Standard (per-deal)",
      slug: "deal-specific",
    },
    attribution: {
      uwLinesAttributed: schedLines.length,
      uwLinesNotAttributed: 0,
      notAttributedAmount: 0,
      splitLineCount: 0,
    },
    monthBuckets,
    glDetailsByLine,
    byMonthByLine,
    adjustmentsByLine,
    sectionByMonth,
    drawColumns,
    byDrawByLine,
    drawnByLine,
    // Excel extras
    fundsByLine,
    sources,
    glDetailsByDealLine,
    manuallyOverriddenByLine,
    uwBreakdownByLine,
    uwModelTotal,
    uwOrphans,
    uwBudgetTotal,
    revisedTotal,
    isCustomSchedule:
      (dealRes.data as { is_custom_schedule?: boolean } | null)
        ?.is_custom_schedule === true,
  };
}
