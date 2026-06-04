# NuRock Platform Shell Contract

> **Canonical spec.** This document defines the navy topbar contract that
> `nurock-underwriting` and `nurock-devmgmt` BOTH implement. The two apps live
> in separate repos and copy-paste their headers — but if you change one,
> change the other and update this file. The two app shells should be visually
> indistinguishable except for module-active state and the workspace KPI strip.
>
> Touchstone files:
> - `nurock-underwriting/components/Header.tsx`
> - `nurock-underwriting/components/ModuleSwitcher.tsx`
> - `nurock-devmgmt/src/components/deal-shell/header.tsx`
> - `nurock-devmgmt/src/components/deal-shell/module-switcher.tsx`

---

## 1. Brand strip (left cluster)

```
[Logo] NuRock                  | UNDERWRITING ▸ DEVELOPMENT ▸ COST CERT | ACTIVE PROJECT
       <Platform subtitle>     |                                        | <Deal Name> ▾
```

- **Logo:** 36 px tall (`h-9 w-auto`). Reversed (white-N silver-Q) variant on
  the navy background.
- **Brand wordmark:** `font-display text-sm uppercase tracking-[0.14em]` →
  renders `NUROCK`. Subtitle below: `text-[10px] text-white/60 tracking-wide`.
  - Underwriting subtitle: `Underwriting Platform`
  - Development subtitle: `Development Platform`
  - Cost Cert subtitle (future): `Cost Cert Platform`
- **Divider:** `border-l border-white/15`, ~12 px horizontal pad on either
  side (`pl-3 ml-3`).

## 2. Module switcher

Three module chips separated by chevrons. ALL CAPS via `font-display uppercase
tracking-wider`. Order is fixed: **Underwriting → Development → Cost Cert.**

Module states:

| State | Visual | Behavior |
|-------|--------|----------|
| **active** | Solid tan pill: `bg-nurock-tan text-nurock-navy-dark font-semibold` | `aria-current="page"`, cursor default, no action |
| **live** | Subtle dark pill: `bg-white/5 hover:bg-white/15 text-white/85 border-white/10` | `<a href={deepLink}>`, cross-app navigation |
| **live without deal** | Disabled: `text-white/40 cursor-not-allowed` | Tooltip: "Select a deal first" |
| **soon** | Disabled + `Soon` suffix in tan | Tooltip: "Module not yet available" |

Chevrons between modules: `ChevronRight w-3 h-3 text-white/20`.

### Deep-link rules

```
const DEVMGMT_BASE      = process.env.NEXT_PUBLIC_DEVMGMT_URL      ?? "https://nurock-devmgmt.vercel.app"
const UNDERWRITING_BASE = process.env.NEXT_PUBLIC_UNDERWRITING_URL ?? "https://nurockmodel.vercel.app"
```

> Note: the UW vercel project is named **NuRockModel** (not `nurock-underwriting`),
> so the auto-generated public alias is `nurockmodel.vercel.app`. Set the env
> var on each app's Vercel project to lock the cross-app links to a known
> domain — especially if you add a custom domain later.

Section preservation — when the user clicks a cross-app module, try to land on
the equivalent section of the destination app. Current map (extend as new
matched sections land):

| From | To | Justification |
|------|----|---------------|
| UW `tab=cost-cert` | devmgmt `/deals/{id}/cert-prep` | Same workflow, different stage |
| devmgmt `/deals/{id}/cert-prep` | UW `tab=cost-cert` | Same workflow, different stage |
| (anything else) | destination's `/deals/{id}/dashboard` (devmgmt) or `/?dealId={id}` (UW) | Safe default |

## 3. Deal switcher

A button that opens a dropdown of recent deals. Visual:

```
ACTIVE PROJECT
<Deal Name>   ⇅
```

- Wrapper: `bg-white/5 hover:bg-white/15 rounded-md px-2 py-1`
- Label: `text-[9px] uppercase tracking-wider text-white/50 font-display`
- Deal name: `text-[12.5px] font-semibold truncate max-w-[260px]`
- Icon: `ChevronsUpDown w-3.5 h-3.5 text-white/50`

The dropdown shows up to ~12 most-recently-updated deals plus a
"Browse all deals →" footer link. Clicking a row navigates to that deal at the
current section if it exists, else the deal's main page.

## 4. Workspace KPI strip (center, app-specific)

Each app fills this differently — that's intentional, the strip reflects what
matters in that workspace. But every chip uses the same shell:

```tsx
<div className="px-2.5 py-1 rounded-md border bg-<tone>/15 border-<tone>/30">
  <div className="text-[9px] uppercase tracking-wider font-display opacity-70">LABEL</div>
  <div className="text-[12px] font-mono font-semibold tabular-nums">VALUE</div>
</div>
```

Tone palette (LOCKED — match `lib/design-tokens.ts` `TONE`):

| Tone | Chip bg | Text | Meaning |
|------|---------|------|---------|
| `neutral` | `bg-white/5 border-white/10` | white | informational |
| `ok` / `emerald` | `bg-emerald-500/15 border-emerald-400/20 text-emerald-100` | emerald-100 | healthy / funded |
| `warn` / `amber` | `bg-amber-500/15 border-amber-400/20 text-amber-100` | amber-100 | watch / pending |
| `bad` / `rose` | `bg-rose-500/15 border-rose-400/30 text-rose-200` | rose-200 | breach / overdue |

## 5. Right cluster

```
[Save status]   [🔔 N]   [Avatar]
```

- **Save status:** ~`text-[11px] text-white/70` with a tone dot. Underwriting
  renders a live `<SaveStatusIndicator />`; devmgmt renders a static
  "Auto-saved" today (real save-status comes when we add cross-app sync).
- **Notifications bell:** the live `NotificationsBell` (server-rendered).
  Devmgmt has it today; UW gets it once Task 39 (realtime channel) lands.
  Bell is currently mounted in the `(app)/layout.tsx` as a floating
  `fixed top-3 right-4 z-50` element so it appears above EVERY page's header
  (deal page, settings, deals list). When the bell opens, the dropdown is
  `absolute top-11 right-0` from that fixed anchor.
- **Avatar:** `w-8 h-8 rounded-full bg-nurock-tan text-nurock-navy-dark` with
  the user's initials inside.

## 6. Height + sizing

Both apps converge on a **single-row header at min-height 56 px**. UW has
historically had a second 44 px sub-row for HUD/rates/tools — that row becomes
optional and can fold into a workspace strip below the topbar (NOT inside the
navy bar). The navy bar itself stays one row to match devmgmt's footprint.

Outer container: `max-w-[1600px] mx-auto px-5`. Sticky: `sticky top-0 z-50`
on devmgmt; UW the same once converged.

## 7. Acceptance test

A user logged into both apps, sitting side-by-side, should see:

1. ✅ Same logo, same wordmark glyphs, same spacing of brand strip
2. ✅ Same module pills in same order, same caps, same active pill style
3. ✅ Same deal switcher button form, same dropdown anchor
4. ✅ Same KPI chip aesthetic (even though chip *contents* differ)
5. ✅ Same right-cluster ordering: save status → bell → avatar
6. ✅ Same total header height
7. ✅ Clicking Development in UW → devmgmt loads the same deal (Cost Cert tab
   preserved if applicable)
8. ✅ Clicking Underwriting in devmgmt → UW loads the same deal (Cost Cert
   tab preserved if applicable)
