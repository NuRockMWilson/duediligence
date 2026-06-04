// =============================================================================
// Cash Flow & Capital Forecast — pure engine (Phase 8 r1)
// =============================================================================
// A time-phased monthly projection of USES EXPENDED vs CAPITAL AVAILABLE vs
// CASH ON HAND through stabilization, plus an implied construction-loan
// revolver. No I/O — every input is supplied by the server loader
// (lib/forecast/server.ts), so this module is deterministic and unit-testable.
//
// Modeling assumptions (v1 — surfaced in the UI so the CFO sees them):
//   1. Horizon: monthly buckets from construction start (or earliest capital
//      arrival / first draw, whichever is earlier) through the end anchor
//      (stabilization → 8609 → C-of-O → last draw period).
//   2. Uses expended: ACTUAL funded draws through the current month; the
//      planned construction-progress S-curve (keyDates anchors) drives the
//      increments thereafter, anchored onto the actual-to-date base and capped
//      at total uses.
//   3. Capital is split into:
//        • Revolver  — the construction loan. Capacity is available from day
//          one; it draws to cover monthly cash shortfalls and is repaid from
//          later capital surpluses (e.g. equity installments, perm proceeds).
//        • Scheduled — equity, perm, soft, deferred dev fee. Each arrives on
//          its tranche release date (actual ?? projected); the loader resolves
//          sources without tranches to a single inferred arrival.
//   4. Monthly cash sim: cash_carry + arrivals − uses, drawing/repaying the
//      revolver to keep cash ≥ 0 while capacity remains. If the revolver is
//      exhausted, cash goes (and stays) negative — that trough is the funding
//      gap.
// =============================================================================

import { parseDateLocal } from "@/lib/format";

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export interface PaceAnchor {
  /** Months from construction start. */
  monthIndex: number;
  /** Cumulative planned fraction of total uses at that month (0..1). */
  frac: number;
}

export type ArrivalCategory = "equity" | "perm" | "soft" | "ddf";

export interface ResolvedArrival {
  amount: number;
  /** ISO date the capital becomes available. Null arrivals are dropped. */
  releaseDateIso: string | null;
  /** Source bucket — used by sensitivity (e.g. shift only equity arrivals). */
  category?: ArrivalCategory;
}

export interface ForecastDrawInput {
  fundedAtIso: string;
  netAmount: number;
}

export interface ForecastInput {
  /** ISO yyyy-mm-dd "today" (injected — Date.now() is banned in workflows and
   *  passing it keeps the engine pure / testable). */
  todayIso: string;
  constructionStartIso: string | null;
  horizonEndIso: string | null;
  totalUses: number;
  paceAnchors: PaceAnchor[];
  /** Equity / perm / soft / DDF, already resolved to dated arrivals. */
  scheduledArrivals: ResolvedArrival[];
  /** Construction-loan revolver capacity. */
  revolverCommitment: number;
  /** Funded draws — drive the "actual" portion of the uses curve. */
  actualDraws: ForecastDrawInput[];
}

export interface ForecastMonth {
  monthIso: string; // YYYY-MM-01
  monthIndex: number; // months from construction start (can be < 0 pre-start)
  label: string; // "Jul 2026"
  /** True when the month is at/before today — uses are actuals, not plan. */
  isActual: boolean;
  usesExpended: number; // incremental this month
  usesCumulative: number;
  capitalIn: number; // scheduled capital arriving this month
  capitalCumulative: number; // scheduled capital arrived to date
  /** Scheduled-arrived + full revolver capacity = total dry powder by month. */
  capitalAvailableCumulative: number;
  revolverDraw: number; // + draw, − repayment
  revolverBalance: number; // outstanding revolver
  cashOnHand: number; // running cash position (negative ⇒ unfunded)
  /** max(0, −cashOnHand): the unfunded shortfall this month. */
  fundingGap: number;
}

export interface ForecastResult {
  months: ForecastMonth[];
  totalUses: number;
  totalScheduledCapital: number;
  revolverCommitment: number;
  /** Lowest cash position across the horizon (cushion if ≥0, gap if <0). */
  minCash: number;
  minCashMonthIso: string | null;
  /** Highest revolver balance — drives interest carry / covenant headroom. */
  peakRevolverBalance: number;
  peakRevolverMonthIso: string | null;
  /** max(0, −minCash) — the worst unfunded shortfall. */
  fundingGap: number;
  fundingGapMonthIso: string | null;
  fullyFunded: boolean;
  horizonStartIso: string | null;
  horizonEndIso: string | null;
}

