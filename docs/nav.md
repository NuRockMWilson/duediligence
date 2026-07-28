# Deal navigation (sidebar)

The deal shell's left rail is the **shared** navy sidebar used by all three NuRock
modules. This module's rail was white (`bg-white` / `border-nurock-border` / slate
links) until July 2026; it now matches Development and Underwriting exactly.

**To add, remove, or reorder a nav item, edit the config — never the sidebar markup.**

| Thing | Where |
| --- | --- |
| Nav config | `src/lib/nav.ts` (`buildNav()` → `NavGroup[]`) |
| This module's adoption | `src/components/deal-shell/sidebar.tsx` |
| Shared component (generated — do not edit) | `src/components/shared-ui/SidebarNav.tsx` + `sidebar-nav-logic.ts` (+ `.sha256`) |
| Canonical source + full docs | `<workspace>/shared-ui/components/` · `<workspace>/shared-ui/README.md` |

`buildNav()` returns groups of `{ href, label, icon, badge? }`; the sidebar maps
each group to a collapsible section (group label = section id) and each item's
`href` becomes its id, so active state and any live counts keep working. Add a
group to `buildNav()` and it renders as a new section.

## Module-specific notes

- Sections **default to folded** (matching Development); the section containing
  the active route always force-opens, and a user's saved collapse state wins
  after their first toggle.
- Header offset is the shared 88px default.
- Diligence currently has a single nav item, so the rail is intentionally sparse —
  adding sections later is a config change only.
- **Deal view is full-bleed**, matching the other two modules: the shell row and
  both header rows carry no width cap, so the rail starts at x=0 everywhere and
  switching modules on one deal no longer shifts it. List views stay capped at
  1600px. (This replaced `flex max-w-[1600px] mx-auto`, which aligned the rail with
  the logo at x=472 but cost content width.)
- Header offset comes from `--app-header-h`, published by the header itself. No
  module names a pixel offset.
- The rail carries `no-print`, honored by a deliberately minimal
  `@media print { .no-print { display:none } }` in `globals.css`. Underwriting's
  full chrome-hiding print block is NOT ported here - no branded print deliverable.
  CFO decision, 2026-07-27.
- The rail starts as the 56px icon rail on a first visit under 1400px and
  expanded at 1400px+; a saved choice wins afterwards, and it never re-collapses
  on resize.
