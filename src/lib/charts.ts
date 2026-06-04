// =============================================================================
// Shared Recharts theme — every chart in the platform uses these constants so
// the visual language stays consistent (S-curve, sources & uses, contingency
// burn-down, etc.). Brand-aligned per design-tokens.ts.
// =============================================================================

import { BRAND, TONE } from "./design-tokens";

export const CHART_COLORS = {
  primary: BRAND.navy,
  secondary: BRAND.tan,
  primarySoft: "rgba(22, 69, 118, 0.15)",
  secondarySoft: "rgba(180, 174, 146, 0.30)",
  axis: BRAND.slate,
  axisMuted: BRAND.slateLight,
  grid: BRAND.border,
  tooltipBg: "#ffffff",
  tooltipBorder: BRAND.border,
  ok: TONE.ok,
  warn: TONE.warn,
  bad: TONE.bad,
} as const;

// Multi-series palette — starts with brand primary/secondary, then variations.
// Use for sources & uses, multi-format comparisons, per-section breakdowns.
export const SERIES_PALETTE = [
  BRAND.navy,
  BRAND.tan,
  BRAND.navyLight,
  BRAND.tanDark,
  BRAND.navyDark,
  BRAND.tanLight,
  TONE.ok,
  TONE.warn,
] as const;

// Inter for body / chart text; Oswald reserved for display headings outside
// charts (axis ticks stay Inter for legibility at small sizes).
export const CHART_FONT_FAMILY =
  "Inter, ui-sans-serif, system-ui, sans-serif";

// Spread these into Recharts axis components so every chart shares the look.
//   <XAxis tick={{ ...axisTick }} stroke={CHART_COLORS.axisMuted} />
export const axisTick = {
  fontSize: 11,
  fontFamily: CHART_FONT_FAMILY,
  fill: CHART_COLORS.axis,
};

// Spread into <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabel} />
export const tooltipStyle = {
  backgroundColor: CHART_COLORS.tooltipBg,
  border: `1px solid ${CHART_COLORS.tooltipBorder}`,
  borderRadius: 6,
  fontFamily: CHART_FONT_FAMILY,
  fontSize: 12,
  padding: "6px 8px",
};

export const tooltipLabel = {
  color: BRAND.navy,
  fontWeight: 600,
};

// Spread into <CartesianGrid stroke={CHART_COLORS.grid} ... />
export const gridStyle = {
  stroke: CHART_COLORS.grid,
  strokeDasharray: "3 3",
};
