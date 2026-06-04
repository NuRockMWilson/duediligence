// =============================================================================
// Interim Cost Eligibility — pure calc engine
// =============================================================================
// Encodes the LIHTC eligible-basis math for the four interim-cost categories
// (interest, real-estate taxes, loan fees, builder's-risk insurance) as the
// Foxcroft Cove Development Workbook's Interim Costs tab applies them.
//
// See docs/eligibility-methodology.md for the worked-example walkthrough.
// All functions in this module are PURE: no DB reads, no Supabase coupling,
// no side effects. The server-action layer (Phase 5 r3) is responsible for
// pulling inputs and persisting results — this module just does the math.
// =============================================================================

/** Tag on cost_account_map identifying which calc applies. NULL on the
 *  DB side means "no auto-calc; eligible_amount is manually entered". */
export type InterimCostType = "interest" | "re_taxes" | "loan_fees" | "insurance";

/** Minimal deal context the calc engine needs. Sourced from the UW model's
 *  resolvedKeyDates (now correctly persisted post-task #77) + the deal's
 *  building roster.
 *
 *  Phase 5 MVP collapses a phased deal into a SINGLE building using
 *  `certificatesOfOccupancyIso` as the deal-wide Final CO Date. Phase 5 r5+
 *  will accept a `buildings[]` array with per-building Final CO + units for
 *  proper multi-building % under construction. */
export interface EligibilityDealContext {
  /** ISO `YYYY-MM-DD`. Threshold below which `re_taxes` / `loan_fees` /
   *  `insurance` are 100% eligible regardless of construction progress. */
  closingDateIso: string;
  /** ISO `YYYY-MM-DD`. Final CO Date (project-wide for single-building deals).
   *  After this date, all interim cost categories drop to 0% eligible. */
  certificatesOfOccupancyIso: string;
}

/** Output of every calc. Sum identity: eligible + ineligible = amount.
 *  `methodology` is a short human-readable trail saved to invoice-line
 *  metadata for audit + tooltip display. */
export interface EligibilityResult {
  eligibleAmount: number;
  ineligibleAmount: number;
  /** Free-form description, e.g.
   *  - "interest · 100% under construction in Sep 2026"
   *  - "re_taxes · 3 months pro-rata, 1 month pre-closing @100%, 2 months @100%"
   *  - "loan_fees · 12 months pro-rata, blended 87.5%"
   */
  methodology: string;
}

// ---------------------------------------------------------------------------
// Percent under construction
// ---------------------------------------------------------------------------

/** Fraction in [0, 1] of the project still under construction in calendar
 *  month M (interpreted as the LAST day of that month per the workbook's
 *  EOMONTH ladder).
 *
 *  Single-building MVP shape:
 *      pct = 1.0  if EOMONTH(M) ≤ certificatesOfOccupancy
 *            0.0  otherwise
 *
 *  Phase 5 r5+ replaces this with the per-building weighted sum
 *  Σ(buildingUnits where buildingFinalCO ≥ EOMONTH(M)) / Σ(buildingUnits).
 */
export function percentUnderConstruction(
  monthIso: string,
  ctx: EligibilityDealContext
): number {
  const m = endOfMonthIso(monthIso);
  const finalCo = endOfMonthIso(ctx.certificatesOfOccupancyIso);
  if (!m || !finalCo) return 0;
  // Inclusive: the month containing the Final CO still counts as under
  // construction (matches the workbook's IF($A7 <= B$6, ...) semantics).
  return m <= finalCo ? 1.0 : 0.0;
}

// ---------------------------------------------------------------------------
// Calc dispatch
// ---------------------------------------------------------------------------

/** Per-month interest payment line. */
export interface InterestCalcInput {
  amount: number;
  /** ISO `YYYY-MM-DD`. Used to determine which month's % under construction
   *  applies. Typically the invoice_date. */
  paymentMonthIso: string;
}

/** Period-spread line (re_taxes / loan_fees / insurance). */
export interface PeriodSpreadCalcInput {
  amount: number;
  /** ISO `YYYY-MM-DD`. Period this bill covers, inclusive. */
  periodStartIso: string;
  periodEndIso: string;
  /** Distinguishes which methodology string is rendered. The math is
   *  identical across re_taxes / loan_fees / insurance — only the label
   *  changes. */
  type: Extract<InterimCostType, "re_taxes" | "loan_fees" | "insurance">;
}

