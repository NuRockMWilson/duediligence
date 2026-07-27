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
