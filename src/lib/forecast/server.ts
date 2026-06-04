// =============================================================================
// Cash Flow & Capital Forecast — server data loader (Phase 8 r1)
// =============================================================================
// getForecastData(dealId): batches the DB reads the forecast engine needs,
// resolves each funding source into dated capital arrivals (consuming the
// existing dm_funding_source_tranches timing model), derives the planned
// S-curve anchors from keyDates, and runs the pure engine.
//
// Batched reads:
//   1. deals               — model (keyDates + constructionBudget fallback)
//   2. dm_draw_schedule_lines (NuRock Standard, live) → total uses
//   3. dm_draws            — funded draws → actual uses curve
//   4. dm_funding_sources  — commitments + kinds
//   5. dm_funding_source_tranches — per-source release timing (2nd round-trip;
//      tranches have no deal_id, so they're fetched by source id)
// =============================================================================

import { createClient } from "@/lib/supabase/server";
import { getUwModel, type UwKeyDates } from "@/lib/data/uw-model";
import { NUROCK_STANDARD_FORMAT_ID } from "@/lib/formats";
import { parseDateLocal } from "@/lib/format";
import {
  computeDeferredDevFeePlug,
  isDeferredDevFeeKind,
} from "@/lib/finance/deferred-dev-fee";
import {
  computeForecast,
  type ForecastResult,
  type ResolvedArrival,
  type ArrivalCategory,
  type PaceAnchor,
} from "./index";

export interface ForecastSensitivityRow {
  /** Months the equity pay-in schedule is slipped later. 0 = base case. */
  shiftMonths: number;
  minCash: number;
  fundingGap: number;
  fullyFunded: boolean;
}

export interface ForecastData extends ForecastResult {
  dealName: string;
  /** Echo of the resolved horizon anchors for the UI's "as modeled" note. */
  constructionStartIso: string | null;
  horizonEndIso: string | null;
  todayIso: string;
  /** Equity pay-in delay sensitivity (base + +1/+2/+3 months). Empty when the
   *  deal has no equity arrivals to shift. */
  sensitivity: ForecastSensitivityRow[];
}

