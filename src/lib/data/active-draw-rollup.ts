import { createClient } from "@/lib/supabase/server";
import { getUwModel, type UwInfo } from "./uw-model";
import {
  type AllocationMode,
  type ProRataSource,
  computeAvailable,
  computeDeviations,
  computeProRataTargets,
  isEquityKind,
  totalAvailableEquity,
} from "@/lib/finance/pro-rata";
import { getAdminSettings, type AdminSettings } from "./admin-settings";
import { NUROCK_STANDARD_FORMAT_ID } from "@/lib/formats";

// ============================================================================
// Active Draw Rollup (v3 - Ship 2: extended for full UI integration)
// ----------------------------------------------------------------------------
// Picks the active draw, rolls up per-schedule-line Prior/This/Total, fetches
// funding sources + per-source allocations + invoice count for the active
// draw + per-source release schedule + submission validation, and now also
// emits flat data structures the functional components consume directly:
//   - availableInvoices   → AvailableInvoicesList
//   - drawLines           → DrawLinesTable (with invoice/GL/allocation joins)
//   - scheduleLines       → DrawLinesTable's schedule-line picker
//   - releasedBySource    → SourceAllocationSummary's Available column
//   - submitValidation    → SubmitBar's canSubmit / blockReason
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

type DrawRow = {
  id: string;
  draw_number: number | null;
  status: string | null;
  period_start: string | null;
  period_end: string | null;
  submitted_at: string | null;
  submitted_by: string | null;
  pm_approved_at: string | null;
  pm_approved_by: string | null;
  cfo_approved_at: string | null;
  cfo_approved_by: string | null;
  lender_approved_at: string | null;
  lender_approved_by: string | null;
  funded_at: string | null;
  total_gross_amount: number | string | null;
  total_net_amount: number | string | null;
  total_retainage_amount: number | string | null;
  copilot_score: number | null;
  copilot_findings: unknown;
  package_url: string | null;
  allocation_mode: string | null;
};

type DrawLineAggRow = {
  id: string;
  draw_id: string;
  invoice_id: string | null;
  gl_account: string;
  net_amount: number | string | null;
  gross_amount: number | string | null;
  retainage_amount: number | string | null;
  funding_source_id?: string | null;
};

export type CopilotFinding = {
  status: "fail" | "warn" | "pass" | "info";
  title: string;
  detail?: string;
  action?: { label: string };
};

export type ActiveDrawInfo = {
  id: string;
  drawNumber: number | null;
  status: string;
  periodStart: string | null;
  periodEnd: string | null;
  submittedAt: string | null;
  submittedBy: string | null;
  pmApprovedAt: string | null;
  pmApprovedBy: string | null;
  cfoApprovedAt: string | null;
  cfoApprovedBy: string | null;
  lenderApprovedAt: string | null;
  lenderApprovedBy: string | null;
  fundedAt: string | null;
  packageUrl: string | null;
  copilotScore: number | null;
  copilotFindings: CopilotFinding[];
  totals: { gross: number; net: number; retainage: number };
};

export type ActiveDrawLine = {
  id: string;
  itemNumber: number;
  description: string;
  section: string;
  glAccounts: string[];
  originalBudget: number;
  adjustments: number;
  adjustedBudget: number;
  priorDraws: number;
  thisDraw: number;
  thisDrawGross: number;
  thisDrawRetainage: number;
  totalToDate: number;
  balance: number;
  pctTotal: number;
};

export type ActiveDrawSectionGroup = {
  section: string;
  lines: ActiveDrawLine[];
  originalBudget: number;
  adjustments: number;
  adjustedBudget: number;
  priorDraws: number;
  thisDraw: number;
  totalToDate: number;
  balance: number;
};

export type FundingSource = {
  id: string;
  name: string;
  kind: string;
  lenderName: string | null;
  position: number;
  commitmentAmount: number;
  drawnAmount: number;
};

// ----- v3 (Ship 2) types ----------------------------------------------------

export type AvailableInvoice = {
  id: string;
  vendor_name: string;
  invoice_number: string;
  invoice_date: string;
  net_amount: number | null;
  gross_amount: number;
};

export type AllocationEntry = {
  sourceId: string;
  amount: number;
};

export type DrawLineDetail = {
  id: string;
  invoice_id: string | null;
  vendor_name: string;
  invoice_number: string;
  description: string | null;
  gl_account: string;
  account_description: string;
  gross_amount: number;
  retainage_amount: number;
  net_amount: number;
  funding_source_id: string | null;
  draw_schedule_line_id: string | null;
  allocations: AllocationEntry[];
};

