import { createClient } from "@/lib/supabase/server";
import { getUwModel } from "./uw-model";
import { getBudgetActuals, type GlActivityRow } from "./budget-actuals";
import type {
  BudgetRollup,
  BudgetLineRollup,
  BudgetCategoryGroup,
  EnrichedGlActivityRow,
} from "./budget-rollup";
import { NUROCK_STANDARD_FORMAT_ID } from "@/lib/formats";

// ============================================================================
// Schedule Rollup — NuRock Standard canonical layout
// ============================================================================

const META_SECTIONS = new Set([
  "development_cost_subtotal",
  "total_development_cost",
]);

type ScheduleLineMeta = {
  id: string;
  line_number: number;
  description: string;
  section: string;
};

export type ScheduleFormatInfo = {
  id: string;
  name: string;
  slug: string;
};

export type AttributionDiagnostics = {
  uwLinesAttributed: number;
  uwLinesNotAttributed: number;
  notAttributedAmount: number;
  splitLineCount: number;
};

export type GlDetail = {
  gl_account: string;
  description: string;
  isEligibleBasis: boolean;
  invoiced: number;
  paid: number;
  eligible: number;
  lineCount: number;
  invoiceCount: number;
};

export type DrawColumn = {
  id: string;
  drawNumber: number | null;
  status: string;
  submittedAt: string | null;
  fundedAt: string | null;
  label: string;
  monthLabel: string | null;
  isSubmitted: boolean;
  isFunded: boolean;
  total: number;
};

export type MonthBucket = {
  key: string;
  label: string;
  total: number;
};

export type ScheduleRollup = BudgetRollup & {
  scheduleFormat: ScheduleFormatInfo;
  attribution: AttributionDiagnostics;
  glDetailsByLine: Record<string, GlDetail[]>;
  drawColumns: DrawColumn[];
  byDrawByLine: Record<string, Record<string, number>>;
  drawnByLine: Record<string, number>;
  adjustmentsByLine: Record<string, number>;
  monthBuckets: MonthBucket[];
  byMonthByLine: Record<string, Record<string, number>>;
  sectionByMonth: Record<string, Record<string, number>>;
};

// =============================================================================
// Main
// =============================================================================