/**
 * Construction-loan interest. Per-month direct allocation:
 *
 *   eligible = round(amount × percentUnderConstruction(paymentMonth), 2)
 *
 * There's NO 100%-before-closing carve-out for interest, because
 * construction-loan interest by definition can't accrue before the loan
 * closes. Matches Foxcroft Workbook → Interim Costs → cols A-E (rows 6+):
 *
 *   D6 = ROUND(B6 × C6, 2)
 *   E6 = B6 − D6
 *
 * where C6 looks up the percent under construction for the row's month.
 */
export function computeInterestEligibility(
  input: InterestCalcInput,
  ctx: EligibilityDealContext
): EligibilityResult {
  const pct = percentUnderConstruction(input.paymentMonthIso, ctx);
  const eligible = round2(input.amount * pct);
  const ineligible = round2(input.amount - eligible);
  const monthLabel = monthLabelOf(input.paymentMonthIso);
  return {
    eligibleAmount: eligible,
    ineligibleAmount: ineligible,
    methodology:
      pct >= 0.999
        ? `interest · 100% under construction in ${monthLabel}`
        : pct <= 0.001
          ? `interest · 0% — ${monthLabel} is past Final CO`
          : `interest · ${(pct * 100).toFixed(2)}% under construction in ${monthLabel}`,
  };
}

/**
 * Period-spread eligibility for re_taxes / loan_fees / insurance.
 *
 * The workbook's pattern (cols I/L/O… for taxes, identical structure for
 * loan_fees and insurance) is:
 *
 *   monthlyAlloc = total ÷ ((periodEnd − periodStart) / 30)
 *
 *   For each EOMONTH M in [periodStart, periodEnd]:
 *     cappedAlloc = min(monthlyAlloc, remaining)  (or max if amount < 0)
 *     pct = (M ≤ closingDate) ? 1.0 : percentUnderConstruction(M)
 *     eligibleM   = round(cappedAlloc × pct, 2)
 *     remaining  -= cappedAlloc
 *
 * The day-count divisor (`/30`, not calendar months) intentionally matches
 * the workbook so a 90-day bill produces a $monthlyAlloc that's exactly
 * total/3, not total/(3 calendar months) — which would shift by a few
 * dollars when the bill straddles months of unequal length.
 *
 * The capped-running-sum pattern (cols K/N/Q… in the workbook) prevents
 * floating-point creep from over-allocating the bill total.
 */