export type ScheduleLineOption = {
  id: string;
  item_number: number;
  description: string;
  section: string;
  revised_budget: number;
};

export type SubmitValidation = {
  canSubmit: boolean;
  blockReason: string | null;
};

// ----- v4 (pro-rata) types --------------------------------------------------

export type DrawInvoiceLine = {
  id: string;
  description: string | null;
  gl_account: string;
  account_description: string;
  gross_amount: number;
  retainage_amount: number;
  net_amount: number;
  draw_schedule_line_id: string | null;
};

export type DrawInvoiceGroup = {
  invoice_id: string;
  vendor_name: string;
  invoice_number: string;
  total_gross: number;
  total_retainage: number;
  total_net: number;
  lines: DrawInvoiceLine[];
  /** Invoice-level allocation (summed from per-line allocation rows). */
  allocations: AllocationEntry[];
  /** True if ANY of this invoice's allocation rows is_manual_override = true. */
  is_manual_override: boolean;
  /** True if every line in the invoice has a draw_schedule_line_id. */
  is_fully_mapped: boolean;
};

export type DeviationEntry = {
  sourceId: string;
  targetAmount: number;
  actualAmount: number;
  deviation: number;
  deviationPct: number;
};

export type ActiveDrawRollup = {
  info: UwInfo | null;
  draw: ActiveDrawInfo | null;
  hasActiveDraw: boolean;
  drawCount: { total: number; submitted: number; funded: number };
  bySection: ActiveDrawSectionGroup[];
  totals: {
    originalBudget: number;
    adjustments: number;
    adjustedBudget: number;
    priorDraws: number;
    thisDraw: number;
    totalToDate: number;
    balance: number;
    pctTotal: number;
  };
  sources: FundingSource[];
  thisDrawAllocationsBySource: Record<string, number>;
  invoiceCountThisDraw: number;
  primaryLender: string | null;
  dueDate: string | null;
  daysUntilDue: number | null;
  diagnostics: {
    scheduleLineCount: number;
    drawLineCountThisDraw: number;
    drawLineCountPrior: number;
  };
  // v3 additions:
  availableInvoices: AvailableInvoice[];
  drawLines: DrawLineDetail[];
  scheduleLines: ScheduleLineOption[];
  releasedBySource: Record<string, number>;
  submitValidation: SubmitValidation;
  // v4 (pro-rata) additions:
  allocationMode: AllocationMode;
  invoiceGroups: DrawInvoiceGroup[];
  availableEquity: number;
  drawnInSubmittedBySource: Record<string, number>;
  availableBySource: Record<string, number>;
  proRataTargets: Record<string, number>;
  deviations: DeviationEntry[];
  manualOverrideInvoiceCount: number;
  adminSettings: AdminSettings;
};

// =============================================================================

