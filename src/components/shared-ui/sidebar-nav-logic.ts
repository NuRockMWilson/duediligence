// ⚠️ AUTO-GENERATED — DO NOT EDIT IN THIS REPO.
// Canonical source: <workspace>/shared-ui/components/sidebar-nav-logic.ts
// Sync with:   node shared-ui/scripts/sync-shared-ui.mjs
// Verified by: npm run check:shared-ui (compares against the .sha256 sidecar)
// =============================================================================
// SidebarNav — types + pure logic (NO JSX)
// -----------------------------------------------------------------------------
// CANONICAL SOURCE — <workspace>/shared-ui/components/sidebar-nav-logic.ts.
// Synced into each app by shared-ui/scripts/sync-shared-ui.mjs; never edit a
// generated copy (each ships a committed .sha256 and every app's build runs
// check:shared-ui).
//
// Deliberately a .ts file, separate from SidebarNav.tsx: all three apps set
// `jsx: "preserve"` (Next.js), so vitest/esbuild cannot transform a .tsx in a
// test — importing the component into a test fails at parse time. Keeping the
// decision logic here makes it directly unit-testable, which is how the
// "a deep link never lands on a hidden tab" guarantee is covered by a test
// rather than a manual click.
// =============================================================================

export type SidebarBadge = { label: string; tone: "navy" | "tan" };

export interface SidebarItemDef {
  /** Stable id. For route-driven modules this is the href; for state-driven
   *  modules (Underwriting's tabs) it's the tab key. */
  id: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  badge?: SidebarBadge;
  /** Extra hover text appended to the row's tooltip — e.g. Underwriting's
   *  per-tab checklist status ("Complete" / "Draft" / "Empty"), which the old
   *  horizontal tab strip surfaced the same way. */
  title?: string;
  /** Rendered as a dimmed, non-interactive row (e.g. a future module). */
  disabled?: boolean;
}

export interface SidebarSectionDef {
  /** Stable id used for the aria-controls pairing + the persisted collapse
   *  state. Keep it stable across renames or saved preferences reset. */
  id: string;
  label: string;
  items: SidebarItemDef[];
}

/**
 * Is a section's item list shown?
 *
 * Order of precedence:
 *   1. The icon rail has no section labels, so everything shows.
 *   2. The section holding the ACTIVE item always opens — this is what makes a
 *      deep link into a section the user previously collapsed still land
 *      visibly, instead of stranding them on a hidden page.
 *   3. Otherwise the user's persisted choice wins.
 */
export function isSectionOpen({
  railCollapsed,
  sectionHasActiveItem,
  collapsedSectionIds,
  sectionId,
}: {
  railCollapsed: boolean;
  sectionHasActiveItem: boolean;
  collapsedSectionIds: ReadonlySet<string>;
  sectionId: string;
}): boolean {
  if (railCollapsed) return true;
  if (sectionHasActiveItem) return true;
  return !collapsedSectionIds.has(sectionId);
}

/** Shared row classes so an active row is pixel-identical in all three apps. */
export function sidebarItemClasses(active: boolean, collapsed: boolean): string {
  const base = `flex items-center transition relative ${
    collapsed ? "justify-center py-2" : "gap-2.5 px-5 py-2"
  }`;
  if (!active) return `${base} text-white/65 hover:bg-white/10 hover:text-white`;
  // Gold left accent = the active marker. The negative margin + compensating
  // padding keep the 2px rail from nudging the label.
  return collapsed
    ? `${base} bg-white/10 text-white border-l-2 border-nurock-gold`
    : `${base} bg-white/10 text-white font-semibold border-l-2 border-nurock-gold -ml-[2px] pl-[18px]`;
}

/** localStorage key holding the collapsed-section ids for a module. */
export function sidebarStorageKey(namespace: string): string {
  return `${namespace}:sidebar-collapsed-sections`;
}

/** Seed state for a first visit, before any saved preference is read. */
export function initialCollapsedSections(
  sections: ReadonlyArray<{ id: string }>,
  defaultExpanded: boolean,
): Set<string> {
  return defaultExpanded ? new Set<string>() : new Set(sections.map((s) => s.id));
}

// ---------------------------------------------------------------------------
// Header height — published by the header, consumed by anything that sticks
// below it. NO module should name a pixel offset.
// ---------------------------------------------------------------------------

/**
 * CSS custom property carrying the app header's MEASURED height, set on
 * :root by the header component itself (see useHeaderHeightVar).
 *
 * Why a measured variable rather than a constant: the three apps hardcoded
 * their own offsets and both were wrong, in opposite directions. Underwriting
 * used `top: 122px` against a 121.33px header, leaving a hairline of page
 * showing through above the rail; Development and Diligence used `top: 88px`
 * against an 88.67px header, so the rail tucked 0.67px UNDER it. Sub-pixel
 * header heights are unavoidable once rows are sized by content
 * (33.33 + 44 + 44 = 121.33), so the offset has to be measured, not typed.
 */
export const HEADER_HEIGHT_VAR = "--app-header-h";

/**
 * `var(--app-header-h, <fallback>px)` — the fallback covers SSR and the first
 * paint before the ResizeObserver runs, so the rail is never wildly misplaced.
 */
export function headerHeightCss(fallbackPx: number): string {
  return `var(${HEADER_HEIGHT_VAR}, ${fallbackPx}px)`;
}

// ---------------------------------------------------------------------------
// Rail width (expanded 220px vs icon-only 56px)
// ---------------------------------------------------------------------------

/**
 * Viewport width below which the rail starts COLLAPSED on a first visit.
 *
 * Measured on the Underwriting Pro Forma (404px of sticky label columns + 100px
 * year columns): the expanded rail costs 3 year columns at 1280px and 2 at
 * 1440px, but nothing at 1900px+ where the tables have room to spare. 1500px is
 * the line where the rail stops being an eviction.
 */
export const RAIL_AUTO_COLLAPSE_BELOW_PX = 1500;

/** Rail widths in px. Applied as inline styles, not Tailwind arbitrary values —
 *  see the comment in SidebarShell for why (a generated file must not depend on
 *  each consumer's tailwind `content` globs to lay out correctly). */
export const RAIL_EXPANDED_PX = 220;
export const RAIL_COLLAPSED_PX = 56;

/** localStorage key holding the rail's expanded/collapsed choice for a module. */
export function sidebarRailStorageKey(namespace: string): string {
  return `${namespace}:sidebar-rail-collapsed`;
}

/**
 * Rail state for a mount.
 *
 * A stored value ALWAYS wins — that is the whole point of persisting it, and it
 * is why this reads the raw string rather than coercing: `"false"` is a user who
 * deliberately expanded a narrow window and must not be re-collapsed.
 *
 * Width only seeds a FIRST visit. Deliberately not wired to a resize listener:
 * re-collapsing mid-session because a window crossed the threshold fights the
 * person driving the window. (`useBreakpoint`-driven state did exactly that.)
 */
export function initialRailCollapsed({
  stored,
  viewportWidth,
  breakpointPx = RAIL_AUTO_COLLAPSE_BELOW_PX,
}: {
  stored: string | null;
  viewportWidth: number;
  breakpointPx?: number;
}): boolean {
  if (stored === "true") return true;
  if (stored === "false") return false;
  // No saved choice: narrow viewports start as the icon rail. viewportWidth is
  // 0 during SSR, which must not read as "very narrow".
  return viewportWidth > 0 && viewportWidth < breakpointPx;
}