export function computePeriodSpreadEligibility(
  input: PeriodSpreadCalcInput,
  ctx: EligibilityDealContext
): EligibilityResult {
  const start = parseIsoDate(input.periodStartIso);
  const end = parseIsoDate(input.periodEndIso);
  if (!start || !end || end < start) {
    // Defensive — should be caught by the DB CHECK + UI validation, but
    // return a safe no-op if it ever slips through.
    return {
      eligibleAmount: 0,
      ineligibleAmount: input.amount,
      methodology: `${input.type} · invalid period; treated as 100% ineligible`,
    };
  }

  // Day-count → 30-day "months" divisor. Matches the workbook's
  // `(end - start) / 30`.
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
  const spanMonths = Math.max(1, days / 30);
  const monthlyAlloc = round2(input.amount / spanMonths);
  const closing = parseIsoDate(ctx.closingDateIso);

  let remaining = input.amount;
  let eligibleTotal = 0;
  // Buckets used to build the methodology summary.
  let monthsPreClosing = 0;
  let monthsUnderConstruction = 0;
  let monthsPostCo = 0;
  // EOMONTH ladder from the first month touched by the period through the
  // last month touched. Walking calendar months by setting the date to
  // YYYY-MM-(last day of that month).
  const cur = new Date(start.getFullYear(), start.getMonth(), 1);
  const lastMonth = new Date(end.getFullYear(), end.getMonth(), 1);
  // Safety stop — period > 10 years is almost certainly bad input; bail.
  const MAX_MONTHS = 120;
  let safety = 0;
  while (cur <= lastMonth && safety < MAX_MONTHS) {
    safety++;
    const eom = new Date(cur.getFullYear(), cur.getMonth() + 1, 0);
    const eomIso = isoDate(eom);
    const isLastMonth =
      cur.getFullYear() === lastMonth.getFullYear() &&
      cur.getMonth() === lastMonth.getMonth();

    // Sign-aware cap (handles credit memos that flip the bill negative).
    // On the LAST month, sweep up any remaining bucket — matches the
    // workbook's behavior of running its 37-row MIN/MAX ladder until
    // remaining = 0 (we constrain to the period boundary instead, which
    // is the more natural "every dollar gets allocated within the period
    // the bill covers" interpretation; identical for periods that align
    // to 30-day buckets, differs by pennies for periods that don't).
    const cappedAlloc = isLastMonth
      ? remaining
      : input.amount < 0
        ? Math.max(monthlyAlloc, remaining) // monthlyAlloc is negative too
        : Math.min(monthlyAlloc, remaining);

    let pct: number;
    if (closing && eom <= closing) {
      pct = 1.0;
      monthsPreClosing++;
    } else {
      pct = percentUnderConstruction(eomIso, ctx);
      if (pct >= 0.999) monthsUnderConstruction++;
      else if (pct <= 0.001) monthsPostCo++;
      else monthsUnderConstruction++; // partial counts as under construction
    }

    const eligibleM = round2(cappedAlloc * pct);
    eligibleTotal = round2(eligibleTotal + eligibleM);
    remaining = round2(remaining - cappedAlloc);

    // Step to next month.
    cur.setMonth(cur.getMonth() + 1);
  }

  // Final identity: ineligible = total − eligible (guard against rounding
  // drift by deriving from total, not by summing the per-month ineligible).
  const ineligible = round2(input.amount - eligibleTotal);

  // Methodology summary.
  const typeLabel =
    input.type === "re_taxes"
      ? "re_taxes"
      : input.type === "loan_fees"
        ? "loan_fees"
        : "insurance";
  const monthsTotal = monthsPreClosing + monthsUnderConstruction + monthsPostCo;
  const parts: string[] = [];
  if (monthsPreClosing > 0) {
    parts.push(`${monthsPreClosing}mo pre-closing @100%`);
  }
  if (monthsUnderConstruction > 0) {
    parts.push(`${monthsUnderConstruction}mo under construction`);
  }
  if (monthsPostCo > 0) {
    parts.push(`${monthsPostCo}mo post-CO @0%`);
  }
  const blendedPct = input.amount !== 0 ? (eligibleTotal / input.amount) * 100 : 0;
  const methodology = `${typeLabel} · ${monthsTotal}mo period (${parts.join(", ")}), blended ${blendedPct.toFixed(2)}%`;

  return {
    eligibleAmount: eligibleTotal,
    ineligibleAmount: ineligible,
    methodology,
  };
}

// ---------------------------------------------------------------------------
// Internal date + math helpers
// ---------------------------------------------------------------------------

/** Round to 2 decimals matching the workbook's ROUND(x, 2). Handles JS
 *  floating-point drift by using EPSILON-safe arithmetic. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Parse a `YYYY-MM-DD` ISO string as a LOCAL Date (NOT UTC). Same TZ-safe
 *  parser pattern as lib/format.parseDateLocal — keeps the calc engine
 *  side-effect-free without dragging that whole module in. */
function parseIsoDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Format a Date as `YYYY-MM-DD` in LOCAL time. */
function isoDate(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

/** Coerce any ISO-ish date to that month's last day as `YYYY-MM-DD`. */
function endOfMonthIso(iso: string): string | null {
  const d = parseIsoDate(iso);
  if (!d) return null;
  return isoDate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

/** "September 2026" / etc. for methodology strings. */
function monthLabelOf(iso: string): string {
  const d = parseIsoDate(iso);
  if (!d) return iso;
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `${months[d.getMonth()]} ${d.getFullYear()}`;
}

/** Single entry point used by the invoice-line save action (Phase 5 r3).
 *  Dispatches on `type` and returns the matching result. */
export function computeEligibility(
  type: InterimCostType,
  amount: number,
  ctx: EligibilityDealContext,
  options: {
    paymentMonthIso?: string;
    periodStartIso?: string;
    periodEndIso?: string;
  }
): EligibilityResult {
  if (type === "interest") {
    if (!options.paymentMonthIso) {
      throw new Error(
        "interest eligibility requires paymentMonthIso (typically invoice_date)"
      );
    }
    return computeInterestEligibility(
      { amount, paymentMonthIso: options.paymentMonthIso },
      ctx
    );
  }
  if (!options.periodStartIso || !options.periodEndIso) {
    throw new Error(
      `${type} eligibility requires periodStartIso + periodEndIso`
    );
  }
  return computePeriodSpreadEligibility(
    {
      amount,
      periodStartIso: options.periodStartIso,
      periodEndIso: options.periodEndIso,
      type,
    },
    ctx
  );
}
