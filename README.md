# Round 7.4 — Total Sources: column alignment, payoff rows, equity phase split

Restructures the Sources section to align with the Uses table column-for-column and to decompose sources into the rows needed for total reconciliation to TDC.

Iterates on Round 7.3. Replaces the Round 7.3 SourcesSection component entirely — no migration of existing data needed since this is purely display logic.

## Three structural changes

### 1. Columns now mirror the Uses table

| Source | Original | Adjustments | Revised | Active Draft | Drawn to Date | Remaining | % Drawn |
|---|---|---|---|---|---|---|---|

Same column widths and headers as the Uses table above. The two tables visually align column-for-column. Adjustments column is always $0 today (commitment amendments aren't tracked yet) — placeholder for future commitment-side change tracking.

### 2. Row generation by source kind

For each `dm_funding_sources` row, the aggregation emits one or more display rows:

| Source kind | Display rows |
|---|---|
| `construction_loan`, `bridge_loan` | Source row + **payoff row** (negative, at conversion) |
| `construction_to_perm` | Single row (instrument stays through both phases) |
| `permanent_loan` | Single row (comes in at conversion) |
| `lihtc_equity`, `state_credits` | **Two rows**: "During Construction" + "Post Construction" |
| All other kinds (`soft_loan`, `grant`, `deferred_dev_fee`, `reserves`, `other`) | Single row |

Payoff rows are styled differently (italic, red-tinted background) to make their offsetting nature visible. Equity split rows use a subtle emerald-tinted background.

### 3. Total Sources reconciliation to Total Uses

The bottom row sums every display row. The math:
- Construction loan + its payoff = $0 net (loan retired at conversion)
- Construction-to-perm = single positive contribution
- Permanent loan = single positive contribution at conversion
- Equity during + Equity post = total equity commitment
- **Total Sources should equal Total Uses Revised (TDC)**

Reconciliation banner at the top of the section appears in three flavors:

- **Red** — TDC gap: Total Sources Revised ≠ Total Uses Revised. Indicates a missing payoff line, missing equity-post row, or duplicated source. Shows the exact gap amount.
- **Amber** — Equity split estimated: at least one equity row used the default 25%/75% split because `metadata.equity_during_construction` wasn't populated by the LIHTC model. Directs the user to update the model.
- **Amber** — Allocation gap: `sum(allocations) ≠ sum(draw_lines.net_amount)` for a draw status (carryover from Round 7.3).

## Equity phase split

Read from `dm_funding_sources.metadata.equity_during_construction` and `metadata.equity_post_construction` on the equity row. Fallback when missing:

- 25% during construction / 75% post construction (typical syndicator pay-in)
- Banner appears telling the user the split is estimated and how to populate it

The LIHTC model's promotion path needs to write the actual split into metadata — spec is in `LIHTC-MODEL-equity-phase-split-spec.md` (separate deliverable). The model already shows the split in its portfolio SOURCES table, so the values exist; the promotion path just needs to forward them.

## Files

```
src/lib/db/sources-aggregation.ts                                                    (rewritten — display row generation + phase split + payoffs)
src/components/sources-section.tsx                                                   (rewritten — Uses-aligned columns + reconciliation banners)
src/app/(app)/deals/[dealId]/schedule/page.tsx                                       (unchanged from R7.3 — already passes sourcesAgg)
src/app/(app)/deals/[dealId]/schedule/_components/standard-flat-view.tsx             (sources prop changed to SourcesAggregation; passes usesRevisedTotal)
src/app/(app)/deals/[dealId]/budget/page.tsx                                         (unchanged from R7.3)
src/app/(app)/deals/[dealId]/budget/_components/standard-budget-flat-view.tsx        (sources prop changed to SourcesAggregation; passes usesRevisedTotal)
```

No schema change. No migration.

## Deploy

```
1. Extract this zip into nurock-devmgmt
2. npx tsc --noEmit
3. git add -A && git commit -m "..." && git push
4. Apply the LIHTC-MODEL-equity-phase-split-spec.md changes in nurock-underwriting
5. Re-promote any deal to populate the equity split metadata
```

```
git add -A && git commit -m "Round 7.4: restructure Total Sources to align with Uses columns, add payoff and equity-phase-split rows. Three structural changes: (1) Sources section columns now mirror the Uses table on each page (Source, Original, Adjustments, Revised, Active Draft, Drawn to Date, Remaining, % Drawn) with matching column widths so the two tables align visually. (2) Row generation in fetchSourcesAggregation now emits multiple display rows per dm_funding_sources row depending on kind: construction_loan / bridge_loan emit source row plus a payoff row (negative, at conversion) to represent the loan being retired by permanent sources; construction_to_perm emits one row (instrument carries through both phases); permanent_loan emits one row; lihtc_equity / state_credits emit two rows (During Construction + Post Construction) using metadata.equity_during_construction and metadata.equity_post_construction when present, falling back to a default 25%/75% split with a banner when absent. (3) Section header includes a TDC reconciliation indicator: red banner when Total Sources Revised diverges from usesRevisedTotal (Total Uses Revised), amber banner when at least one equity row used the default split, plus the existing Round 7.3 allocation reconciliation banner. Total row now intentionally equals TDC after payoff/equity decomposition. Replaces Round 7.3's simpler SourcesSection component entirely; no data migration needed since this is display-only. Pairs with LIHTC-MODEL-equity-phase-split-spec.md which describes the promotion-side fix to populate the equity split metadata from the model's pay-in schedule." && git push
```

## Verification

Open `/deals/[dealId]/schedule` for Westview Landing. The Sources section should:

- Display below the Uses table with column widths matching exactly
- Show source rows + a payoff row for the Construction Loan ($41.3M / -$41.3M)
- Show NO payoff row for the Surtax Loan (kind = construction_to_perm)
- Show First Mortgage as a single row
- Show LIHTC Federal Equity as TWO rows (During Construction + Post Construction) with an "est" badge on each and the amber banner directing to the model fix
- Total at the bottom should equal Total Uses Revised. If it doesn't, the red reconciliation banner shows the gap.

After applying the LIHTC model spec and re-promoting:
- "est" badges disappear
- Equity split matches the model's portfolio SOURCES table to the dollar

Same on the Budget page.
