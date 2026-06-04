# NuRock Platform — Implementation Roadmap

**Scope:** three-app suite on one shared Supabase + one `deal_id` spine —
`nurock-underwriting` (the model), `nurock-devmgmt` (this app), and a future
`nurock-diligence` (due-diligence platform). This roadmap sequences every
proposed feature plus the underwriting-integration and DD-platform work.

## Guiding principles
1. **Force-multipliers first.** Build the shared foundations (notifications,
   charts, branded print, design tokens) before feature phases so everything
   after ships looking finished instead of being retrofitted.
2. **Build app-agnostic shared services.** Documents/storage-sync, the
   template-mapping engine, and assignment/coverage/sign-off primitives are
   built once in dev-mgmt and reused by the DD platform — that turns DD from
   green-field into composition.
3. **Design woven throughout**, not a phase: locked status tones, number rules
   (`XXX,XXX,XXX`, `X.00%`), brand (navy `#164576`, tan `#B4AE92`, Oswald
   headings / Inter body, NR monogram), skeletons, actionable empty states, a
   print-clean variant for every external screen.
4. **The realign function stays sensitive.** Read live source before patching;
   prefer read-time computation over realign changes where feasible.

---

## Shared services (built progressively, reused by all three apps)
| Service | Introduced in | Reused by |
|---|---|---|
| **Notifications** (`dm_notifications`, provider, in-app feed) — cross-app | Phase 1 | every phase, UW drift alerts, DD |
| **Chart/brand theme** (lib + tokens + formatters) | Phase 1 | dashboard, reports |
| **Branded print/PDF** (letterhead, page #s, signature blocks) | Phase 1 | draw package, G702/G703, cost cert, DD packets |
| **Cross-app shell** (deal switcher, deep-links, shared deal header) | Phase 1 | model, dev-mgmt, DD |
| **Documents + cloud-storage sync** (SharePoint first) | Phase 3 | invoices, lien waivers, draw package, **DD line files** |
| **Template-mapping engine** (standard ↔ format/template, detail/total/group, members, splits) | already built (report builder) → generalize | reports, **DD checklist templates** |
| **Assignment / coverage / sign-off** (items → assignees → status → completeness %) | Phase 3 (generalize Phase 9 + lien-waiver coverage) | draws, lien waivers, **DD checklists** |

---

## Phase 1 — Foundations & force-multipliers  ← **start here tomorrow**
**Goal:** the shared layer everything else builds on.
- **Notification infrastructure** — `dm_notifications` (deal-scoped, cross-app),
  email provider (Resend), in-app feed + read state. First triggers: PM→CFO
  handoff, lender approval. Unblocks the whole "live" backlog (Nudge, COI
  expiring, missing-waiver, relative timestamps).
- **Chart + brand-chart theme** — choose lib once; theme to brand + number rules.
- **Branded print/PDF foundation** — shared letterhead layout (NR monogram,
  navy+tan, Oswald/Inter, page numbers, signature blocks).
- **Design tokens** — locked status-tone scale (emerald=in-sync/funded,
  amber=pending/variance, rose=overdue/over-budget) + tiered variance coloring +
  shared currency/percent formatters.
- **Cross-app navigation (foundational slice)** — per-deal deep-links both
  directions ("Open in Underwriting" / "Open in Development") landing on the
  same deal; a global **deal switcher**; shared deal-header identity.
- **UW↔GL mapping consolidation** — collapse `cost_account_map.model_line_id`
  vs `dm_underwriting_line_gl` to one source of truth (integrity cleanup that
  de-risks promote + cost-cert).

**Decisions (locked):** email = **Resend**; charts = **Recharts**; storage =
**SharePoint/OneDrive** first (abstraction leaves room for Box/Drive/Dropbox).
**Done when:** a test notification emails + shows in-app; a sample PDF renders
on-brand; deep-links jump between apps on the same deal.

## Phase 2 — Deal dashboard & KPIs
**Goal:** the first screen anyone sees looks premium. Depends on Phase 1 charts.
- **KPI strip:** % Complete (cost-to-date ÷ TDC), Drawn, Variance, Schedule,
  Contingency Remaining, Retainage Held, Equity Drawn vs. Pace, Days-to-PIS,
  Sources Committed %.
- **Charts:** S-curve (planned vs. actual cumulative draw), Sources & Uses
  waterfall (gap highlighted), contingency burn-down, **finish the Gantt**
  (TODAY marker + per-row progress).
- **Alerts / recent-activity feed** (powered by Phase 1 notifications).

## Phase 3 — The fundable draw package (lender-facing)
**Goal:** a draw package a lender accepts end-to-end. Introduces the
**documents + assignment/coverage** shared services.
- **Lien-waiver workflow** — conditional/unconditional × partial/final, per
  vendor/draw, with **coverage-% gating** on export.
- **AIA G702/G703 generator** — *deferred until the format is uploaded*; renders
  through Phase 1 print foundation.
- **Stored materials + retainage-release** tracking inside the draw.
- **Branded draw-package PDF** (cover → G702/G703 → schedule → waivers).

## Phase 4 — CFO financial layer
**Goal:** controls, cash, and variance.
- **Funding-source waterfall** auto-allocation on draws + source-exhaustion /
  covenant (LTC, completion-deadline) flags.
- **Forward draw/cash forecast** (when/how much/from which source).
- **Equity installment tracker** (milestone-gated LP contributions) +
  **interest-reserve burn-down** + **deferred-developer-fee** tracking.
- **Variance with reason codes** + GL drill-down.
- **Immutable, exportable audit trail** (extends Phase 9 status history).

## Phase 5 — LIHTC compliance & cost-cert completion
- **Compliance tests:** 50% aggregate-basis (bond deals), 10% carryover,
  **PIS / 8609 prep per BIN** — countdowns + ratios with deadlines.
- **Finish cost cert:** full actual-cost FHFC schedule (all lines), FHFC
  workbook export, interim-cost amortization (Ship 2d), compliance-period start.

## Phase 6 — Integrations & field (parallelizable as dependencies clear)
- **Documents + cloud-storage sync layer** generalized — **SharePoint first**,
  abstraction for Box/Drive/Dropbox (shared service for dev-mgmt + DD).
- **Sage Intacct bidirectional sync** (needs Sage dev license + env vars).
- **Invoice OCR slide-over**; **mobile/field capture** (photos, delivery
  tickets, stored materials).
- **Report-format Excel import** (needs sample `.xlsx`).
- **Schema-lint / CI guardrails** codifying the RLS / generated-column /
  format-pinned-read lessons.

## Phase 7 — Underwriting integration (deepening)
**Goal:** close the projection→actuals→as-built loop. (Foundational slices —
deep-linking, cross-app notifications, mapping consolidation — already shipped
in Phase 1.)
- **As-built / actual-vs-UW overlay** written back into the model (cost-cert
  actuals, draw progress, final sources) — keeps UW live for refi/disposition.
- **Sync/promote center** — drift since last promote, **field-level provenance**
  (UW `source_line_id` + manual-override flags), **per-line accept/reject**
  instead of all-or-nothing.
- **Lock-state semantics** — post-lock, dev-mgmt is authoritative for actuals;
  make that explicit in both apps.

## Phase 8 — Due-diligence platform (`nurock-diligence`, after model + dev-mgmt)
**Goal:** built largely by composing the shared services above.
- **Standard DD checklist** (canonical) ↔ **investor/lender templates** via the
  **template-mapping engine** (same pattern as report formats).
- **Files assigned to checklist lines**, auto-updating on upload via the
  **documents + SharePoint sync** service; line-level **coverage %** via the
  assignment/coverage primitive.
- **Assignment + sign-off** via the shared workflow primitive.
- **DD readiness %** per lender/investor surfaces as a dashboard KPI and gates
  closing milestones (shared with the equity-installment tracker).

---

## External inputs (queued to the phase that needs them)
| Input | Needed for | Phase |
|---|---|---|
| AIA G702/G703 format | generator | 3 |
| Preferred lender draw-package template (optional) | package layout | 3 |
| Sample report-format `.xlsx` | Excel import | 6 |
| Sage dev license + env vars | Sage sync | 6 |
| SharePoint app registration / creds | storage sync | 3/6 |

## Working conventions (carry forward)
- Migrations + verify ship as separate `.sql` files; not in zips.
- Full-file edits in place; deploy via `git push` (Vercel auto-deploys).
- Regenerate Supabase types after every migration; remove transient casts.
- `tsc --noEmit` clean before every push.
- One repo per change; underwriting changes commit to that repo separately.

## Tomorrow's starting point (Phase 1, ordered)
1. `dm_notifications` migration (deal-scoped, cross-app) + PUBLIC RLS.
2. Email provider wiring (Resend) + a `sendNotification` server action + in-app
   feed component; first triggers on PM→CFO + lender approval.
3. Chart lib + brand theme tokens + shared currency/percent formatters.
4. Branded PDF/letterhead component (NR monogram, navy/tan, Oswald/Inter).
5. Cross-app deal deep-links + deal switcher; shared deal-header.
6. UW↔GL mapping consolidation (one source of truth).
