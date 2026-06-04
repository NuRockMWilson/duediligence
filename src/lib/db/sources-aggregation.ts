import type { SupabaseClient } from "@supabase/supabase-js";

// =============================================================================
// Phase 7.4 — Total Sources aggregation
// =============================================================================
// Mirrors the workbook's Draw Schedule SOURCES section, restructured to align
// with the Uses table column-for-column and to handle phase decomposition:
//
//   - Construction-phase loans (construction_loan, bridge_loan) emit two
//     display rows: the source itself, and a payoff row (negative) representing
//     the loan being retired at conversion. Net contribution = 0; the
//     permanent sources fund the payoff.
//   - construction_to_perm loans emit a single row (the same instrument
//     carries through both phases at the same amount — no payoff).
//   - permanent_loan rows emit a single row (comes in at conversion).
//   - lihtc_equity (and state_credits) emit TWO rows: "Equity During
//     Construction" and "Equity Post Construction". The split is taken from
//     metadata.equity_during_construction when present (populated by the LIHTC
//     model's promotion path from the syndicator's pay-in schedule);
//     otherwise a default 25%/75% split is used and a flag is surfaced so
//     the UI can show a banner.
//   - All other kinds emit a single row.
//
// Total Sources Revised should equal Total Uses Revised (TDC). Drift surfaces
// in a reconciliation banner.
//
// Allocations (dm_draw_line_allocations) drive the Drawn / Draft columns:
//   - source-side rows pull allocations against their funding_source_id
//   - payoff rows are always Drawn=$0, Draft=$0 (no allocation tracking
//     for payoffs yet — that comes when conversion event tracking lands)
//   - equity split rows prorate the source's allocations by the split %
//     (an approximation; will be replaced with phase-tagged allocations
//     once the model emits per-phase pay-in events).

export const SUBMITTED_STATUSES = new Set([
  "submitted",
  "pm_approved",
  "cfo_approved",
  "lender_approved",
  "funded",
]);

// Kinds whose construction-phase commitment gets paid off at conversion.
// construction_to_perm stays through both phases (same instrument, same
// amount), so no payoff. permanent_loan only exists post-conversion, also
// no payoff. Soft loans (HOME, NHTF, etc.) typically stay through perm.
const KINDS_WITH_PAYOFF = new Set(["construction_loan", "bridge_loan"]);

// Kinds that get split into during/post construction phases (capital that
// pays in over the project lifecycle rather than landing as a single draw).
const KINDS_WITH_PHASE_SPLIT = new Set(["lihtc_equity", "state_credits"]);

// Default during-construction pay-in percentage when the model hasn't
// populated metadata.equity_during_construction. Conservative estimate of
// the typical syndicator pay-in: 25% during, 75% at/after stabilization.
const DEFAULT_DURING_CONSTRUCTION_PCT = 0.25;

export interface SourceDisplayRow {
  // Stable id for React keys. Composite: <funding_source_id>:<role>
  rowId: string;
  // The underlying funding source id (or null for synthetic rows). Used
  // by allocations aggregation when not split/payoff.
  fundingSourceId: string | null;
  displayName: string;
  lenderName: string | null;
  kind: string;
  role: "source" | "payoff" | "equity_during" | "equity_post";
  // Columns matching the Uses table
  original: number;
  adjustments: number;
  revised: number;
  activeDraft: number;
  drawnToDate: number;
  // Renderer flags
  isPayoff: boolean;
  isEstimatedSplit: boolean;
}

export interface SourcesAggregation {
  rows: SourceDisplayRow[];
  totals: {
    original: number;
    adjustments: number;
    revised: number;
    activeDraft: number;
    drawnToDate: number;
    remaining: number;
  };
  // Reconciliation gap between uses-side (draw line nets) and sources-side
  // (allocations). Submitted draws should always reconcile; draft draws
  // can legitimately have unallocated lines.
  unallocated: {
    drawn: number;
    draft: number;
  };
  // True when at least one equity row used the default 25/75 split because
  // metadata.equity_during_construction wasn't populated. UI surfaces a
  // banner.
  anyEquitySplitEstimated: boolean;
}

