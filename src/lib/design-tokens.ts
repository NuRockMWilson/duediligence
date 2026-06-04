// =============================================================================
// NuRock design tokens — single source of truth for brand hex + status tones.
// =============================================================================
// The Tailwind theme exposes these as CSS variables (see app/globals.css), but
// places that can't read CSS — Recharts series colors, chart tooltips, pdf-lib
// PDF rendering, inline SVGs — pull from this module instead so we don't drift.
// =============================================================================

export const BRAND = {
  navy: "#164576",
  navyDark: "#0F3557",
  navyLight: "#1E5A94",
  tan: "#B4AE92",
  tanLight: "#D9D3BA",
  tanDark: "#8F8A6F",
  black: "#101828",
  slate: "#475467",
  slateLight: "#667085",
  gray: "#F4F4F4",
  border: "#E4E7EC",
} as const;

// Status tone scale — apply uniformly to badges, banners, chart markers, and
// variance highlights. Locked so the platform reads consistently.
//   ok    — in-sync / funded / on-track
//   warn  — pending / variance / approaching deadline
//   bad   — overdue / over-budget / blocked
export const TONE = {
  ok: "#047857", // emerald-700
  okSoft: "#D1FAE5", // emerald-100
  warn: "#B45309", // amber-700
  warnSoft: "#FEF3C7", // amber-100
  bad: "#B91C1C", // red-700
  badSoft: "#FEE2E2", // red-100
  muted: BRAND.slateLight,
} as const;

export type ToneKey = keyof typeof TONE;

// Tiered variance coloring (per the backlog): amber < $50K, red >= $50K.
// Pass the absolute dollar delta (|actual - budget|).
export const VARIANCE_THRESHOLD = 50_000;
export function varianceTone(absDollarDelta: number): ToneKey {
  if (absDollarDelta < 1) return "muted";
  if (absDollarDelta < VARIANCE_THRESHOLD) return "warn";
  return "bad";
}

// Coverage / readiness % tone — used by the due-diligence readiness KPIs and
// any other completeness gauge. >=90 reads "done", 60–89 "in progress", <60
// "behind". Mirrors the locked ok/warn/bad scale above.
export function coverageTone(pct: number): ToneKey {
  if (pct >= 90) return "ok";
  if (pct >= 60) return "warn";
  return "bad";
}
