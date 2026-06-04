// =====================================================================
// NuRock universal number formatters
// =====================================================================
// Convention (per NuRock memory):
//   - Currency / quantities → comma separators (XXX,XXX,XXX)
//   - Percentages           → always 2 decimals (X.00%)
//   - Dates                 → M/D/YYYY (no leading zeros, 4-digit year)
// =====================================================================

const NULLISH = "—";

export function formatCurrency(
  value: number | string | null | undefined,
  decimals = 0
): string {
  if (value == null || value === "") return NULLISH;
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return NULLISH;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

/**
 * Terse currency for tight UI slots (HUD chips, badge values). Mirrors UW's
 * fmtCurrencyTerse so the navy bar's KPI strip renders at the same widths
 * across apps. $1,234,567 → "$1.2m", $987,654 → "$988k", $42 → "$42".
 */
export function formatCurrencyTerse(
  value: number | string | null | undefined
): string {
  if (value == null || value === "") return NULLISH;
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return NULLISH;
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}m`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

export function formatNumber(
  value: number | string | null | undefined,
  decimals = 0
): string {
  if (value == null || value === "") return NULLISH;
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return NULLISH;
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

/**
 * Always 2 decimals per NuRock convention.
 * Pass a fraction (0.0758 → "7.58%"), not a pre-multiplied percentage.
 */
export function formatPercent(
  value: number | string | null | undefined
): string {
  if (value == null || value === "") return NULLISH;
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return NULLISH;
  return `${(n * 100).toFixed(2)}%`;
}

/**
 * Default format: M/D/YYYY (no leading zeros, 4-digit year).
 * Pass options to override.
 */
export function formatDate(
  value: string | Date | null | undefined,
  options?: Intl.DateTimeFormatOptions
): string {
  if (!value) return NULLISH;
  // Date-only ISO strings like "2026-05-06" should not be timezone-shifted.
  // Construct as a local date when given a YYYY-MM-DD string.
  let d: Date;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, day] = value.split("-").map(Number);
    d = new Date(y, m - 1, day);
  } else {
    d = typeof value === "string" ? new Date(value) : value;
  }
  if (Number.isNaN(d.getTime())) return NULLISH;
  return d.toLocaleDateString(
    "en-US",
    options ?? { month: "numeric", day: "numeric", year: "numeric" }
  );
}

export function formatDateLong(
  value: string | Date | null | undefined
): string {
  return formatDate(value, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * "Month Year" rendering (e.g., "July 2026"). Used on Project Schedule
 * milestones, Gantt axis labels, and any other place a date-only LIHTC
 * milestone should read with a spelled-out month rather than ISO digits.
 * TZ-safe via formatDate's local-component parser.
 */
export function formatMonthYear(
  value: string | Date | null | undefined
): string {
  return formatDate(value, { month: "long", year: "numeric" });
}

/**
 * Short month + year (e.g., "Jul 2026"). Used on draw-column headers and
 * tight spaces where the full month name would wrap.
 */
export function formatMonthYearShort(
  value: string | Date | null | undefined
): string {
  return formatDate(value, { month: "short", year: "numeric" });
}

/**
 * Parse a YYYY-MM-DD ISO date as a LOCAL Date (no UTC midnight shift).
 * Falls through to `new Date(value)` for full timestamps. Use this anywhere
 * you'd otherwise do `new Date(isoString)` on a date-only string and then
 * read `.getMonth()` / `.getDate()` / etc. Returns null on unparseable input.
 *
 * The whole rationale: `new Date("2026-07-01")` is UTC midnight, which in
 * US time zones (UTC-4 / UTC-5) rolls back to June 30 8pm — so the month
 * and day read as the previous calendar day. This helper preserves them.
 */
export function parseDateLocal(
  value: string | Date | null | undefined
): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== "string") return null;
  // Date-only: YYYY-MM-DD → construct in local TZ
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const dt = new Date(y, mo - 1, d);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  // Anything else (full ISO with time/TZ) — trust Date to parse
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? null : dt;
}
