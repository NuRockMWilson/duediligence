import { createClient } from "@/lib/supabase/server";
import { getUwModel, type UwInfo } from "./uw-model";
import { NUROCK_STANDARD_FORMAT_ID } from "@/lib/formats";

// ============================================================================
// Draw Schedule Rollup — Path B architecture
// ----------------------------------------------------------------------------
// Sources of truth (per-deal, exact):
//   dm_draw_schedule_lines      → schedule rows with original_budget /
//                                 revised_budget (Adjustments = revised - orig)
//   dm_draws                    → draw columns; submitted_at drives the
//                                 column label "Draw N · Mon YY"; draws
//                                 without submitted_at appear as "Pending"
//   dm_draw_lines               → cell values, joined by draw_schedule_line_id
//
// No UW attribution, no equal-split. Budgets are authoritative.
// ============================================================================

export type DealScheduleLine = {
  id: string;
  itemNumber: number | null;
  description: string;
  section: string;
  originalBudget: number;
  revisedBudget: number;
  adjustments: number; // revised - original
};

export type DrawColumn = {
  id: string;
  drawNumber: number | null;
  status: string;
  submittedAt: string | null; // ISO timestamp or null when not submitted
  fundedAt: string | null;
  label: string; // e.g. "Draw 1 · Feb 26" or "Draw 1 (Draft)"
  isSubmitted: boolean;
  isFunded: boolean;
  total: number; // sum of cells in this column
};

export type DrawScheduleRollup = {
  info: UwInfo | null;
  scheduleLines: DealScheduleLine[];
  bySection: SectionGroup[];
  drawColumns: DrawColumn[];
  // matrix lookup: byDrawByLine[scheduleLineId][drawId] = amount
  byDrawByLine: Record<string, Record<string, number>>;
  // per-line drawn-to-date (sum across SUBMITTED draws only)
  drawnByLine: Record<string, number>;
  totals: {
    originalBudget: number;
    adjustments: number;
    adjustedBudget: number;
    drawnToDate: number;
    remaining: number;
    pctDrawn: number;
  };
  diagnostics: {
    scheduleLineCount: number;
    drawCountTotal: number;
    drawCountSubmitted: number;
    drawCountFunded: number;
    drawLineCount: number;
    dealHasSchedule: boolean;
  };
};

export type SectionGroup = {
  section: string;
  lines: DealScheduleLine[];
  originalBudget: number;
  adjustments: number;
  adjustedBudget: number;
  drawnToDate: number;
  remaining: number;
};

// =============================================================================
// Main entry
// =============================================================================