// ----- planned S-curve interpolation ----------------------------------------

/** Piecewise-linear cumulative planned fraction at a given month index. */
export function plannedFracAtMonth(anchors: PaceAnchor[], mi: number): number {
  if (anchors.length === 0) return 0;
  const first = anchors[0];
  const last = anchors[anchors.length - 1];
  if (mi <= first.monthIndex) return first.frac;
  if (mi >= last.monthIndex) return last.frac;
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i];
    const b = anchors[i + 1];
    if (mi >= a.monthIndex && mi <= b.monthIndex) {
      const span = b.monthIndex - a.monthIndex || 1;
      const t = (mi - a.monthIndex) / span;
      return a.frac + (b.frac - a.frac) * t;
    }
  }
  return last.frac;
}

// ----- month helpers ---------------------------------------------------------

interface Ym {
  y: number;
  m: number; // 1-based
}

function toYm(iso: string | null | undefined): Ym | null {
  const d = parseDateLocal(iso);
  if (!d) return null;
  return { y: d.getFullYear(), m: d.getMonth() + 1 };
}

function ymKey(ym: Ym): string {
  return `${ym.y}-${String(ym.m).padStart(2, "0")}`;
}

function ymIso(ym: Ym): string {
  return `${ym.y}-${String(ym.m).padStart(2, "0")}-01`;
}

function ymLabel(ym: Ym): string {
  return `${MONTHS_SHORT[ym.m - 1]} ${ym.y}`;
}

/** Whole-month difference b − a. */
function monthDiff(a: Ym, b: Ym): number {
  return (b.y - a.y) * 12 + (b.m - a.m);
}

function addMonths(ym: Ym, n: number): Ym {
  const total = (ym.y * 12 + (ym.m - 1)) + n;
  return { y: Math.floor(total / 12), m: (total % 12) + 1 };
}

function minYm(a: Ym | null, b: Ym | null): Ym | null {
  if (!a) return b;
  if (!b) return a;
  return monthDiff(a, b) < 0 ? b : a;
}

function maxYm(a: Ym | null, b: Ym | null): Ym | null {
  if (!a) return b;
  if (!b) return a;
  return monthDiff(a, b) > 0 ? b : a;
}

// ----- engine ----------------------------------------------------------------

const EMPTY: ForecastResult = {
  months: [],
  totalUses: 0,
  totalScheduledCapital: 0,
  revolverCommitment: 0,
  minCash: 0,
  minCashMonthIso: null,
  peakRevolverBalance: 0,
  peakRevolverMonthIso: null,
  fundingGap: 0,
  fundingGapMonthIso: null,
  fullyFunded: true,
  horizonStartIso: null,
  horizonEndIso: null,
};

