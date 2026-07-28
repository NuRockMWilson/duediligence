// ⚠️ AUTO-GENERATED — DO NOT EDIT IN THIS REPO.
// Canonical source: <workspace>/shared-ui/components/SidebarNav.tsx
// Sync with:   node shared-ui/scripts/sync-shared-ui.mjs
// Verified by: npm run check:shared-ui (compares against the .sha256 sidecar)
"use client";

// =============================================================================
// SidebarNav — the ONE left-hand navigation rail for every NuRock module
// -----------------------------------------------------------------------------
// CANONICAL SOURCE — <workspace>/shared-ui/components/SidebarNav.tsx, outside
// all three product repos so no app's sync depends on another app being checked
// out. Copied verbatim into each app by shared-ui/scripts/sync-shared-ui.mjs.
// Edit it HERE only: each copy ships a committed .sha256 sidecar, and every
// app's `npm run check:shared-ui` (wired into its build) fails on a hand-edit,
// including inside isolated Vercel builds.
//
// Design (Development module is the reference): a navy rail that reads as one
// nav shell with the navy header, Oswald/font-display uppercase links, and a
// GOLD left accent marking the active row.
//
// Behavior, all driven by the per-module `sections` config:
//   • Per-section collapse — independent (NOT an accordion; any number open),
//     persisted to localStorage per module, animated open/close, and fully
//     keyboard/AT accessible (real <button> + aria-expanded + aria-controls).
//     The section holding the ACTIVE item always force-opens, so a folded
//     section can never strand a user on a hidden page.
//   • Whole-rail collapse — an icon-only 56px rail for data-dense pages.
//     Tablets default to the rail; desktop defaults expanded; a manual toggle
//     wins either way. Phones hide the rail entirely (bottom nav takes over).
//   • Badges — a live numeric count pill (amber) or a static pill ("Soon", tan).
//
// Modules differ ONLY in config, never in markup:
//   Underwriting  defaultExpanded: true   (20 tabs; users navigate by tab NAME,
//                                          so every destination stays visible)
//   Development   defaultExpanded: false  (18 links read as folders)
//   Diligence     defaultExpanded: false
// =============================================================================

import * as React from "react";
import { ChevronDown } from "lucide-react";

// Types + pure logic live in the .ts sibling so tests can import them (these
// apps set jsx:"preserve", so a .tsx can't be transformed by vitest).
import {
  isSectionOpen,
  sidebarItemClasses,
  sidebarStorageKey,
  initialCollapsedSections,
  sidebarRailStorageKey,
  initialRailCollapsed,
  RAIL_AUTO_COLLAPSE_BELOW_PX,
  RAIL_EXPANDED_PX,
  RAIL_COLLAPSED_PX,
  HEADER_HEIGHT_VAR,
  headerHeightCss,
  type SidebarBadge,
  type SidebarItemDef,
  type SidebarSectionDef,
} from "./sidebar-nav-logic";

export {
  isSectionOpen,
  sidebarItemClasses,
  sidebarStorageKey,
  initialCollapsedSections,
  sidebarRailStorageKey,
  initialRailCollapsed,
  RAIL_AUTO_COLLAPSE_BELOW_PX,
  RAIL_EXPANDED_PX,
  RAIL_COLLAPSED_PX,
  HEADER_HEIGHT_VAR,
  headerHeightCss,
};
export type { SidebarBadge, SidebarItemDef, SidebarSectionDef };

/**
 * Publish the header's MEASURED height as --app-header-h on :root.
 *
 * Call this from the app's header component with a ref on its outermost
 * <header>. Everything that sticks below the header then derives its offset
 * from the variable instead of hardcoding a number that drifts (all three apps
 * had a wrong one — see HEADER_HEIGHT_VAR).
 *
 * ResizeObserver rather than a one-shot measure: the header's height changes
 * when rows wrap, when a row is hidden below `md`, and when fonts finish
 * loading. The value is deliberately NOT cleared on unmount — keeping the last
 * known height avoids a one-frame jump during route transitions.
 */
