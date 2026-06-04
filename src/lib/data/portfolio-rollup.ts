// =============================================================================
// Portfolio Rollup (Phase 7 r3)
// =============================================================================
// One cross-deal snapshot row per deal for the portfolio report (CSV + PDF).
// Built from a fixed set of batched queries (NOT one heavy getDashboardData
// per deal) so it stays fast regardless of portfolio size:
//   1. deals               — id, name, stage, model (for UW TDC + keyDates)
//   2. dm_draw_schedule_lines (NuRock Standard, live rows) → uses per deal
//   3. dm_draws            → drawn-to-date + count per deal
//   4. dm_funding_sources  → sources per deal (live-plug DDF applied)
// =============================================================================

import { createClient } from "@/lib/supabase/server";
import { NUROCK_STANDARD_FORMAT_ID } from "@/lib/formats";
import { computeDeferredDevFeePlug } from "@/lib/finance/deferred-dev-fee";

export interface PortfolioDeal {
  dealId: string;
  name: string;
  stage: string;
  isCustomSchedule: boolean;
  /** Total uses — schedule total (revised) if promoted, else UW model TDC. */
  tdc: number;
  drawn: number;
  drawnPct: number;
  drawCount: number;
  netSources: number;
  netUses: number;
  /** netSources − netUses; ~0 with the live-plug DDF. */
  sourcesBalance: number;
  nextMilestoneLabel: string | null;
  nextMilestoneDate: string | null;
}

export interface PortfolioRollup {
  deals: PortfolioDeal[];
  totals: {
    tdc: number;
    drawn: number;
    netSources: number;
    netUses: number;
    dealCount: number;
  };
}

// Milestone order for "next milestone" — mirrors dashboard-rollup.
const MILESTONE_ORDER: Array<{ key: string; label: string }> = [
  { key: "closingDate", label: "Closing" },
  { key: "constructionStart", label: "Construction Start" },
  { key: "construction25Complete", label: "25% Complete" },
  { key: "construction50Complete", label: "50% Complete" },
  { key: "construction75Complete", label: "75% Complete" },
  { key: "certificatesOfOccupancy", label: "Certificate of Occupancy" },
  { key: "placedInService", label: "Placed in Service" },
  { key: "stabilizationDate", label: "Stabilization" },
  { key: "permanentFinancingClosing", label: "Permanent Loan Closing" },
  { key: "form8609Delivery", label: "Form 8609 Delivery" },
];

