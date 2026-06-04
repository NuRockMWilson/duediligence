// =============================================================================
// Interim cost amortization for the cost certification
// =============================================================================
// Pure functions that mirror the FHFC FCC workbook's "Percentage Under
// Construction" + "Interim Costs" tabs. Construction-period interim costs
// (interest, real-estate taxes, insurance, loan fees) are eligible basis only
// to the extent the project is still UNDER CONSTRUCTION when the cost is
// incurred. This module computes that split per invoice line.
//
// Percentage under construction (for a given month M):
//   %UC(M) = Σ units of buildings still under construction in M ÷ Σ total units
// A building is "under construction" in month M when its month-end falls on or
// before the building's Final CO date. A building with NO Final CO date yet is
// treated as still under construction (matches the workbook, where a blank CO
// keeps the building at 100%).
//
// Per-line method:
//   interest                      → eligible = amount × %UC(payment month)
//   re_taxes | insurance | loan_fees (period costs)
//                                 → spread the amount across the service-period
//                                   months (day-count ÷ 30, matching the
//                                   workbook divisor); each month's slice ×
//                                   %UC(that month); sum the eligible slices.
//
// No I/O — the cost-cert page assembles inputs (buildings, interim lines) and
// calls these. Deterministic ⇒ unit-testable.
// =============================================================================

export type InterimType = "interest" | "re_taxes" | "loan_fees" | "insurance";

export interface AmortBuilding {
  /** Total units in the building (drives the unit-weighted %UC). */
  unitCount: number;
  /** Final CO / placed-in-service date (ISO yyyy-mm-dd); null = not yet, so the
   *  building is still under construction. */
  finalCoDateIso: string | null;
}

export interface InterimLineInput {
  id: string;
  type: InterimType;
  amount: number;
  /** interest: the month the interest was paid/accrued (invoice date works). */
  paymentDateIso?: string | null;
  /** period costs: the service-period start/end. */
  periodStartIso?: string | null;
  periodEndIso?: string | null;
  /** Optional labels, carried through to the result for display. */
  invoiceNumber?: string;
  vendorName?: string;
}

export interface InterimLineResult {
  id: string;
  type: InterimType;
  amount: number;
  eligible: number;
  ineligible: number;
  /** Human-readable trace, e.g. "interest · 62.5% under construction in Aug 2026". */
  methodology: string;
  /** Set when inputs were insufficient (missing dates) — line couldn't amortize. */
  error?: string;
  invoiceNumber?: string;
  vendorName?: string;
}

// ----- date helpers (UTC, ISO yyyy-mm-dd) -----------------------------------

function parseIso(iso: string): { y: number; m: number; d: number } | null {
  const mm = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!mm) return null;
  return { y: +mm[1], m: +mm[2], d: +mm[3] };
}

/** Month-end ISO for the month `offset` months after the month containing `iso`. */
function eomonth(iso: string, offset: number): string | null {
  const p = parseIso(iso);
  if (!p) return null;
  // Day 0 of (month+offset+1) = last day of (month+offset).
  const dt = new Date(Date.UTC(p.y, p.m - 1 + offset + 1, 0));
  return dt.toISOString().slice(0, 10);
}

/** Whole-day difference end − start (UTC). */
function dayDiff(startIso: string, endIso: string): number | null {
  const a = parseIso(startIso);
  const b = parseIso(endIso);
  if (!a || !b) return null;
  const ms =
    Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d);
  return Math.round(ms / 86_400_000);
}