// Whole-month difference, TZ-safe.
function monthsBetween(startIso: string, endIso: string): number {
  const a = parseDateLocal(startIso);
  const b = parseDateLocal(endIso);
  if (!a || !b) return 0;
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

const isRevolverKind = (kind: string | null): boolean =>
  /construction/.test((kind ?? "").toLowerCase());

// Shift an ISO date by n whole months (TZ-safe), preserving the day. Returns
// the input unchanged if unparseable.
function addMonthsIso(iso: string | null, n: number): string | null {
  const d = parseDateLocal(iso);
  if (!d) return iso;
  const r = new Date(d.getFullYear(), d.getMonth() + n, d.getDate());
  return `${r.getFullYear()}-${String(r.getMonth() + 1).padStart(2, "0")}-${String(
    r.getDate()
  ).padStart(2, "0")}`;
}

export async function getForecastData(dealId: string): Promise<ForecastData> {
  const supabase = await createClient();
  const todayIso = new Date().toISOString().slice(0, 10);

  const [dealRes, linesRes, drawsRes, sourcesRes] = await Promise.all([
    supabase.from("deals").select("name").eq("id", dealId).maybeSingle(),
    supabase
      .from("dm_draw_schedule_lines")
      .select("revised_budget")
      .eq("deal_id", dealId)
      .eq("format_id", NUROCK_STANDARD_FORMAT_ID)
      .lt("item_number", 10000),
    supabase
      .from("dm_draws")
      .select("funded_at, total_net_amount")
      .eq("deal_id", dealId)
      .not("funded_at", "is", null),
    supabase
      .from("dm_funding_sources")
      .select("id, name, kind, commitment_amount, drawn_amount")
      .eq("deal_id", dealId),
  ]);

  const model = await getUwModel(dealId);
  const keyDates: UwKeyDates =
    model?.keyDates ??
    ({
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
    } as UwKeyDates);

  // ----- total uses (live schedule total, fall back to UW budget) -----
  const scheduleTotal = ((linesRes.data ?? []) as Array<{
    revised_budget: number | string | null;
  }>).reduce((s, r) => s + (Number(r.revised_budget) || 0), 0);
  const uwTotal = (model?.constructionBudget ?? []).reduce(
    (s, l) => s + (Number(l.amount) || 0),
    0
  );
  const totalUses = scheduleTotal > 0 ? scheduleTotal : uwTotal;

  // ----- actual funded draws -----
  const actualDraws = ((drawsRes.data ?? []) as Array<{
    funded_at: string | null;
    total_net_amount: number | string | null;
  }>)
    .filter((d) => d.funded_at)
    .map((d) => ({
      fundedAtIso: d.funded_at as string,
      netAmount: Number(d.total_net_amount) || 0,
    }));

  // ----- funding sources + tranches -----
  type SrcRow = {
    id: string;
    name: string | null;
    kind: string | null;
    commitment_amount: number | string | null;
    drawn_amount: number | string | null;
  };
  const sources = (sourcesRes.data ?? []) as SrcRow[];
  const sourceIds = sources.map((s) => s.id);

  type TrancheRow = {
    funding_source_id: string;
    amount: number | string | null;
    projected_release_date: string | null;
    actual_release_date: string | null;
  };
  let tranches: TrancheRow[] = [];
  if (sourceIds.length > 0) {
    const { data } = await (supabase as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          in: (c: string, v: string[]) => Promise<{ data: TrancheRow[] | null }>;
        };
      };
    })
      .from("dm_funding_source_tranches")
      .select(
        "funding_source_id, amount, projected_release_date, actual_release_date"
      )
      .in("funding_source_id", sourceIds);
    tranches = data ?? [];
  }
  const tranchesBySource = new Map<string, TrancheRow[]>();
  for (const t of tranches) {
    const list = tranchesBySource.get(t.funding_source_id) ?? [];
    list.push(t);
    tranchesBySource.set(t.funding_source_id, list);
  }

  // Live-plug deferred dev fee (so a stale stored DDF doesn't distort sources).
  const ddfPlug = computeDeferredDevFeePlug(
    totalUses,
    sources.map((s) => ({
      kind: s.kind,
      commitment: Number(s.commitment_amount) || 0,
    }))
  );

  // ----- end anchor -----
  const horizonEndIso =
    keyDates.stabilizationDate ??
    keyDates.form8609Delivery ??
    keyDates.certificatesOfOccupancy ??
    keyDates.constructionCompleteFirstBuilding ??
    null;

  // Inferred arrival date for a source with no tranches.
  function inferArrivalIso(name: string, kind: string | null): string | null {
    const hay = `${name ?? ""} ${kind ?? ""}`.toLowerCase();
    if (isDeferredDevFeeKind(kind) || /ddf|deferred dev/.test(hay)) {
      // Deferred fee is the residual — paid last, from operations.
      return (
        keyDates.stabilizationDate ??
        keyDates.form8609Delivery ??
        horizonEndIso ??
        keyDates.closingDate ??
        null
      );
    }
    if (/perm|first mortgage|1st mortgage|permanent/.test(hay) && !/construction/.test(hay)) {
      return keyDates.permanentFinancingClosing ?? keyDates.closingDate ?? null;
    }
    if (/equity|lihtc|lp|gp/.test(hay)) {
      return keyDates.taxCreditPartnershipClosing ?? keyDates.closingDate ?? null;
    }
    return keyDates.closingDate ?? keyDates.constructionStart ?? null;
  }

  // Bucket a source by funding category (drives sensitivity — equity is the
  // arrival class whose timing we stress-test).
  function categoryOf(name: string, kind: string | null): ArrivalCategory {
    if (isDeferredDevFeeKind(kind)) return "ddf";
    const hay = `${name ?? ""} ${kind ?? ""}`.toLowerCase();
    if (/ddf|deferred dev/.test(hay)) return "ddf";
    if (/equity|lihtc|lp|gp/.test(hay)) return "equity";
    if (/perm|first mortgage|1st mortgage|permanent/.test(hay)) return "perm";
    return "soft";
  }

  // ----- resolve sources → revolver capacity + scheduled arrivals -----
  let revolverCommitment = 0;
  const scheduledArrivals: ResolvedArrival[] = [];

  for (const s of sources) {
    const isDdf = isDeferredDevFeeKind(s.kind);
    const commitment = isDdf ? ddfPlug : Number(s.commitment_amount) || 0;
    if (commitment === 0) continue;

    if (isRevolverKind(s.kind)) {
      // Construction loan — revolver capacity, drawn dynamically by the sim.
      revolverCommitment += commitment;
      continue;
    }

    const category = categoryOf(s.name ?? "", s.kind);
    const srcTranches = (tranchesBySource.get(s.id) ?? []).filter(
      (t) => (Number(t.amount) || 0) !== 0
    );
    const fallbackIso = inferArrivalIso(s.name ?? "", s.kind);

    if (srcTranches.length > 0 && !isDdf) {
      // Use the tranche release schedule (actual ?? projected ?? inferred).
      for (const t of srcTranches) {
        scheduledArrivals.push({
          amount: Number(t.amount) || 0,
          releaseDateIso:
            t.actual_release_date ?? t.projected_release_date ?? fallbackIso,
          category,
        });
      }
    } else {
      // No tranches (or DDF, which we size off the live plug): single arrival.
      scheduledArrivals.push({
        amount: commitment,
        releaseDateIso: fallbackIso,
        category,
      });
    }
  }

  // ----- planned S-curve anchors (from keyDates) -----
  const constructionStartIso =
    keyDates.constructionStart ??
    actualDraws.map((d) => d.fundedAtIso).filter(Boolean).sort()[0] ??
    null;
  const paceAnchors: PaceAnchor[] = [];
  if (constructionStartIso) {
    paceAnchors.push({ monthIndex: 0, frac: 0 });
    const add = (iso: string | null | undefined, frac: number) => {
      if (!iso) return;
      paceAnchors.push({
        monthIndex: Math.max(0, monthsBetween(constructionStartIso, iso)),
        frac,
      });
    };
    add(keyDates.construction25Complete, 0.25);
    add(keyDates.construction50Complete, 0.5);
    add(keyDates.construction75Complete, 0.75);
    add(
      keyDates.certificatesOfOccupancy ?? keyDates.constructionCompleteFirstBuilding,
      1.0
    );
    paceAnchors.sort((a, b) => a.monthIndex - b.monthIndex);
  }

  const engineInput = {
    todayIso,
    constructionStartIso,
    horizonEndIso,
    totalUses,
    paceAnchors,
    scheduledArrivals,
    revolverCommitment,
    actualDraws,
  };
  const result = computeForecast(engineInput);

  // ----- equity pay-in delay sensitivity -----
  // Re-run the engine with equity arrivals slipped +1/+2/+3 months to show
  // how a back-loaded pay-in tightens the trough. Only equity arrivals move;
  // everything else (perm, soft, DDF, the revolver) stays put.
  const hasEquity = scheduledArrivals.some((a) => a.category === "equity");
  const sensitivity: ForecastSensitivityRow[] = [];
  if (hasEquity) {
    for (const shift of [0, 1, 2, 3]) {
      const r =
        shift === 0
          ? result
          : computeForecast({
              ...engineInput,
              scheduledArrivals: scheduledArrivals.map((a) =>
                a.category === "equity"
                  ? { ...a, releaseDateIso: addMonthsIso(a.releaseDateIso, shift) }
                  : a
              ),
            });
      sensitivity.push({
        shiftMonths: shift,
        minCash: r.minCash,
        fundingGap: r.fundingGap,
        fullyFunded: r.fullyFunded,
      });
    }
  }

  return {
    ...result,
    dealName: dealRes.data?.name ?? "Untitled Deal",
    constructionStartIso,
    horizonEndIso: result.horizonEndIso ?? horizonEndIso,
    todayIso,
    sensitivity,
  };
}