export async function getPortfolioRollup(): Promise<PortfolioRollup> {
  const supabase = await createClient();
  const todayIso = new Date().toISOString().slice(0, 10);

  const [dealsRes, linesRes, drawsRes, sourcesRes] = await Promise.all([
    supabase.from("deals").select("id, name, stage, model, is_custom_schedule"),
    supabase
      .from("dm_draw_schedule_lines")
      .select("deal_id, revised_budget")
      .eq("format_id", NUROCK_STANDARD_FORMAT_ID)
      .lt("item_number", 10000),
    supabase
      .from("dm_draws")
      .select("deal_id, funded_at, total_net_amount"),
    supabase
      .from("dm_funding_sources")
      .select("deal_id, kind, commitment_amount"),
  ]);

  // ---- Uses (schedule total) per deal ----
  const scheduleByDeal = new Map<string, number>();
  for (const r of (linesRes.data ?? []) as Array<{
    deal_id: string;
    revised_budget: number | string | null;
  }>) {
    scheduleByDeal.set(
      r.deal_id,
      (scheduleByDeal.get(r.deal_id) ?? 0) + (Number(r.revised_budget) || 0)
    );
  }

  // ---- Drawn-to-date + count per deal (funded draws only) ----
  const drawnByDeal = new Map<string, number>();
  const drawCountByDeal = new Map<string, number>();
  for (const d of (drawsRes.data ?? []) as Array<{
    deal_id: string;
    funded_at: string | null;
    total_net_amount: number | string | null;
  }>) {
    if (!d.funded_at) continue;
    drawnByDeal.set(
      d.deal_id,
      (drawnByDeal.get(d.deal_id) ?? 0) + (Number(d.total_net_amount) || 0)
    );
    drawCountByDeal.set(d.deal_id, (drawCountByDeal.get(d.deal_id) ?? 0) + 1);
  }

  // ---- Funding sources per deal ----
  type SrcRow = { deal_id: string; kind: string | null; commitment: number };
  const sourcesByDeal = new Map<string, SrcRow[]>();
  for (const s of (sourcesRes.data ?? []) as Array<{
    deal_id: string;
    kind: string | null;
    commitment_amount: number | string | null;
  }>) {
    const list = sourcesByDeal.get(s.deal_id) ?? [];
    list.push({
      deal_id: s.deal_id,
      kind: s.kind,
      commitment: Number(s.commitment_amount) || 0,
    });
    sourcesByDeal.set(s.deal_id, list);
  }

  type DealRow = {
    id: string;
    name: string | null;
    stage: string | null;
    model: unknown;
    is_custom_schedule: boolean | null;
  };

  const deals: PortfolioDeal[] = ((dealsRes.data ?? []) as DealRow[]).map((d) => {
    const model = (d.model ?? {}) as {
      constructionBudget?: Array<{ amount?: number | string }>;
      keyDates?: Record<string, string | null | undefined>;
    };

    // Uses: prefer the live schedule total; fall back to UW model sum for
    // not-yet-promoted deals.
    const scheduleTotal = scheduleByDeal.get(d.id) ?? 0;
    const uwTdc = (model.constructionBudget ?? []).reduce(
      (s, l) => s + (Number(l.amount) || 0),
      0
    );
    const netUses = scheduleTotal > 0 ? scheduleTotal : uwTdc;

    // Sources: live-plug DDF, construction loans excluded (paid off at perm).
    const srcs = sourcesByDeal.get(d.id) ?? [];
    const ddfPlug = computeDeferredDevFeePlug(
      netUses,
      srcs.map((s) => ({ kind: s.kind, commitment: s.commitment }))
    );
    let netSources = 0;
    for (const s of srcs) {
      const k = (s.kind ?? "").toLowerCase();
      if (k === "construction_loan") continue; // paid off at perm
      netSources += k === "deferred_dev_fee" ? ddfPlug : s.commitment;
    }

    const drawn = drawnByDeal.get(d.id) ?? 0;

    // Next milestone — earliest dated keyDate on/after today.
    const kd = model.keyDates ?? {};
    let nextLabel: string | null = null;
    let nextDate: string | null = null;
    for (const m of MILESTONE_ORDER) {
      const v = kd[m.key];
      if (v && v >= todayIso) {
        if (!nextDate || v < nextDate) {
          nextDate = v;
          nextLabel = m.label;
        }
      }
    }

    return {
      dealId: d.id,
      name: d.name ?? "Untitled Deal",
      stage: d.stage ?? "—",
      isCustomSchedule: d.is_custom_schedule === true,
      tdc: netUses,
      drawn,
      drawnPct: netUses > 0 ? (drawn / netUses) * 100 : 0,
      drawCount: drawCountByDeal.get(d.id) ?? 0,
      netSources,
      netUses,
      sourcesBalance: netSources - netUses,
      nextMilestoneLabel: nextLabel,
      nextMilestoneDate: nextDate,
    };
  });

  // Sort by largest TDC first (biggest deals on top).
  deals.sort((a, b) => b.tdc - a.tdc);

  const totals = {
    tdc: deals.reduce((s, d) => s + d.tdc, 0),
    drawn: deals.reduce((s, d) => s + d.drawn, 0),
    netSources: deals.reduce((s, d) => s + d.netSources, 0),
    netUses: deals.reduce((s, d) => s + d.netUses, 0),
    dealCount: deals.length,
  };

  return { deals, totals };
}