export async function getScheduleRollup(
  dealId: string,
  formatId?: string
): Promise<ScheduleRollup> {
  const supabase = await createClient();
  const activeFormat = await resolveActiveFormat(supabase, formatId);

  const [
    rawScheduleLines,
    glToScheduleLineMap,
    model,
    actuals,
    ulMapping,
    glDirectory,
    draws,
    drawLines,
  ] = await Promise.all([
    fetchScheduleLines(),
    fetchGlToFormatLine(activeFormat.id),
    getUwModel(dealId),
    getBudgetActuals(dealId),
    fetchUlToGlMapping(),
    fetchGlDirectory(),
    fetchDraws(dealId),
    fetchDrawLines(dealId),
  ]);

  const scheduleLines = rawScheduleLines.filter(
    (sl) => !META_SECTIONS.has(sl.section)
  );

  // GlActivityRow is the BASE shape (no enrichment fields) — buildGlDetails
  // only reads the numeric fields, so the base type is sufficient here.
  const actualsByGl = new Map<string, GlActivityRow>();
  for (const row of actuals.byGl) actualsByGl.set(row.gl_account, row);

  const scheduleLineById = new Map(scheduleLines.map((sl) => [sl.id, sl]));
  const scheduleLineToGls = new Map<string, string[]>();
  for (const [gl, slId] of glToScheduleLineMap) {
    if (!scheduleLineById.has(slId)) continue;
    const arr = scheduleLineToGls.get(slId) ?? [];
    arr.push(gl);
    scheduleLineToGls.set(slId, arr);
  }

  // Attribute UW budget
  const scheduleLineBudget = new Map<string, number>();
  const scheduleLineEligible = new Map<string, number>();
  let uwLinesAttributed = 0;
  let uwLinesNotAttributed = 0;
  let notAttributedAmount = 0;
  let splitLineCount = 0;

  if (model) {
    for (const uwLine of model.constructionBudget) {
      const gls = ulMapping.sourceLineToGls.get(uwLine.id) ?? [];
      const scheduleLineIds = new Set<string>();
      for (const gl of gls) {
        const slId = glToScheduleLineMap.get(gl);
        if (slId && scheduleLineById.has(slId)) scheduleLineIds.add(slId);
      }
      if (scheduleLineIds.size === 0) {
        uwLinesNotAttributed += 1;
        notAttributedAmount += uwLine.amount;
        continue;
      }
      uwLinesAttributed += 1;
      if (scheduleLineIds.size > 1) splitLineCount += 1;

      const share = uwLine.amount / scheduleLineIds.size;
      const eligibleShare =
        (uwLine.amount * uwLine.costEligible) / scheduleLineIds.size;
      for (const slId of scheduleLineIds) {
        scheduleLineBudget.set(slId, (scheduleLineBudget.get(slId) ?? 0) + share);
        scheduleLineEligible.set(
          slId,
          (scheduleLineEligible.get(slId) ?? 0) + eligibleShare
        );
      }
    }
  }

  // Aggregate invoice actuals per schedule line
  type ActualBucket = {
    invoiced: number;
    paid: number;
    eligible: number;
    lineCount: number;
  };
  const actualsByScheduleLine = new Map<string, ActualBucket>();
  for (const a of actuals.byGl) {
    const slId = glToScheduleLineMap.get(a.gl_account);
    if (!slId || !scheduleLineById.has(slId)) continue;
    const existing = actualsByScheduleLine.get(slId) ?? {
      invoiced: 0,
      paid: 0,
      eligible: 0,
      lineCount: 0,
    };
    existing.invoiced += a.totalInvoiced;
    existing.paid += a.totalPaid;
    existing.eligible += a.totalEligible;
    existing.lineCount += a.lineCount;
    actualsByScheduleLine.set(slId, existing);
  }

  // Build draw columns
  const drawColumns: DrawColumn[] = draws.map((d) => {
    const isSubmitted = !!d.submitted_at;
    const isFunded = !!d.funded_at;
    const monthLabel = d.submitted_at
      ? formatMonthLabel(d.submitted_at.substring(0, 7))
      : null;
    const numLabel = d.draw_number != null ? `Draw ${d.draw_number}` : "Draw";
    const label = isSubmitted
      ? `${numLabel} · ${monthLabel}`
      : `${numLabel} (${(d.status ?? "draft").toLowerCase()})`;
    return {
      id: d.id,
      drawNumber: d.draw_number ?? null,
      status: d.status ?? "draft",
      submittedAt: d.submitted_at ?? null,
      fundedAt: d.funded_at ?? null,
      label,
      monthLabel,
      isSubmitted,
      isFunded,
      total: 0,
    };
  });

  drawColumns.sort((a, b) => {
    if (a.isSubmitted && !b.isSubmitted) return -1;
    if (!a.isSubmitted && b.isSubmitted) return 1;
    if (a.isSubmitted && b.isSubmitted) {
      return (a.submittedAt ?? "").localeCompare(b.submittedAt ?? "");
    }
    return (a.drawNumber ?? 0) - (b.drawNumber ?? 0);
  });

  const drawById = new Map(drawColumns.map((c) => [c.id, c]));

  // Bucket draw lines by (schedule_line, draw) and (schedule_line, month)
  const byDrawByLine: Record<string, Record<string, number>> = {};
  const byMonthByLine: Record<string, Record<string, number>> = {};
  const sectionByMonth: Record<string, Record<string, number>> = {};
  const drawTotals: Record<string, number> = {};
  const submittedMonthSet = new Set<string>();

  for (const dl of drawLines) {
    const draw = drawById.get(dl.draw_id);
    if (!draw) continue;
    const slId = glToScheduleLineMap.get(dl.gl_account);
    if (!slId || !scheduleLineById.has(slId)) continue;
    const amount = Number(dl.net_amount) || 0;

    if (!byDrawByLine[slId]) byDrawByLine[slId] = {};
    byDrawByLine[slId][draw.id] = (byDrawByLine[slId][draw.id] ?? 0) + amount;
    drawTotals[draw.id] = (drawTotals[draw.id] ?? 0) + amount;

    if (draw.isSubmitted && draw.submittedAt) {
      const month = draw.submittedAt.substring(0, 7);
      submittedMonthSet.add(month);
      if (!byMonthByLine[slId]) byMonthByLine[slId] = {};
      byMonthByLine[slId][month] = (byMonthByLine[slId][month] ?? 0) + amount;
      const section = scheduleLineById.get(slId)?.section ?? "Uncategorized";
      if (!sectionByMonth[section]) sectionByMonth[section] = {};
      sectionByMonth[section][month] =
        (sectionByMonth[section][month] ?? 0) + amount;
    }
  }
  for (const col of drawColumns) col.total = drawTotals[col.id] ?? 0;

  // Drawn-to-date per line (submitted only)
  const submittedDrawIds = new Set(
    drawColumns.filter((c) => c.isSubmitted).map((c) => c.id)
  );
  const drawnByLine: Record<string, number> = {};
  for (const line of scheduleLines) {
    const drawMap = byDrawByLine[line.id] ?? {};
    let drawn = 0;
    for (const [drawId, amt] of Object.entries(drawMap)) {
      if (submittedDrawIds.has(drawId)) drawn += amt;
    }
    drawnByLine[line.id] = drawn;
  }

  // Build line rollup rows + glDetails
  const byLine: BudgetLineRollup[] = [];
  const glDetailsByLine: Record<string, GlDetail[]> = {};
  const adjustmentsByLine: Record<string, number> = {};

  const sortedScheduleLines = [...scheduleLines].sort(
    (a, b) => a.line_number - b.line_number
  );

  for (const sl of sortedScheduleLines) {
    const gls = scheduleLineToGls.get(sl.id) ?? [];
    const uwBudget = scheduleLineBudget.get(sl.id) ?? 0;
    const eligibleAmount = scheduleLineEligible.get(sl.id) ?? 0;
    const act = actualsByScheduleLine.get(sl.id) ?? {
      invoiced: 0,
      paid: 0,
      eligible: 0,
      lineCount: 0,
    };
    const drawn = drawnByLine[sl.id] ?? 0;

    if (
      uwBudget === 0 &&
      act.invoiced === 0 &&
      gls.length === 0 &&
      drawn === 0
    )
      continue;

    byLine.push({
      modelLineId: sl.id,
      description: sl.description,
      category: sl.section,
      uwBudget,
      costEligible: uwBudget > 0 ? eligibleAmount / uwBudget : 0,
      eligibleAmount,
      ineligibleBasisAllocation: null,
      glAccounts: gls,
      actualInvoiced: act.invoiced,
      actualPaid: act.paid,
      actualEligible: act.eligible,
      invoiceLineCount: act.lineCount,
      variance: act.invoiced - uwBudget,
      pctDrawn: uwBudget > 0 ? (act.invoiced / uwBudget) * 100 : 0,
      balance: uwBudget - act.invoiced,
    });

    glDetailsByLine[sl.id] = buildGlDetails(gls, glDirectory, actualsByGl);
    adjustmentsByLine[sl.id] = 0;
  }

  // Group by section
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
      eligibleAmount: lines.reduce((s, l) => s + l.eligibleAmount, 0),
      balance: lines.reduce((s, l) => s + l.balance, 0),
    };
  });

  const uwBudgetTotal = byLine.reduce((s, l) => s + l.uwBudget, 0);
  const eligibleAmountTotal = byLine.reduce((s, l) => s + l.eligibleAmount, 0);
  const actualInvoicedTotal = actuals.totalInvoiced;
  const actualPaidTotal = actuals.totalPaid;
  const actualEligibleTotal = actuals.totalEligible;

  const monthBuckets: MonthBucket[] = Array.from(submittedMonthSet)
    .sort()
    .map((key) => {
      let total = 0;
      for (const monthMap of Object.values(sectionByMonth)) {
        total += monthMap[key] ?? 0;
      }
      return { key, label: formatMonthLabel(key), total };
    });

  // Enrich live activity
  const glToScheduleLineDesc = new Map<string, string>();
  const glToScheduleLineId = new Map<string, string>();
  for (const [gl, slId] of glToScheduleLineMap) {
    const meta = scheduleLineById.get(slId);
    if (meta) {
      glToScheduleLineDesc.set(gl, meta.description);
      glToScheduleLineId.set(gl, slId);
    }
  }
  const enrichedByGl: EnrichedGlActivityRow[] = actuals.byGl.map((row) => ({
    ...row,
    uwLineDescription: glToScheduleLineDesc.get(row.gl_account) ?? null,
    uwLineSourceId: glToScheduleLineId.get(row.gl_account) ?? null,
  }));
  const unmappedActivity = enrichedByGl.filter(
    (r) => !glToScheduleLineId.has(r.gl_account)
  );

  return {
    info: model?.info ?? null,
    byLine,
    byCategory,
    totals: {
      uwBudget: uwBudgetTotal,
      eligibleAmount: eligibleAmountTotal,
      actualInvoiced: actualInvoicedTotal,
      actualPaid: actualPaidTotal,
      actualEligible: actualEligibleTotal,
      balance: uwBudgetTotal - actualInvoicedTotal,
      pctDrawn: uwBudgetTotal > 0 ? (actualInvoicedTotal / uwBudgetTotal) * 100 : 0,
      variance: actualInvoicedTotal - uwBudgetTotal,
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
      modelPresent: model !== null,
      budgetLineCount: byLine.length,
      glAccountsInChart: glDirectory.size,
      glAccountsLinkedToModelLines: glToScheduleLineId.size,
      glAccountsWithActivity: actuals.byGl.length,
      glAccountsUnmapped: unmappedActivity.length,
      overrideCount: 0,
      sharedGlCount: 0,
      ulGlMappingsTotal: glToScheduleLineMap.size,
    },
    scheduleFormat: activeFormat,
    attribution: {
      uwLinesAttributed,
      uwLinesNotAttributed,
      notAttributedAmount,
      splitLineCount,
    },
    glDetailsByLine,
    drawColumns,
    byDrawByLine,
    drawnByLine,
    adjustmentsByLine,
    monthBuckets,
    byMonthByLine,
    sectionByMonth,
  };
}

