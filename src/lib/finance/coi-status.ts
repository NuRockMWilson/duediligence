// =============================================================================
// Certificate of Insurance (COI) status (Ship 4 r3)
// =============================================================================
// Vendors must carry current insurance (general liability, workers' comp,
// etc.) to be paid. dm_vendors stores coi_expires_at; this module classifies
// that date into a status the UI can badge + alert on.
//
// Pure + dependency-free (TZ-safe local date parse) so it's reusable across
// the active-draw vendor view, the invoice drawer, and the dashboard alerts.
// =============================================================================

export type CoiStatus = "missing" | "expired" | "expiring_soon" | "valid";

/** Default window (days) within which an upcoming expiry is "expiring soon". */
export const COI_SOON_DAYS = 30;

/** Parse `YYYY-MM-DD` as a LOCAL date (no UTC-midnight shift). Returns null
 *  on unparseable input. Mirrors lib/format.parseDateLocal — inlined here to
 *  keep this module dependency-free. */
function parseLocal(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Classify a vendor's COI based on its expiration date relative to a
 * reference "today".
 *
 *   missing       — no coi_expires_at on file
 *   expired       — expiry is strictly before today
 *   expiring_soon — expiry is today..today+soonDays (inclusive)
 *   valid         — expiry is more than soonDays out
 *
 * `todayIso` is passed in (not read from the clock) so the function stays
 * pure/testable; callers pass new Date().toISOString().slice(0,10).
 */
export function classifyCoi(
  expiresAtIso: string | null | undefined,
  todayIso: string,
  soonDays: number = COI_SOON_DAYS
): CoiStatus {
  const exp = parseLocal(expiresAtIso);
  if (!exp) return "missing";
  const today = parseLocal(todayIso);
  if (!today) return "valid"; // defensive — shouldn't happen

  // Strip time; compare whole days.
  const dayMs = 1000 * 60 * 60 * 24;
  const diffDays = Math.round((exp.getTime() - today.getTime()) / dayMs);

  if (diffDays < 0) return "expired";
  if (diffDays <= soonDays) return "expiring_soon";
  return "valid";
}

/** Days until expiry (negative if already expired); null when no date. */
export function daysUntilCoiExpiry(
  expiresAtIso: string | null | undefined,
  todayIso: string
): number | null {
  const exp = parseLocal(expiresAtIso);
  const today = parseLocal(todayIso);
  if (!exp || !today) return null;
  const dayMs = 1000 * 60 * 60 * 24;
  return Math.round((exp.getTime() - today.getTime()) / dayMs);
}

/** A status counts as a draw-blocking compliance issue (expired or missing).
 *  expiring_soon is a heads-up, not a block. */
export function isCoiActionable(status: CoiStatus): boolean {
  return status === "expired" || status === "missing";
}