export async function getDrawScheduleRollup(
  dealId: string
): Promise<DrawScheduleRollup> {
  const supabase = await createClient();

  const [
    rawLines,
    rawDraws,
    model,
  ] = await Promise.all([
    supabase
      .from("dm_draw_schedule_lines")
      .select("id, item_number, description, section, original_budget, revised_budget")
      .eq("deal_id", dealId)
      .eq("format_id", NUROCK_STANDARD_FORMAT_ID)
      .order("item_number", { nullsFirst: false }),
    supabase
      .from("dm_draws")
      .select("id, draw_number, status, submitted_at, funded_at")
      .eq("deal_id", dealId)
      .order("draw_number", { nullsFirst: false }),
    getUwModel(dealId),
  ]);

  if (rawLines.error) console.error("[draw-schedule-rollup] schedule lines:", rawLines.error);
  if (rawDraws.error) console.error("[draw-schedule-rollup] draws:", rawDraws.error);

  type DrawRow = {
    id: string;
    draw_number: number | null;
    status: string | null;
    submitted_at: string | null;
    funded_at: string | null;
  };
  const draws = (rawDraws.data ?? []) as DrawRow[];

  // Fetch draw lines for these draws (one shot)
  const drawIds = draws.map((d) => d.id);
  let drawLines: Array<{
    draw_id: string;
    draw_schedule_line_id: string | null;
    net_amount: number | string | null;
    gross_amount: number | string | null;
  }> = [];
  if (drawIds.length > 0) {
    const { data, error } = await supabase
      .from("dm_draw_lines")
      .select("draw_id, draw_schedule_line_id, net_amount, gross_amount")
      .in("draw_id", drawIds);
    if (error) console.error("[draw-schedule-rollup] draw lines:", error);
    drawLines = data ?? [];
  }

  // Build scheduleLines
  type ScheduleRow = {
    id: string;
    item_number: number | null;
    description: string | null;
    section: string | null;
    original_budget: number | string | null;
    revised_budget: number | string | null;
  };

  const scheduleLines: DealScheduleLine[] = ((rawLines.data ?? []) as ScheduleRow[])
    .map((r) => {
      const original = Number(r.original_budget) || 0;
      const revised =
        r.revised_budget != null && r.revised_budget !== ""
          ? Number(r.revised_budget) || 0
          : original;
      return {
        id: r.id,
        itemNumber: r.item_number,
        description: r.description ?? "(unnamed)",
        section: r.section ?? "Uncategorized",
        originalBudget: original,
        revisedBudget: revised,
        adjustments: revised - original,
      };
    });

  // Build drawColumns
  const drawColumns: DrawColumn[] = draws.map((d) => {
    const submittedAt = d.submitted_at ?? null;
    const fundedAt = d.funded_at ?? null;
    const isSubmitted = !!submittedAt;
    const isFunded = !!fundedAt;

    const monthLabel = submittedAt
      ? formatMonthLabel(submittedAt.substring(0, 7))
      : null;
    const numLabel = d.draw_number != null ? `Draw ${d.draw_number}` : "Draw";
    const label = isSubmitted
      ? `${numLabel} · ${monthLabel}`
      : `${numLabel} (${(d.status ?? "draft").toLowerCase()})`;

    return {
      id: d.id,
      drawNumber: d.draw_number ?? null,
      status: d.status ?? "draft",
      submittedAt,
      fundedAt,
      label,
      isSubmitted,
      isFunded,
      total: 0, // filled below
    };
  });

  // Sort: submitted (by submitted_at asc), then pending (by draw_number)
  drawColumns.sort((a, b) => {
    if (a.isSubmitted && !b.isSubmitted) return -1;
    if (!a.isSubmitted && b.isSubmitted) return 1;
    if (a.isSubmitted && b.isSubmitted) {
      return (a.submittedAt ?? "").localeCompare(b.submittedAt ?? "");
    }
    return (a.drawNumber ?? 0) - (b.drawNumber ?? 0);
  });

  // Build the cell matrix
  const byDrawByLine: Record<string, Record<string, number>> = {};
  const drawTotals: Record<string, number> = {};
  for (const dl of drawLines) {
    const lineId = dl.draw_schedule_line_id;
    const drawId = dl.draw_id;
    if (!lineId || !drawId) continue;
    const amount = Number(dl.net_amount) || 0;
    if (!byDrawByLine[lineId]) byDrawByLine[lineId] = {};
    byDrawByLine[lineId][drawId] = (byDrawByLine[lineId][drawId] ?? 0) + amount;
    drawTotals[drawId] = (drawTotals[drawId] ?? 0) + amount;
  }
  for (const col of drawColumns) col.total = drawTotals[col.id] ?? 0;

  // Drawn to date per line (submitted draws only)
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

  // Group by section (preserve first-appearance order)
  const sectionsSeen: string[] = [];
  const sectionMap = new Map<string, DealScheduleLine[]>();
  for (const line of scheduleLines) {
    if (!sectionMap.has(line.section)) sectionsSeen.push(line.section);
    const arr = sectionMap.get(line.section) ?? [];
    arr.push(line);
    sectionMap.set(line.section, arr);
  }

  const bySection: SectionGroup[] = sectionsSeen.map((section) => {
    const lines = sectionMap.get(section) ?? [];
    const originalBudget = lines.reduce((s, l) => s + l.originalBudget, 0);
    const adjustments = lines.reduce((s, l) => s + l.adjustments, 0);
    const adjustedBudget = lines.reduce((s, l) => s + l.revisedBudget, 0);
    const drawnToDate = lines.reduce((s, l) => s + (drawnByLine[l.id] ?? 0), 0);
    return {
      section,
      lines,
      originalBudget,
      adjustments,
      adjustedBudget,
      drawnToDate,
      remaining: adjustedBudget - drawnToDate,
    };
  });

  // Totals
  const originalBudget = scheduleLines.reduce((s, l) => s + l.originalBudget, 0);
  const adjustments = scheduleLines.reduce((s, l) => s + l.adjustments, 0);
  const adjustedBudget = scheduleLines.reduce((s, l) => s + l.revisedBudget, 0);
  const drawnToDate = Object.values(drawnByLine).reduce((s, v) => s + v, 0);
  const remaining = adjustedBudget - drawnToDate;
  const pctDrawn = adjustedBudget > 0 ? (drawnToDate / adjustedBudget) * 100 : 0;

  return {
    info: model?.info ?? null,
    scheduleLines,
    bySection,
    drawColumns,
    byDrawByLine,
    drawnByLine,
    totals: { originalBudget, adjustments, adjustedBudget, drawnToDate, remaining, pctDrawn },
    diagnostics: {
      scheduleLineCount: scheduleLines.length,
      drawCountTotal: drawColumns.length,
      drawCountSubmitted: drawColumns.filter((c) => c.isSubmitted).length,
      drawCountFunded: drawColumns.filter((c) => c.isFunded).length,
      drawLineCount: drawLines.length,
      dealHasSchedule: scheduleLines.length > 0,
    },
  };
}

// =============================================================================
// Helpers
// =============================================================================

function formatMonthLabel(yyyyMm: string): string {
  const parts = yyyyMm.split("-");
  if (parts.length !== 2) return yyyyMm;
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  if (isNaN(y) || isNaN(m)) return yyyyMm;
  const date = new Date(y, m - 1, 1);
  return date.toLocaleString("en-US", { month: "short", year: "2-digit" });
}