// =============================================================================
// Helpers
// =============================================================================

function buildGlDetails(
  glAccounts: string[],
  glDirectory: Map<string, { description: string; isEligibleBasis: boolean }>,
  actualsByGl: Map<string, GlActivityRow>
): GlDetail[] {
  return glAccounts
    .map((gl) => {
      const dir = glDirectory.get(gl);
      const act = actualsByGl.get(gl);
      return {
        gl_account: gl,
        description: dir?.description ?? "",
        isEligibleBasis: dir?.isEligibleBasis ?? false,
        invoiced: act?.totalInvoiced ?? 0,
        paid: act?.totalPaid ?? 0,
        eligible: act?.totalEligible ?? 0,
        lineCount: act?.lineCount ?? 0,
        invoiceCount: act?.invoiceCount ?? 0,
      };
    })
    .sort((a, b) => {
      if (a.invoiced > 0 && b.invoiced === 0) return -1;
      if (a.invoiced === 0 && b.invoiced > 0) return 1;
      if (a.invoiced !== b.invoiced) return b.invoiced - a.invoiced;
      return a.gl_account.localeCompare(b.gl_account);
    });
}

function formatMonthLabel(yyyyMm: string): string {
  const parts = yyyyMm.split("-");
  if (parts.length !== 2) return yyyyMm;
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  if (isNaN(y) || isNaN(m)) return yyyyMm;
  const date = new Date(y, m - 1, 1);
  return date.toLocaleString("en-US", { month: "short", year: "2-digit" });
}