function monthLabel(monthEndIso: string): string {
  const p = parseIso(monthEndIso);
  if (!p) return monthEndIso;
  const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${MON[p.m - 1]} ${p.y}`;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// ----- percentage under construction ----------------------------------------

/** Fraction in [0,1] of units still under construction at a given month-end. */
export function percentUnderConstruction(
  monthEndIso: string,
  buildings: AmortBuilding[]
): number {
  const total = buildings.reduce((s, b) => s + (b.unitCount || 0), 0);
  if (total <= 0) return 0;
  let underConstruction = 0;
  for (const b of buildings) {
    const co = b.finalCoDateIso;
    // No CO yet → still under construction. Otherwise under construction while
    // the month-end is on/before the Final CO date.
    if (!co || monthEndIso <= co) underConstruction += b.unitCount || 0;
  }
  return underConstruction / total;
}

// ----- per-line amortization ------------------------------------------------

function amortizeInterest(
  line: InterimLineInput,
  buildings: AmortBuilding[]
): InterimLineResult {
  const base: InterimLineResult = {
    id: line.id,
    type: line.type,
    amount: line.amount,
    eligible: 0,
    ineligible: 0,
    methodology: "",
    invoiceNumber: line.invoiceNumber,
    vendorName: line.vendorName,
  };
  if (!line.paymentDateIso) {
    return { ...base, ineligible: line.amount, error: "missing payment/invoice date" };
  }
  const monthEnd = eomonth(line.paymentDateIso, 0);
  if (!monthEnd) {
    return { ...base, ineligible: line.amount, error: "bad payment date" };
  }
  const pct = percentUnderConstruction(monthEnd, buildings);
  const eligible = round2(line.amount * pct);
  const ineligible = round2(line.amount - eligible);
  return {
    ...base,
    eligible,
    ineligible,
    methodology: `interest · ${(pct * 100).toFixed(1)}% under construction in ${monthLabel(monthEnd)}`,
  };
}

function amortizePeriod(
  line: InterimLineInput,
  buildings: AmortBuilding[]
): InterimLineResult {
  const base: InterimLineResult = {
    id: line.id,
    type: line.type,
    amount: line.amount,
    eligible: 0,
    ineligible: 0,
    methodology: "",
    invoiceNumber: line.invoiceNumber,
    vendorName: line.vendorName,
  };
  if (!line.periodStartIso || !line.periodEndIso) {
    return { ...base, ineligible: line.amount, error: "missing service period" };
  }
  const days = dayDiff(line.periodStartIso, line.periodEndIso);
  if (days === null || days <= 0) {
    return { ...base, ineligible: line.amount, error: "invalid service period" };
  }
  // Workbook divisor: day-count ÷ 30 (≈ months, but matches the sheet exactly).
  const months = days / 30;
  const monthlyAlloc = line.amount / months;

  // Walk EOMONTH from the period start to the period end. Cap the running
  // allocation so rounding never over/under-distributes the total.
  let eligible = 0;
  let allocated = 0;
  let monthsUnder = 0;
  let monthsTotal = 0;
  const startEnd = eomonth(line.periodStartIso, 0)!;
  const lastEnd = eomonth(line.periodEndIso, 0)!;
  let cursor = startEnd;
  let guard = 0;
  while (cursor <= lastEnd && guard < 600) {
    monthsTotal++;
    const isLast = cursor === lastEnd;
    const slice = isLast
      ? round2(line.amount - allocated) // sweep remainder into the last month
      : round2(monthlyAlloc);
    allocated = round2(allocated + slice);
    const pct = percentUnderConstruction(cursor, buildings);
    if (pct > 0) monthsUnder++;
    eligible = round2(eligible + slice * pct);
    cursor = eomonth(cursor, 1)!;
    guard++;
  }
  eligible = round2(eligible);
  const ineligible = round2(line.amount - eligible);
  const blendedPct = line.amount !== 0 ? (eligible / line.amount) * 100 : 0;
  const typeLabel = line.type.replace("_", " ");
  return {
    ...base,
    eligible,
    ineligible,
    methodology: `${typeLabel} · ${monthsTotal}mo period (${monthsUnder} under construction), blended ${blendedPct.toFixed(1)}% eligible`,
  };
}

/** Amortize a single interim line. */
export function amortizeInterimLine(
  line: InterimLineInput,
  buildings: AmortBuilding[]
): InterimLineResult {
  return line.type === "interest"
    ? amortizeInterest(line, buildings)
    : amortizePeriod(line, buildings);
}

export interface InterimAmortizationSummary {
  lines: InterimLineResult[];
  byType: Record<InterimType, { count: number; amount: number; eligible: number; ineligible: number }>;
  totalAmount: number;
  totalEligible: number;
  totalIneligible: number;
  /** Lines that couldn't amortize for lack of dates. */
  errorCount: number;
}

/** Amortize a batch of interim lines and roll them up by type. */
export function amortizeInterimCosts(
  lines: InterimLineInput[],
  buildings: AmortBuilding[]
): InterimAmortizationSummary {
  const results = lines.map((l) => amortizeInterimLine(l, buildings));
  const emptyBucket = () => ({ count: 0, amount: 0, eligible: 0, ineligible: 0 });
  const byType: InterimAmortizationSummary["byType"] = {
    interest: emptyBucket(),
    re_taxes: emptyBucket(),
    loan_fees: emptyBucket(),
    insurance: emptyBucket(),
  };
  let totalAmount = 0;
  let totalEligible = 0;
  let totalIneligible = 0;
  let errorCount = 0;
  for (const r of results) {
    const b = byType[r.type];
    b.count++;
    b.amount = round2(b.amount + r.amount);
    b.eligible = round2(b.eligible + r.eligible);
    b.ineligible = round2(b.ineligible + r.ineligible);
    totalAmount = round2(totalAmount + r.amount);
    totalEligible = round2(totalEligible + r.eligible);
    totalIneligible = round2(totalIneligible + r.ineligible);
    if (r.error) errorCount++;
  }
  return { lines: results, byType, totalAmount, totalEligible, totalIneligible, errorCount };
}
