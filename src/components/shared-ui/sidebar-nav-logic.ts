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