// =============================================================================
// Fetchers
// =============================================================================

type SupabaseSrv = Awaited<ReturnType<typeof createClient>>;

async function resolveActiveFormat(
  supabase: SupabaseSrv,
  formatId?: string
): Promise<ScheduleFormatInfo> {
  if (formatId) {
    const { data } = await supabase
      .from("nurock_schedule_formats")
      .select("id, name, slug")
      .eq("id", formatId)
      .maybeSingle();
    if (data) return data as ScheduleFormatInfo;
  }
  const { data: defaultFormat } = await supabase
    .from("nurock_schedule_formats")
    .select("id, name, slug")
    .eq("is_default", true)
    .maybeSingle();
  if (defaultFormat) return defaultFormat as ScheduleFormatInfo;
  return {
    id: NUROCK_STANDARD_FORMAT_ID,
    name: "NuRock Standard",
    slug: "nurock-standard",
  };
}

async function fetchScheduleLines(): Promise<ScheduleLineMeta[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("nurock_standard_schedule_lines")
    .select("id, line_number, description, section")
    .order("line_number");
  if (error) {
    console.error("[schedule-rollup] schedule lines:", error);
    return [];
  }
  type Row = {
    id: string;
    line_number: number | null;
    description: string | null;
    section: string | null;
  };
  return (data ?? []).map((r: Row) => ({
    id: r.id,
    line_number: r.line_number ?? 0,
    description: r.description ?? "(unnamed)",
    section: r.section ?? "uncategorized",
  }));
}