export function useHeaderHeightVar(
  ref: React.RefObject<HTMLElement | null>,
): void {
  React.useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const publish = () => {
      const h = el.getBoundingClientRect().height;
      if (h > 0) {
        document.documentElement.style.setProperty(
          HEADER_HEIGHT_VAR,
          `${h}px`,
        );
      }
    };
    publish();

    // TWO independent triggers, because neither alone is sufficient.
    //
    // 1. ResizeObserver — the precise one. `box: "border-box"` matches what
    //    publish() actually measures (getBoundingClientRect().height is the
    //    BORDER box); the default content-box would miss any change that moves
    //    the border box only — padding, a border, a row's vertical padding
    //    shifting at a breakpoint.
    //
    // 2. window resize — the SECOND trigger, not a workaround. The header's
    //    height changes almost exclusively because the identity row WRAPS at
    //    narrow widths (measured 45px -> 53px on a long deal name), and
    //    wrapping is a function of viewport width, so resize covers the
    //    real-world case directly and immediately.
    //
    //    NOTE for anyone testing this in an automated browser: RO delivers its
    //    notifications as part of the rendering steps, and a document with
    //    visibilityState === "hidden" does not run them. So in a headless or
    //    occluded pane no RO callback fires — not even the guaranteed initial
    //    one — while `resize` still does. That is spec-correct behavior for a
    //    hidden document, NOT an engine defect and NOT unreliability: RO fires
    //    normally for a real user with a visible tab. Do not add polling, a
    //    MutationObserver, or any further redundancy on the strength of an
    //    automated-pane observation.
    //
    // publish() is idempotent, so double-firing costs one property write.
    const ro =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(publish) : null;
    try {
      ro?.observe(el, { box: "border-box" });
    } catch {
      // Older engines reject the options bag — fall back to content-box rather
      // than losing observation entirely.
      ro?.observe(el);
    }
    window.addEventListener("resize", publish);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", publish);
    };
  }, [ref]);
}

/**
 * Rail collapse state, persisted per module.
 *
 * First visit only, the viewport seeds it: under 1500px the rail costs the wide
 * tables 2-3 columns, so it starts as the icon rail. Every visit after that the
 * saved choice wins, and there is deliberately NO resize listener — a rail that
 * re-collapses when you drag a window edge fights the person dragging it.
 *
 * SSR renders expanded and the effect corrects on mount, which keeps the server
 * and client markup identical (no hydration mismatch on a width-derived value).
 */
export function useRailCollapsed(
  storageNamespace: string,
): [boolean, (next: boolean) => void] {
  const key = sidebarRailStorageKey(storageNamespace);
  const [collapsed, setCollapsed] = React.useState(false);

  React.useEffect(() => {
    try {
      setCollapsed(
        initialRailCollapsed({
          stored: window.localStorage.getItem(key),
          viewportWidth: window.innerWidth,
        }),
      );
    } catch {
      /* private mode / storage disabled — the width-independent default stands */
    }
  }, [key]);

  // Only an explicit toggle persists. An auto-seeded default stays unsaved so a
  // laptop-then-monitor user isn't locked to whichever screen they opened first.
  const set = React.useCallback(
    (next: boolean) => {
      setCollapsed(next);
      try {
        window.localStorage.setItem(key, next ? "true" : "false");
      } catch {
        /* ignore */
      }
    },
    [key],
  );

  return [collapsed, set];
}

export interface SidebarNavProps {
  sections: SidebarSectionDef[];
  /** Id of the active item (href for route modules, tab key for state ones). */
  activeId: string;
  /** Namespaces the persisted collapse state, e.g. "nurock-underwriting". */
  storageNamespace: string;
  /** First-visit section state. Any saved preference overrides it. */
  defaultExpanded?: boolean;
  /** Route modules pass a Link-based renderer; state modules pass a <button>.
   *  Keeping navigation injectable is what lets one component serve both
   *  without importing next/link into a state-driven module. */
  renderItem: (
    item: SidebarItemDef,
    ctx: { active: boolean; collapsed: boolean; className: string; children: React.ReactNode }
  ) => React.ReactNode;
  /** Live counts keyed by item id — an amber pill; turns nav into a monitor. */
  counts?: Record<string, number>;
  /** Rendered above the sections (cross-app links, collapse toggle, etc.). */
  header?: (ctx: { collapsed: boolean }) => React.ReactNode;
  /** Controlled rail collapse. Omit to let the component manage it. */
  collapsed?: boolean;
  /** A pre-existing storage key whose saved value should be adopted when the
   *  current key has nothing yet. Development's rail persisted under
   *  ":sidebar-collapsed-groups" before this component existed; without this
   *  migration the rename would silently discard a user's folded/unfolded
   *  layout and snap them back to the code default. */
  legacyStorageKey?: string;
}