export function computeForecast(input: ForecastInput): ForecastResult {
  const {
    todayIso,
    constructionStartIso,
    horizonEndIso,
    totalUses,
    paceAnchors,
    scheduledArrivals,
    revolverCommitment,
    actualDraws,
  } = input;

  // Drop arrivals/draws without usable dates.
  const arrivals = scheduledArrivals.filter(
    (a) => a.releaseDateIso && toYm(a.releaseDateIso) && a.amount !== 0
  );
  const draws = actualDraws.filter(
    (d) => d.fundedAtIso && toYm(d.fundedAtIso) && d.netAmount !== 0
  );
  const totalScheduledCapital = arrivals.reduce((s, a) => s + a.amount, 0);

  // ----- horizon bounds -----
  const startYm = toYm(constructionStartIso);
  let lo: Ym | null = startYm;
  for (const a of arrivals) lo = minYm(lo, toYm(a.releaseDateIso));
  for (const d of draws) lo = minYm(lo, toYm(d.fundedAtIso));

  let hi: Ym | null = toYm(horizonEndIso);
  for (const a of arrivals) hi = maxYm(hi, toYm(a.releaseDateIso));
  for (const d of draws) hi = maxYm(hi, toYm(d.fundedAtIso));
  // Guarantee the horizon spans at least through "today" so the actual/plan
  // boundary is always inside the chart.
  hi = maxYm(hi, toYm(todayIso));

  if (!lo || !hi || monthDiff(lo, hi) < 0) return { ...EMPTY, totalUses, totalScheduledCapital, revolverCommitment };

  // ----- bucket arrivals + actual draws by month -----
  const arrivalsByMonth = new Map<string, number>();
  for (const a of arrivals) {
    const k = ymKey(toYm(a.releaseDateIso)!);
    arrivalsByMonth.set(k, (arrivalsByMonth.get(k) ?? 0) + a.amount);
  }
  const drawsByMonth = new Map<string, number>();
  for (const d of draws) {
    const k = ymKey(toYm(d.fundedAtIso)!);
    drawsByMonth.set(k, (drawsByMonth.get(k) ?? 0) + d.netAmount);
  }

  const todayYm = toYm(todayIso)!;
  const todayKey = ymKey(todayYm);
  // monthIndex of a month relative to construction start (fallback: horizon lo).
  const anchorYm = startYm ?? lo;
  const todayMonthIndex = monthDiff(anchorYm, todayYm);

  // Actual cumulative funded draws through today (the base the plan rides on).
  let actualCumAtToday = 0;
  for (const [k, v] of drawsByMonth) {
    if (k <= todayKey) actualCumAtToday += v;
  }
  const plannedCumAtToday = plannedFracAtMonth(paceAnchors, todayMonthIndex) * totalUses;

  // ----- walk months -----
  const span = monthDiff(lo, hi);
  const months: ForecastMonth[] = [];

  let actualCumWalk = 0;
  let prevUsesCum = 0;
  let capitalCum = 0;
  let cash = 0;
  let rev = 0;

  let minCash = Number.POSITIVE_INFINITY;
  let minCashMonthIso: string | null = null;
  let peakRev = 0;
  let peakRevMonthIso: string | null = null;
  let worstGap = 0;
  let worstGapMonthIso: string | null = null;

  for (let i = 0; i <= span; i++) {
    const ym = addMonths(lo, i);
    const key = ymKey(ym);
    const iso = ymIso(ym);
    const monthIndex = monthDiff(anchorYm, ym);
    const isActual = key <= todayKey;

    // ----- uses cumulative -----
    let usesCum: number;
    if (isActual) {
      actualCumWalk += drawsByMonth.get(key) ?? 0;
      usesCum = actualCumWalk;
    } else {
      const plannedCum = plannedFracAtMonth(paceAnchors, monthIndex) * totalUses;
      usesCum = actualCumAtToday + (plannedCum - plannedCumAtToday);
      // never regress below the actual base, never exceed total uses
      if (usesCum < actualCumAtToday) usesCum = actualCumAtToday;
      if (totalUses > 0 && usesCum > totalUses) usesCum = totalUses;
    }
    const usesExpended = usesCum - prevUsesCum;
    prevUsesCum = usesCum;

    // ----- capital arriving this month -----
    const capitalIn = arrivalsByMonth.get(key) ?? 0;
    capitalCum += capitalIn;
    const capitalAvailableCumulative = capitalCum + revolverCommitment;

    // ----- cash simulation w/ revolver -----
    let net = cash + capitalIn - usesExpended;
    let revolverDraw = 0;
    if (net < 0) {
      const capacity = Math.max(0, revolverCommitment - rev);
      revolverDraw = Math.min(-net, capacity);
      rev += revolverDraw;
      net += revolverDraw;
    } else if (rev > 0) {
      const repay = Math.min(net, rev);
      rev -= repay;
      revolverDraw = -repay;
      net -= repay;
    }
    cash = net;
    const fundingGap = cash < 0 ? -cash : 0;

    if (cash < minCash) {
      minCash = cash;
      minCashMonthIso = iso;
    }
    if (rev > peakRev) {
      peakRev = rev;
      peakRevMonthIso = iso;
    }
    if (fundingGap > worstGap) {
      worstGap = fundingGap;
      worstGapMonthIso = iso;
    }

    months.push({
      monthIso: iso,
      monthIndex,
      label: ymLabel(ym),
      isActual,
      usesExpended,
      usesCumulative: usesCum,
      capitalIn,
      capitalCumulative: capitalCum,
      capitalAvailableCumulative,
      revolverDraw,
      revolverBalance: rev,
      cashOnHand: cash,
      fundingGap,
    });
  }

  if (!Number.isFinite(minCash)) minCash = 0;

  return {
    months,
    totalUses,
    totalScheduledCapital,
    revolverCommitment,
    minCash,
    minCashMonthIso,
    peakRevolverBalance: peakRev,
    peakRevolverMonthIso: peakRevMonthIso,
    fundingGap: worstGap,
    fundingGapMonthIso: worstGapMonthIso,
    fullyFunded: worstGap < 1,
    horizonStartIso: ymIso(lo),
    horizonEndIso: ymIso(hi),
  };
}