async function fetchGlToFormatLine(
  formatId: string
): Promise<Map<string, string>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("gl_to_format_line")
    .select("gl_account, schedule_line_id")
    .eq("format_id", formatId);
  if (error) {
    console.error("[schedule-rollup] gl_to_format_line:", error);
    return new Map();
  }
  const map = new Map<string, string>();
  for (const row of (data ?? []) as {
    gl_account: string;
    schedule_line_id: string;
  }[]) {
    if (row.gl_account && row.schedule_line_id) {
      map.set(row.gl_account, row.schedule_line_id);
    }
  }
  return map;
}

async function fetchUlToGlMapping(): Promise<{
  sourceLineToGls: Map<string, string[]>;
  totalRows: number;
}> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("dm_underwriting_line_gl")
    .select("source_line_id, gl_account");
  if (error) {
    console.error("[schedule-rollup] dm_underwriting_line_gl:", error);
    return { sourceLineToGls: new Map(), totalRows: 0 };
  }
  type Row = { source_line_id: string; gl_account: string };
  const rows = (data ?? []) as Row[];
  const sourceLineToGls = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.source_line_id || !r.gl_account) continue;
    const existing = sourceLineToGls.get(r.source_line_id) ?? [];
    if (!existing.includes(r.gl_account)) {
      existing.push(r.gl_account);
      sourceLineToGls.set(r.source_line_id, existing);
    }
  }
  return { sourceLineToGls, totalRows: rows.length };
}

async function fetchGlDirectory(): Promise<
  Map<string, { description: string; isEligibleBasis: boolean }>
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cost_account_map")
    .select("gl_account, account_description, is_eligible_basis");
  if (error) {
    console.error("[schedule-rollup] cost_account_map:", error);
    return new Map();
  }
  type Row = {
    gl_account: string;
    account_description: string | null;
    is_eligible_basis: boolean | null;
  };
  const map = new Map<string, { description: string; isEligibleBasis: boolean }>();
  for (const r of (data ?? []) as Row[]) {
    if (!r.gl_account) continue;
    map.set(r.gl_account, {
      description: r.account_description ?? "",
      isEligibleBasis: r.is_eligible_basis ?? false,
    });
  }
  return map;
}

async function fetchDraws(
  dealId: string
): Promise<
  Array<{
    id: string;
    draw_number: number | null;
    status: string | null;
    submitted_at: string | null;
    funded_at: string | null;
  }>
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("dm_draws")
    .select("id, draw_number, status, submitted_at, funded_at")
    .eq("deal_id", dealId)
    .order("draw_number", { nullsFirst: false });
  if (error) {
    console.error("[schedule-rollup] dm_draws:", error);
    return [];
  }
  return (data ?? []) as Array<{
    id: string;
    draw_number: number | null;
    status: string | null;
    submitted_at: string | null;
    funded_at: string | null;
  }>;
}

async function fetchDrawLines(
  dealId: string
): Promise<
  Array<{ draw_id: string; gl_account: string; net_amount: number | string | null }>
> {
  const supabase = await createClient();
  const { data: drawsData } = await supabase
    .from("dm_draws")
    .select("id")
    .eq("deal_id", dealId);
  const ids = (drawsData ?? []).map((d: { id: string }) => d.id);
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from("dm_draw_lines")
    .select("draw_id, gl_account, net_amount")
    .in("draw_id", ids);
  if (error) {
    console.error("[schedule-rollup] dm_draw_lines:", error);
    return [];
  }
  return (data ?? []) as Array<{
    draw_id: string;
    gl_account: string;
    net_amount: number | string | null;
  }>;
}