export function SidebarNav({
  sections,
  activeId,
  storageNamespace,
  defaultExpanded = false,
  renderItem,
  counts,
  header,
  collapsed = false,
  legacyStorageKey,
}: SidebarNavProps) {
  const storageKey = sidebarStorageKey(storageNamespace);

  // Collapsed-section ids. Seeded from defaultExpanded, then overridden by any
  // saved preference on mount (effect, not initializer, so SSR and the first
  // client render agree — reading localStorage during render hydration-mismatches).
  const [collapsedSections, setCollapsedSections] = React.useState<Set<string>>(
    () => initialCollapsedSections(sections, defaultExpanded)
  );
  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        setCollapsedSections(new Set(JSON.parse(raw) as string[]));
        return;
      }
      // Nothing under the current key — adopt (and re-persist under the new
      // key) a pre-existing preference so a key rename never resets a user's
      // layout. Note an EMPTY array is a meaningful saved value ("nothing
      // collapsed" = all expanded), which is why this checks for the raw
      // string rather than truthiness of the parsed array.
      if (legacyStorageKey) {
        const legacy = window.localStorage.getItem(legacyStorageKey);
        if (legacy) {
          const parsed = new Set(JSON.parse(legacy) as string[]);
          setCollapsedSections(parsed);
          window.localStorage.setItem(storageKey, JSON.stringify([...parsed]));
        }
      }
    } catch {
      /* malformed storage — keep the default */
    }
  }, [storageKey, legacyStorageKey]);

  const toggleSection = (id: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        window.localStorage.setItem(storageKey, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  return (
    <nav className="space-y-0.5">
      {header?.({ collapsed })}
      {sections.map((section, idx) => {
        const sectionActive = section.items.some((it) => it.id === activeId);
        const open = isSectionOpen({
          railCollapsed: collapsed,
          sectionHasActiveItem: sectionActive,
          collapsedSectionIds: collapsedSections,
          sectionId: section.id,
        });
        const groupId = `${storageNamespace}-sidebar-section-${section.id}`;
        const sectionCount = section.items.reduce(
          (s, it) => s + (counts?.[it.id] ?? 0),
          0
        );

        return (
          <div key={section.id}>
            {collapsed ? (
              // Icon rail: a divider preserves the grouping visually.
              idx > 0 && <div className="mx-2 my-1.5 border-t border-white/10" />
            ) : (
              <button
                type="button"
                onClick={() => toggleSection(section.id)}
                className={`flex w-full items-center gap-1.5 px-5 pb-2 text-left ${
                  idx === 0 ? "pt-1" : "pt-4"
                }`}
                aria-expanded={open}
                aria-controls={groupId}
                // A fold toggle, NOT a nav destination — spelled out so humans
                // and a11y audits don't read it as a tab that navigates to the
                // same view.
                title={`${open ? "Collapse" : "Expand"} ${section.label} section`}
                aria-label={`${open ? "Collapse" : "Expand"} ${section.label} section`}
              >
                <ChevronDown
                  className={`h-3 w-3 shrink-0 text-white/40 transition-transform ${
                    open ? "" : "-rotate-90"
                  }`}
                />
                <span className="font-display text-[10px] uppercase tracking-[0.12em] text-white/45">
                  {section.label}
                </span>
                {/* Folded section still surfaces actionable counts. */}
                {!open && sectionCount > 0 && (
                  <span className="ml-auto rounded-full bg-amber-500 px-1.5 py-0.5 text-[8px] font-semibold text-white">
                    {sectionCount}
                  </span>
                )}
              </button>
            )}

            {/* Animated open/close. grid-template-rows 0fr→1fr animates to the
                content's natural height (max-height would need a magic number),
                and `hidden` when closed keeps collapsed rows out of the tab
                order + AT tree. */}
            <div
              id={groupId}
              hidden={!open}
              className={`grid transition-[grid-template-rows] duration-200 ease-out ${
                open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
              }`}
            >
              <div className="overflow-hidden">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const active = item.id === activeId;
                  const liveCount = counts?.[item.id];
                  const className = sidebarItemClasses(active, collapsed);
                  const children = (
                    <>
                      {Icon && <Icon className="w-4 h-4 flex-shrink-0" />}
                      {!collapsed && (
                        <span className="truncate font-display text-[11px] uppercase tracking-wide">
                          {item.label}
                        </span>
                      )}
                      {/* Live count (amber) wins; else the static pill. */}
                      {!collapsed && liveCount ? (
                        <span className="ml-auto rounded-full bg-amber-500 px-1.5 py-0.5 text-[8px] font-semibold text-white">
                          {liveCount}
                        </span>
                      ) : (
                        !collapsed &&
                        item.badge && (
                          <span
                            className={`ml-auto text-[8px] px-1.5 py-0.5 rounded-full font-semibold ${
                              item.badge.tone === "tan"
                                ? "bg-nurock-tan text-nurock-navy-dark"
                                : "bg-white/20 text-white"
                            }`}
                          >
                            {item.badge.label}
                          </span>
                        )
                      )}
                      {/* Icon rail: a dot stands in for the hidden pill. */}
                      {collapsed && (liveCount || item.badge) && (
                        <span
                          className={`absolute top-1.5 right-2 h-1.5 w-1.5 rounded-full ${
                            liveCount ? "bg-amber-500" : "bg-nurock-tan"
                          }`}
                        />
                      )}
                    </>
                  );

                  if (item.disabled) {
                    return (
                      <div
                        key={item.id}
                        className={`${className} opacity-40 cursor-not-allowed`}
                        title={collapsed ? item.label : undefined}
                        aria-disabled
                      >
                        {children}
                      </div>
                    );
                  }
                  return (
                    <React.Fragment key={item.id}>
                      {renderItem(item, { active, collapsed, className, children })}
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}
    </nav>
  );
}

/** Shared <aside> shell — the navy rail itself. Kept separate from SidebarNav
 *  so a module can compose its own header/footer chrome inside the same shell. */
export function SidebarShell({
  collapsed,
  // 89, not 88: the real measured header is 88.67px in Development and
  // Diligence and 89px in Underwriting post-Shell-A. This is the SSR /
  // first-paint fallback only — every surface publishes --app-header-h, so
  // it is dead code unless the hook fails to mount. One value in all three
  // rails so the eventual swap to a shared constant is a find/replace.
  // On a wrapping deal at 1054 the real height is 97, so a fallback that
  // ever fires is 8px short there — accepted; no branching for a dead path.
  headerOffsetPx = 89,
  className = "",
  children,
}: {
  collapsed: boolean;
  headerOffsetPx?: number;
  /** Extra classes on the <aside> — e.g. "no-print" where the module has a
   *  branded print deliverable that must not include the nav rail. */
  className?: string;
  children: React.ReactNode;
}) {
  return (
    // Two layers on purpose:
    //   • <aside> paints the navy and STRETCHES with the flex row (min-height of
    //     one viewport as a floor), so the rail runs to the bottom edge on long
    //     list views and on short pages alike.
    //   • the inner wrapper is the sticky, independently-scrolling viewport:
    //     sticky top-<offset> + max-height 100vh-<offset> + overflow-y-auto.
    //     Underwriting has 20 items + 3 headers (~800px expanded), which is
    //     taller than a 900px window minus a 122px header — without the inner
    //     max-height the tail of the rail would be unreachable. Scrolling lives
    //     here rather than on the <aside> so the painted navy isn't clipped to
    //     the scroll viewport's height.
    // The rail width is an INLINE STYLE, not a w-[220px]/w-[56px] utility pair.
    // Two reasons, both learned the hard way:
    //   1. Measured: with the utility classes the collapsed rail still laid out
    //      at 220px in Underwriting's deal view. Same class on a plain <div>
    //      computed 56px, min-width:0 didn't change it, and an explicit
    //      flex-basis did — i.e. the utility was not winning on this element, so
    //      the collapse toggle silently reclaimed nothing.
    //   2. This file is GENERATED into three repos. An arbitrary-value class
    //      only exists if each app's tailwind.config `content` globs happen to
    //      scan the generated path; a width that renders correctly must not
    //      depend on per-repo build config. flexBasis is set alongside width so
    //      the flex main-size algorithm can't fall back to a content measure.
    <aside
      className={`hidden md:block shrink-0 bg-nurock-navy border-r border-white/10 transition-[width] duration-200 ${className}`}
      style={{
        width: collapsed ? RAIL_COLLAPSED_PX : RAIL_EXPANDED_PX,
        flexBasis: collapsed ? RAIL_COLLAPSED_PX : RAIL_EXPANDED_PX,
        minHeight: `calc(100vh - ${headerHeightCss(headerOffsetPx)})`,
      }}
    >
      <div
        className="sticky self-start overflow-y-auto overflow-x-hidden py-4"
        style={{
          // Derived from the header's measured height, never a typed number.
          top: headerHeightCss(headerOffsetPx),
          maxHeight: `calc(100vh - ${headerHeightCss(headerOffsetPx)})`,
        }}
      >
        {children}
      </div>
    </aside>
  );
}