export async function getActiveDrawRollup(
  dealId: string,
  drawId?: string
): Promise<ActiveDrawRollup> {
  const supabase = await createClient();

  const [
    drawsResult,
    scheduleLines,
    glToScheduleLineMap,
    model,
    ulMapping,
    sourcesResult,
    availableInvoicesResult,
    dealScheduleLinesResult,
  ] = await Promise.all([
    supabase.from("dm_draws").select("*").eq("deal_id", dealId),
    fetchScheduleLines(),
    fetchGlToFormatLine(NUROCK_STANDARD_FORMAT_ID),
    getUwModel(dealId),
    fetchUlToGlMapping(),
    supabase
      .from("dm_funding_sources")
      .select(
        "id, name, kind, lender_name, position, commitment_amount, drawn_amount"
      )
      .eq("deal_id", dealId),
    // v3: approved invoices not yet in any draw
    supabase
      .from("dm_invoices")
      .select(
        "id, vendor_name, invoice_number, invoice_date, net_amount, gross_amount"
      )
      .eq("deal_id", dealId)
      .eq("status", "approved")
      .is("draw_id", null)
      .order("invoice_date", { ascending: false }),
    // v3: per-deal schedule lines for the schedule-line picker in DrawLinesTable
    supabase
      .from("dm_draw_schedule_lines")
      .select("id, item_number, description, section, revised_budget")
      .eq("deal_id", dealId)
      .eq("format_id", NUROCK_STANDARD_FORMAT_ID)
      .order("item_number", { ascending: true }),
  ]);

  const draws = (drawsResult.data ?? []) as unknown as DrawRow[];

  // Pick active draw
  let activeDraw: DrawRow | null = null;
  if (drawId) {
    activeDraw = draws.find((d) => d.id === drawId) ?? null;
  } else {
    const sortedDesc = [...draws].sort(
      (a, b) => (b.draw_number ?? 0) - (a.draw_number ?? 0)
    );
    const inProgress = sortedDesc.find((d) => !d.funded_at);
    activeDraw = inProgress ?? sortedDesc[0] ?? null;
  }

  // Identify prior submitted draws
  const priorDrawIds = new Set<string>();
  for (const d of draws) {
    if (!d.submitted_at) continue;
    if (!activeDraw) continue;
    if (d.id === activeDraw.id) continue;
    if (
      !activeDraw.submitted_at ||
      d.submitted_at < activeDraw.submitted_at
    ) {
      priorDrawIds.add(d.id);
    }
  }

  // ----- Fetch draw lines for active + prior (with id this time) -----------
  const relevantDrawIds = new Set<string>(priorDrawIds);
  if (activeDraw) relevantDrawIds.add(activeDraw.id);

  let drawLineAggs: DrawLineAggRow[] = [];
  if (relevantDrawIds.size > 0) {
    const { data, error } = await supabase
      .from("dm_draw_lines")
      .select(
        "id, draw_id, invoice_id, gl_account, net_amount, gross_amount, retainage_amount, funding_source_id"
      )
      .in("draw_id", Array.from(relevantDrawIds));
    if (error) console.error("[active-draw-rollup] dm_draw_lines:", error);
    drawLineAggs = (data ?? []) as DrawLineAggRow[];
  }

  // ----- Per-source allocations for active draw (now actually queries
  //       dm_draw_line_allocations because line ids are real) ----------------
  let thisDrawAllocationsBySource: Record<string, number> = {};
  const allocationsByLineId = new Map<string, AllocationEntry[]>();
  const overrideByLineId = new Map<string, boolean>();
  if (activeDraw) {
    const activeLineIds = drawLineAggs
      .filter((dl) => dl.draw_id === activeDraw!.id)
      .map((dl) => dl.id);

    if (activeLineIds.length > 0) {
      const { data: allocData, error: allocError } = await supabase
        .from("dm_draw_line_allocations")
        .select(
          "draw_line_id, funding_source_id, amount, is_manual_override"
        )
        .in("draw_line_id", activeLineIds);
      if (allocError) {
        console.error(
          "[active-draw-rollup] dm_draw_line_allocations:",
          allocError
        );
      }
      for (const a of (allocData ?? []) as unknown as {
        draw_line_id: string;
        funding_source_id: string;
        amount: number | string | null;
        is_manual_override?: boolean | null;
      }[]) {
        const amt = Number(a.amount) || 0;
        // Per-line accumulator
        const list = allocationsByLineId.get(a.draw_line_id) ?? [];
        list.push({ sourceId: a.funding_source_id, amount: amt });
        allocationsByLineId.set(a.draw_line_id, list);
        // Override flag: any override row marks the whole line as overridden
        if (a.is_manual_override === true) {
          overrideByLineId.set(a.draw_line_id, true);
        }
        // Per-source rollup
        thisDrawAllocationsBySource[a.funding_source_id] =
          (thisDrawAllocationsBySource[a.funding_source_id] ?? 0) + amt;
      }
    }

    // Fallback: lines with a direct funding_source_id but no row in
    // dm_draw_line_allocations (legacy or single-source shortcut)
    for (const dl of drawLineAggs) {
      if (dl.draw_id !== activeDraw.id) continue;
      if (allocationsByLineId.has(dl.id)) continue; // covered by alloc table
      if (dl.funding_source_id) {
        const amt = Number(dl.net_amount) || 0;
        allocationsByLineId.set(dl.id, [
          { sourceId: dl.funding_source_id, amount: amt },
        ]);
        thisDrawAllocationsBySource[dl.funding_source_id] =
          (thisDrawAllocationsBySource[dl.funding_source_id] ?? 0) + amt;
      }
    }
  }

  // Invoice count for active draw (distinct invoices)
  let invoiceCountThisDraw = 0;
  if (activeDraw) {
    const invoiceIds = new Set<string>();
    for (const dl of drawLineAggs) {
      if (dl.draw_id === activeDraw.id && dl.invoice_id) {
        invoiceIds.add(dl.invoice_id);
      }
    }
    invoiceCountThisDraw = invoiceIds.size;
  }

  // ----- Funding sources ----------------------------------------------------
  const rawSources = (sourcesResult.data ?? []) as Array<{
    id: string;
    name: string;
    kind: string;
    lender_name: string | null;
    position: number | null;
    commitment_amount: number | string | null;
    drawn_amount: number | string | null;
  }>;
  const sources: FundingSource[] = rawSources
    .map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      lenderName: s.lender_name,
      position: s.position ?? 0,
      commitmentAmount: Number(s.commitment_amount) || 0,
      drawnAmount: Number(s.drawn_amount) || 0,
    }))
    .sort((a, b) => a.position - b.position);

  // Primary lender — first construction loan, else first source's lender
  const primaryLender =
    sources.find((s) => s.kind?.includes("construction"))?.lenderName ??
    sources[0]?.lenderName ??
    null;

  // ----- Released tranches by source (v3) -----------------------------------
  // Sum of dm_funding_source_tranches.amount where actual_release_date is set,
  // grouped by funding_source_id. Used by SourceAllocationSummary's Available
  // column.
  let releasedBySource: Record<string, number> = {};
  if (sources.length > 0) {
    const sourceIds = sources.map((s) => s.id);
    const { data: trancheData, error: trancheError } = await supabase
      .from("dm_funding_source_tranches")
      .select("funding_source_id, amount, actual_release_date")
      .in("funding_source_id", sourceIds)
      .not("actual_release_date", "is", null);
    if (trancheError) {
      console.error(
        "[active-draw-rollup] dm_funding_source_tranches:",
        trancheError
      );
    }
    for (const t of (trancheData ?? []) as Array<{
      funding_source_id: string;
      amount: number | string | null;
    }>) {
      const amt = Number(t.amount) || 0;
      releasedBySource[t.funding_source_id] =
        (releasedBySource[t.funding_source_id] ?? 0) + amt;
    }
  }

  // Filter schedule lines (exclude meta)
  const realScheduleLines = scheduleLines.filter(
    (sl) => !META_SECTIONS.has(sl.section)
  );
  const scheduleLineById = new Map(realScheduleLines.map((sl) => [sl.id, sl]));
  const scheduleLineToGls = new Map<string, string[]>();
  for (const [gl, slId] of glToScheduleLineMap) {
    if (!scheduleLineById.has(slId)) continue;
    const arr = scheduleLineToGls.get(slId) ?? [];
    arr.push(gl);
    scheduleLineToGls.set(slId, arr);
  }

  // UW budget attribution (equal-split)
  const lineBudget = new Map<string, number>();
  if (model) {
    for (const uwLine of model.constructionBudget) {
      const gls = ulMapping.sourceLineToGls.get(uwLine.id) ?? [];
      const slIds = new Set<string>();
      for (const gl of gls) {
        const slId = glToScheduleLineMap.get(gl);
        if (slId && scheduleLineById.has(slId)) slIds.add(slId);
      }
      if (slIds.size === 0) continue;
      const share = uwLine.amount / slIds.size;
      for (const slId of slIds) {
        lineBudget.set(slId, (lineBudget.get(slId) ?? 0) + share);
      }
    }
  }

  // Bucket draw lines per schedule line
  type Bucket = {
    priorNet: number;
    thisNet: number;
    thisGross: number;
    thisRetainage: number;
  };
  const linesAccum = new Map<string, Bucket>();
  let priorTotal = 0;
  let thisTotal = 0;
  let priorLineCount = 0;
  let thisLineCount = 0;

  for (const dl of drawLineAggs) {
    const slId = glToScheduleLineMap.get(dl.gl_account);
    if (!slId || !scheduleLineById.has(slId)) continue;
    const amt = Number(dl.net_amount) || 0;
    const gross = Number(dl.gross_amount) || 0;
    const ret = Number(dl.retainage_amount) || 0;

    const existing = linesAccum.get(slId) ?? {
      priorNet: 0,
      thisNet: 0,
      thisGross: 0,
      thisRetainage: 0,
    };
    if (activeDraw && dl.draw_id === activeDraw.id) {
      existing.thisNet += amt;
      existing.thisGross += gross;
      existing.thisRetainage += ret;
      thisTotal += amt;
      thisLineCount += 1;
    } else if (priorDrawIds.has(dl.draw_id)) {
      existing.priorNet += amt;
      priorTotal += amt;
      priorLineCount += 1;
    }
    linesAccum.set(slId, existing);
  }

  // Build per-line rows
  const sorted = [...realScheduleLines].sort(
    (a, b) => a.line_number - b.line_number
  );

  const lines: ActiveDrawLine[] = [];
  let itemCounter = 0;
  for (const sl of sorted) {
    const gls = scheduleLineToGls.get(sl.id) ?? [];
    const original = lineBudget.get(sl.id) ?? 0;
    const acc = linesAccum.get(sl.id) ?? {
      priorNet: 0,
      thisNet: 0,
      thisGross: 0,
      thisRetainage: 0,
    };

    if (
      original === 0 &&
      gls.length === 0 &&
      acc.priorNet === 0 &&
      acc.thisNet === 0
    )
      continue;

    itemCounter += 1;
    const adjustments = 0;
    const adjusted = original + adjustments;
    const total = acc.priorNet + acc.thisNet;
    const balance = adjusted - total;
    const pctTotal = adjusted > 0 ? (total / adjusted) * 100 : 0;

    lines.push({
      id: sl.id,
      itemNumber: itemCounter,
      description: sl.description,
      section: sl.section,
      glAccounts: gls,
      originalBudget: original,
      adjustments,
      adjustedBudget: adjusted,
      priorDraws: acc.priorNet,
      thisDraw: acc.thisNet,
      thisDrawGross: acc.thisGross,
      thisDrawRetainage: acc.thisRetainage,
      totalToDate: total,
      balance,
      pctTotal,
    });
  }

  // Group by section
  const seenSections: string[] = [];
  const sectionMap = new Map<string, ActiveDrawLine[]>();
  for (const line of lines) {
    if (!sectionMap.has(line.section)) seenSections.push(line.section);
    const arr = sectionMap.get(line.section) ?? [];
    arr.push(line);
    sectionMap.set(line.section, arr);
  }
  const bySection: ActiveDrawSectionGroup[] = seenSections.map((section) => {
    const ls = sectionMap.get(section) ?? [];
    return {
      section,
      lines: ls,
      originalBudget: ls.reduce((s, l) => s + l.originalBudget, 0),
      adjustments: ls.reduce((s, l) => s + l.adjustments, 0),
      adjustedBudget: ls.reduce((s, l) => s + l.adjustedBudget, 0),
      priorDraws: ls.reduce((s, l) => s + l.priorDraws, 0),
      thisDraw: ls.reduce((s, l) => s + l.thisDraw, 0),
      totalToDate: ls.reduce((s, l) => s + l.totalToDate, 0),
      balance: ls.reduce((s, l) => s + l.balance, 0),
    };
  });

  // Totals
  const originalBudget = lines.reduce((s, l) => s + l.originalBudget, 0);
  const adjustments = lines.reduce((s, l) => s + l.adjustments, 0);
  const adjustedBudget = originalBudget + adjustments;
  const totalToDate = priorTotal + thisTotal;
  const balance = adjustedBudget - totalToDate;
  const pctTotal = adjustedBudget > 0 ? (totalToDate / adjustedBudget) * 100 : 0;

  // ----- v3: flat drawLines for the active draw with full detail -----------
  let drawLines: DrawLineDetail[] = [];
  if (activeDraw) {
    const activeLineRows = drawLineAggs.filter(
      (dl) => dl.draw_id === activeDraw!.id
    );

    if (activeLineRows.length > 0) {
      const activeLineIds = activeLineRows.map((l) => l.id);

      // Fetch the full per-line detail in a second query — pulling vendor /
      // invoice / line description / schedule line in one shot. Joining
      // through Supabase nested select gives us the related rows inline.
      const { data: detailData, error: detailError } = await supabase
        .from("dm_draw_lines")
        .select(
          `
          id, invoice_id, gl_account, description,
          gross_amount, retainage_amount, net_amount,
          funding_source_id, draw_schedule_line_id,
          dm_invoices ( vendor_name, invoice_number ),
          cost_account_map ( account_description )
        `
        )
        .in("id", activeLineIds);

      if (detailError) {
        console.error(
          "[active-draw-rollup] dm_draw_lines detail:",
          detailError
        );
      }

      type DetailRow = {
        id: string;
        invoice_id: string | null;
        gl_account: string;
        description: string | null;
        gross_amount: number | string | null;
        retainage_amount: number | string | null;
        net_amount: number | string | null;
        funding_source_id: string | null;
        draw_schedule_line_id: string | null;
        dm_invoices:
          | { vendor_name: string | null; invoice_number: string | null }
          | { vendor_name: string | null; invoice_number: string | null }[]
          | null;
        cost_account_map:
          | { account_description: string | null }
          | { account_description: string | null }[]
          | null;
      };

      drawLines = ((detailData ?? []) as DetailRow[]).map((row) => {
        const inv = Array.isArray(row.dm_invoices)
          ? row.dm_invoices[0]
          : row.dm_invoices;
        const coa = Array.isArray(row.cost_account_map)
          ? row.cost_account_map[0]
          : row.cost_account_map;
        return {
          id: row.id,
          invoice_id: row.invoice_id,
          vendor_name: inv?.vendor_name ?? "—",
          invoice_number: inv?.invoice_number ?? "—",
          description: row.description,
          gl_account: row.gl_account,
          account_description: coa?.account_description ?? "",
          gross_amount: Number(row.gross_amount) || 0,
          retainage_amount: Number(row.retainage_amount) || 0,
          net_amount: Number(row.net_amount) || 0,
          funding_source_id: row.funding_source_id,
          draw_schedule_line_id: row.draw_schedule_line_id,
          allocations: allocationsByLineId.get(row.id) ?? [],
        };
      });
    }
  }

  // ----- v3: scheduleLines (per-deal) for picker ---------------------------
  const dealScheduleLines: ScheduleLineOption[] = (
    (dealScheduleLinesResult.data ?? []) as Array<{
      id: string;
      item_number: number | null;
      description: string | null;
      section: string | null;
      revised_budget: number | string | null;
    }>
  ).map((s) => ({
    id: s.id,
    item_number: s.item_number ?? 0,
    description: s.description ?? "(unnamed)",
    section: s.section ?? "uncategorized",
    revised_budget: Number(s.revised_budget) || 0,
  }));

  // ----- v3: availableInvoices --------------------------------------------
  const availableInvoices: AvailableInvoice[] = (
    (availableInvoicesResult.data ?? []) as Array<{
      id: string;
      vendor_name: string | null;
      invoice_number: string | null;
      invoice_date: string | null;
      net_amount: number | string | null;
      gross_amount: number | string | null;
    }>
  ).map((r) => ({
    id: r.id,
    vendor_name: r.vendor_name ?? "—",
    invoice_number: r.invoice_number ?? "—",
    invoice_date: r.invoice_date ?? "",
    net_amount: r.net_amount == null ? null : Number(r.net_amount),
    gross_amount: Number(r.gross_amount) || 0,
  }));

  // ----- v4: invoice groups (group drawLines by invoice for invoice-level UI)
  const invoiceGroupMap = new Map<string, DrawInvoiceGroup>();
  for (const dl of drawLines) {
    if (!dl.invoice_id) continue; // orphan lines without invoice excluded
    const key = dl.invoice_id;
    let group = invoiceGroupMap.get(key);
    if (!group) {
      group = {
        invoice_id: dl.invoice_id,
        vendor_name: dl.vendor_name,
        invoice_number: dl.invoice_number,
        total_gross: 0,
        total_retainage: 0,
        total_net: 0,
        lines: [],
        allocations: [],
        is_manual_override: false,
        is_fully_mapped: true,
      };
      invoiceGroupMap.set(key, group);
    }
    group.lines.push({
      id: dl.id,
      description: dl.description,
      gl_account: dl.gl_account,
      account_description: dl.account_description,
      gross_amount: dl.gross_amount,
      retainage_amount: dl.retainage_amount,
      net_amount: dl.net_amount,
      draw_schedule_line_id: dl.draw_schedule_line_id,
    });
    group.total_gross += dl.gross_amount;
    group.total_retainage += dl.retainage_amount;
    group.total_net += dl.net_amount;
    if (!dl.draw_schedule_line_id) group.is_fully_mapped = false;
    if (overrideByLineId.get(dl.id)) group.is_manual_override = true;
    // Aggregate per-source allocation across lines
    for (const a of dl.allocations) {
      const existing = group.allocations.find(
        (x) => x.sourceId === a.sourceId
      );
      if (existing) existing.amount += a.amount;
      else group.allocations.push({ sourceId: a.sourceId, amount: a.amount });
    }
  }
  const invoiceGroups = Array.from(invoiceGroupMap.values());
  const manualOverrideInvoiceCount = invoiceGroups.filter(
    (g) => g.is_manual_override
  ).length;

  // ----- v4: drawn-in-submitted by source (excluding current draft) -------
  // Sum dm_draw_line_allocations.amount where draw_line.draw_id is a
  // submitted-or-later draw on this deal AND not the current active draw.
  const drawnInSubmittedBySource: Record<string, number> = {};
  const submittedDrawIdsExcludingActive = draws
    .filter(
      (d) => d.submitted_at !== null && (!activeDraw || d.id !== activeDraw.id)
    )
    .map((d) => d.id);
  if (submittedDrawIdsExcludingActive.length > 0) {
    // The lines already fetched via drawLineAggs cover priorDrawIds but the
    // priorDrawIds set excludes funded/draft draws of the same deal that we'd
    // also want to count. We'll re-query lines directly.
    const { data: submittedLines, error: submittedErr } = await supabase
      .from("dm_draw_lines")
      .select("id")
      .in("draw_id", submittedDrawIdsExcludingActive);
    if (submittedErr) {
      console.error(
        "[active-draw-rollup] submitted lines:",
        submittedErr
      );
    }
    const lineIds = (submittedLines ?? []).map((r) => (r as { id: string }).id);
    if (lineIds.length > 0) {
      const { data: allocs, error: allocsErr } = await supabase
        .from("dm_draw_line_allocations")
        .select("funding_source_id, amount")
        .in("draw_line_id", lineIds);
      if (allocsErr) {
        console.error(
          "[active-draw-rollup] submitted allocations:",
          allocsErr
        );
      }
      for (const a of (allocs ?? []) as Array<{
        funding_source_id: string;
        amount: number | string | null;
      }>) {
        const amt = Number(a.amount) || 0;
        drawnInSubmittedBySource[a.funding_source_id] =
          (drawnInSubmittedBySource[a.funding_source_id] ?? 0) + amt;
      }
    }
  }

  // ----- v4: build ProRataSource[] for the algorithm ----------------------
  const proRataSources: ProRataSource[] = sources.map((s) => ({
    id: s.id,
    kind: s.kind,
    position: s.position,
    commitmentAmount: s.commitmentAmount,
    drawnAmount: drawnInSubmittedBySource[s.id] ?? 0,
    releasedAmount: isEquityKind(s.kind)
      ? releasedBySource[s.id] ?? 0 // equity: only released tranches count
      : s.commitmentAmount, // loans: full commitment is available
  }));

  // ----- v4: compute pro-rata targets for the current draw amount --------
  const proRataTargets = computeProRataTargets(thisTotal, proRataSources);

  // ----- v4: available capacity per source (released - drawn for equity,
  //       commitment - drawn for loans) ----------------------------------
  const availableBySource: Record<string, number> = {};
  for (const ps of proRataSources) {
    availableBySource[ps.id] = computeAvailable(ps);
  }

  // ----- v4: deviations of actual vs target ------------------------------
  const deviations = computeDeviations(
    proRataTargets,
    thisDrawAllocationsBySource
  );

  // ----- v4: available equity total --------------------------------------
  const availableEquity = totalAvailableEquity(proRataSources);

  // ----- v4: allocation mode (read from draw) ----------------------------
  const allocationMode: AllocationMode =
    activeDraw && isAllocationMode(activeDraw.allocation_mode)
      ? activeDraw.allocation_mode
      : "manual";

  // ----- v4: admin settings ----------------------------------------------
  const adminSettings = await getAdminSettings();

  // ----- v3: submit validation --------------------------------------------
  const submitValidation: SubmitValidation = (() => {
    if (!activeDraw) {
      return { canSubmit: false, blockReason: "No active draw" };
    }
    if (
      activeDraw.status !== "draft" &&
      activeDraw.status !== "pm_approved" &&
      activeDraw.status !== "cfo_approved"
    ) {
      return {
        canSubmit: false,
        blockReason: `Draw is ${activeDraw.status} (read-only)`,
      };
    }
    if (drawLines.length === 0) {
      return {
        canSubmit: false,
        blockReason: "Add invoices before submitting",
      };
    }
    const unallocated = drawLines.filter(
      (l) => !l.allocations || l.allocations.length === 0
    );
    if (unallocated.length > 0) {
      return {
        canSubmit: false,
        blockReason: `${unallocated.length} line${unallocated.length === 1 ? "" : "s"} missing funding source`,
      };
    }
    const unbalanced = drawLines.filter((l) => {
      const total = l.allocations.reduce((s, a) => s + a.amount, 0);
      return Math.abs(total - l.net_amount) > 0.01;
    });
    if (unbalanced.length > 0) {
      return {
        canSubmit: false,
        blockReason: `${unbalanced.length} line${unbalanced.length === 1 ? "" : "s"} have allocations that don't match net`,
      };
    }
    const unmappedToSchedule = drawLines.filter(
      (l) => !l.draw_schedule_line_id
    );
    if (unmappedToSchedule.length > 0) {
      return {
        canSubmit: false,
        blockReason: `${unmappedToSchedule.length} line${unmappedToSchedule.length === 1 ? "" : "s"} not mapped to a schedule line`,
      };
    }
    return { canSubmit: true, blockReason: null };
  })();

  // Compose draw info
  let drawInfo: ActiveDrawInfo | null = null;
  let dueDate: string | null = null;
  let daysUntilDue: number | null = null;
  if (activeDraw) {
    const rawFindings = Array.isArray(activeDraw.copilot_findings)
      ? (activeDraw.copilot_findings as unknown[])
      : [];
    const findings: CopilotFinding[] = [];
    for (const f of rawFindings) {
      if (typeof f !== "object" || f === null) continue;
      const obj = f as Record<string, unknown>;
      const status = obj.status;
      const title = obj.title;
      if (typeof title !== "string") continue;
      if (
        status !== "fail" &&
        status !== "warn" &&
        status !== "pass" &&
        status !== "info"
      )
        continue;
      const finding: CopilotFinding = { status, title };
      if (typeof obj.detail === "string") finding.detail = obj.detail;
      if (obj.action && typeof obj.action === "object" && obj.action !== null) {
        const actionLabel = (obj.action as { label?: unknown }).label;
        if (typeof actionLabel === "string") {
          finding.action = { label: actionLabel };
        }
      }
      findings.push(finding);
    }

    drawInfo = {
      id: activeDraw.id,
      drawNumber: activeDraw.draw_number,
      status: activeDraw.status ?? "draft",
      periodStart: activeDraw.period_start,
      periodEnd: activeDraw.period_end,
      submittedAt: activeDraw.submitted_at,
      submittedBy: activeDraw.submitted_by,
      pmApprovedAt: activeDraw.pm_approved_at,
      pmApprovedBy: activeDraw.pm_approved_by,
      cfoApprovedAt: activeDraw.cfo_approved_at,
      cfoApprovedBy: activeDraw.cfo_approved_by,
      lenderApprovedAt: activeDraw.lender_approved_at,
      lenderApprovedBy: activeDraw.lender_approved_by,
      fundedAt: activeDraw.funded_at,
      packageUrl: activeDraw.package_url,
      copilotScore: activeDraw.copilot_score,
      copilotFindings: findings,
      totals: {
        gross: Number(activeDraw.total_gross_amount) || 0,
        net: Number(activeDraw.total_net_amount) || 0,
        retainage: Number(activeDraw.total_retainage_amount) || 0,
      },
    };

    if (activeDraw.period_end) {
      dueDate = activeDraw.period_end;
      const now = new Date();
      const due = new Date(activeDraw.period_end);
      daysUntilDue = Math.ceil(
        (due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      );
    }
  }

  return {
    info: model?.info ?? null,
    draw: drawInfo,
    hasActiveDraw: drawInfo !== null,
    drawCount: {
      total: draws.length,
      submitted: draws.filter((d) => d.submitted_at).length,
      funded: draws.filter((d) => d.funded_at).length,
    },
    bySection,
    totals: {
      originalBudget,
      adjustments,
      adjustedBudget,
      priorDraws: priorTotal,
      thisDraw: thisTotal,
      totalToDate,
      balance,
      pctTotal,
    },
    sources,
    thisDrawAllocationsBySource,
    invoiceCountThisDraw,
    primaryLender,
    dueDate,
    daysUntilDue,
    diagnostics: {
      scheduleLineCount: lines.length,
      drawLineCountThisDraw: thisLineCount,
      drawLineCountPrior: priorLineCount,
    },
    // v3 additions:
    availableInvoices,
    drawLines,
    scheduleLines: dealScheduleLines,
    releasedBySource,
    submitValidation,
    // v4 (pro-rata) additions:
    allocationMode,
    invoiceGroups,
    availableEquity,
    drawnInSubmittedBySource,
    availableBySource,
    proRataTargets,
    deviations,
    manualOverrideInvoiceCount,
    adminSettings,
  };
}

function isAllocationMode(v: unknown): v is AllocationMode {
  return (
    v === "manual" || v === "pro_rata_invoice" || v === "pro_rata_aggregate"
  );
}

// =============================================================================
// Helpers
// =============================================================================

async function fetchScheduleLines(): Promise<ScheduleLineMeta[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("nurock_standard_schedule_lines")
    .select("id, line_number, description, section")
    .order("line_number");
  if (error) {
    console.error("[active-draw-rollup] schedule lines:", error);
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
    console.error("[active-draw-rollup] gl_to_format_line:", error);
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
}> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("dm_underwriting_line_gl")
    .select("source_line_id, gl_account");
  if (error) {
    console.error("[active-draw-rollup] dm_underwriting_line_gl:", error);
    return { sourceLineToGls: new Map() };
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
  return { sourceLineToGls };
}