export async function fetchSourcesAggregation(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  dealId: string,
  prefetched?: {
    draws?: Array<{ id: string; status: string }>;
    drawLineNetByDrawId?: Map<string, number>;
  }
): Promise<SourcesAggregation> {
  // 1. Funding sources
  const { data: sourcesRaw } = await supabase
    .from("dm_funding_sources")
    .select(
      "id, name, lender_name, kind, commitment_amount, position, metadata"
    )
    .eq("deal_id", dealId)
    .order("position", { ascending: true });
  const sources = sourcesRaw ?? [];

  // 2. Draws
  let draws = prefetched?.draws ?? [];
  if (!prefetched?.draws) {
    const { data: drawsRaw } = await supabase
      .from("dm_draws")
      .select("id, status")
      .eq("deal_id", dealId);
    draws = drawsRaw ?? [];
  }
  const drawStatusById = new Map<string, string>();
  for (const d of draws) drawStatusById.set(d.id, d.status);

  // 3. Draw lines
  const drawIds = draws.map((d) => d.id);
  const drawLineDrawIdById = new Map<string, string>();
  let drawLineNetByDrawId = prefetched?.drawLineNetByDrawId;
  if (drawIds.length > 0) {
    const { data: drawLinesRaw } = await supabase
      .from("dm_draw_lines")
      .select("id, draw_id, net_amount")
      .in("draw_id", drawIds);
    const drawLines = drawLinesRaw ?? [];
    for (const dl of drawLines) drawLineDrawIdById.set(dl.id, dl.draw_id);
    if (!drawLineNetByDrawId) {
      drawLineNetByDrawId = new Map();
      for (const dl of drawLines) {
        const cur = drawLineNetByDrawId.get(dl.draw_id) ?? 0;
        drawLineNetByDrawId.set(
          dl.draw_id,
          cur + Number(dl.net_amount ?? 0)
        );
      }
    }
  }
  if (!drawLineNetByDrawId) drawLineNetByDrawId = new Map();

  // 4. Allocations
  const drawLineIds = Array.from(drawLineDrawIdById.keys());
  const drawnBySource = new Map<string, number>();
  const draftBySource = new Map<string, number>();
  let totalDrawnAllocated = 0;
  let totalDraftAllocated = 0;
  if (drawLineIds.length > 0) {
    const { data: allocRaw } = await supabase
      .from("dm_draw_line_allocations")
      .select("draw_line_id, funding_source_id, amount")
      .in("draw_line_id", drawLineIds);
    for (const a of allocRaw ?? []) {
      const drawId = drawLineDrawIdById.get(a.draw_line_id);
      if (!drawId) continue;
      const status = drawStatusById.get(drawId) ?? "draft";
      const amt = Number(a.amount);
      if (SUBMITTED_STATUSES.has(status)) {
        drawnBySource.set(
          a.funding_source_id,
          (drawnBySource.get(a.funding_source_id) ?? 0) + amt
        );
        totalDrawnAllocated += amt;
      } else {
        draftBySource.set(
          a.funding_source_id,
          (draftBySource.get(a.funding_source_id) ?? 0) + amt
        );
        totalDraftAllocated += amt;
      }
    }
  }

  // 5. Generate display rows
  const rows: SourceDisplayRow[] = [];
  let anyEquitySplitEstimated = false;

  for (const s of sources) {
    const commitment = Number(s.commitment_amount ?? 0);
    const sourceDrawn = drawnBySource.get(s.id) ?? 0;
    const sourceDraft = draftBySource.get(s.id) ?? 0;
    const md = (s.metadata ?? {}) as Record<string, unknown>;

    if (KINDS_WITH_PHASE_SPLIT.has(s.kind)) {
      const duringFromMd =
        typeof md.equity_during_construction === "number"
          ? (md.equity_during_construction as number)
          : null;
      const postFromMd =
        typeof md.equity_post_construction === "number"
          ? (md.equity_post_construction as number)
          : null;
      let duringAmt: number;
      let postAmt: number;
      let estimated = false;
      if (duringFromMd !== null && postFromMd !== null) {
        duringAmt = duringFromMd;
        postAmt = postFromMd;
      } else if (duringFromMd !== null) {
        duringAmt = duringFromMd;
        postAmt = commitment - duringFromMd;
      } else if (postFromMd !== null) {
        postAmt = postFromMd;
        duringAmt = commitment - postFromMd;
      } else {
        duringAmt = commitment * DEFAULT_DURING_CONSTRUCTION_PCT;
        postAmt = commitment - duringAmt;
        estimated = true;
        anyEquitySplitEstimated = true;
      }

      const splitPct = commitment > 0 ? duringAmt / commitment : 0;
      const duringDrawn = sourceDrawn * splitPct;
      const duringDraft = sourceDraft * splitPct;
      const postDrawn = sourceDrawn - duringDrawn;
      const postDraft = sourceDraft - duringDraft;

      rows.push({
        rowId: `${s.id}:during`,
        fundingSourceId: s.id,
        displayName: `${s.name} — During Construction`,
        lenderName: s.lender_name,
        kind: s.kind,
        role: "equity_during",
        original: duringAmt,
        adjustments: 0,
        revised: duringAmt,
        activeDraft: duringDraft,
        drawnToDate: duringDrawn,
        isPayoff: false,
        isEstimatedSplit: estimated,
      });
      rows.push({
        rowId: `${s.id}:post`,
        fundingSourceId: s.id,
        displayName: `${s.name} — Post Construction`,
        lenderName: s.lender_name,
        kind: s.kind,
        role: "equity_post",
        original: postAmt,
        adjustments: 0,
        revised: postAmt,
        activeDraft: postDraft,
        drawnToDate: postDrawn,
        isPayoff: false,
        isEstimatedSplit: estimated,
      });
    } else {
      rows.push({
        rowId: `${s.id}:source`,
        fundingSourceId: s.id,
        displayName: s.name,
        lenderName: s.lender_name,
        kind: s.kind,
        role: "source",
        original: commitment,
        adjustments: 0,
        revised: commitment,
        activeDraft: sourceDraft,
        drawnToDate: sourceDrawn,
        isPayoff: false,
        isEstimatedSplit: false,
      });

      if (KINDS_WITH_PAYOFF.has(s.kind)) {
        rows.push({
          rowId: `${s.id}:payoff`,
          fundingSourceId: s.id,
          displayName: `${s.name} — Payoff at Conversion`,
          lenderName: s.lender_name,
          kind: s.kind,
          role: "payoff",
          original: -commitment,
          adjustments: 0,
          revised: -commitment,
          activeDraft: 0,
          drawnToDate: 0,
          isPayoff: true,
          isEstimatedSplit: false,
        });
      }
    }
  }

  // 6. Totals
  const totals = {
    original: rows.reduce((s, r) => s + r.original, 0),
    adjustments: rows.reduce((s, r) => s + r.adjustments, 0),
    revised: rows.reduce((s, r) => s + r.revised, 0),
    activeDraft: rows.reduce((s, r) => s + r.activeDraft, 0),
    drawnToDate: rows.reduce((s, r) => s + r.drawnToDate, 0),
    remaining: 0,
  };
  totals.remaining =
    totals.revised - totals.activeDraft - totals.drawnToDate;

  // 7. Allocation reconciliation
  let usesDrawn = 0;
  let usesDraft = 0;
  for (const [drawId, sum] of drawLineNetByDrawId) {
    const status = drawStatusById.get(drawId) ?? "draft";
    if (SUBMITTED_STATUSES.has(status)) usesDrawn += sum;
    else usesDraft += sum;
  }

  return {
    rows,
    totals,
    unallocated: {
      drawn: Math.max(0, usesDrawn - totalDrawnAllocated),
      draft: Math.max(0, usesDraft - totalDraftAllocated),
    },
    anyEquitySplitEstimated,
  };
}
