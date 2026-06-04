# Interim Cost Eligibility — Methodology Reference

> Source: Foxcroft Cove Development Workbook (`Interim Costs` tab, with inputs
> from `Input Data` cols H-S and `Percentage Under Construction` tab).
> Encoded for nurock-devmgmt by Phase 5 (Tasks 78–81).

The LIHTC cost-cert eligible-basis calculation for **interim costs** —
construction-period interest, property taxes, loan fees, and builder's-risk
insurance — is mechanical: each dollar gets split into an *eligible* and
*ineligible* portion based on how much of the project was still under
construction when the cost was incurred. This module replaces the workbook's
Interim Costs tab with first-class server logic.

## 1. The four interim-cost categories

Tagged on `cost_account_map.interim_cost_type`. A GL account whose
`interim_cost_type` is non-NULL gets its invoice lines auto-calculated; NULL
leaves eligibility to manual entry (status quo).

| Type | Source pattern | Calc shape |
|---|---|---|
| `interest` | Monthly construction-loan interest payments | Per-month direct: eligible = payment × % under construction |
| `re_taxes` | Periodic property tax bills | Period-spread: total ÷ months, then × % under construction per month |
| `loan_fees` | Construction loan origination / commitment fees | Same as `re_taxes` (period-spread) |
| `insurance` | Builder's risk / property insurance premiums | Same as `re_taxes` (period-spread) |

## 2. Inputs the calc needs

Per **deal**:

- `closingDate` — month before which everything is 100% eligible (only
  applies to `re_taxes` / `loan_fees` / `insurance`; not `interest`).
- `certificatesOfOccupancy` (a.k.a. Final CO Date) — month after which
  the project is no longer "under construction" (0% eligible).
- For phased deals: per-building units + per-building Final CO Date.
  *Phase 5 MVP collapses this to a single building using
  `keyDates.certificatesOfOccupancy`.*

Per **invoice line**:

- `amount` — the dollar value.
- `gl_account` — looked up via `cost_account_map.interim_cost_type` to
  pick which calc to fire.
- `invoice_date` — used as the "month" input for `interest`.
- `eligibility_period_start` / `_end` — required for `re_taxes` /
  `loan_fees` / `insurance`. The period the bill covers (e.g., a Q3
  property tax bill: Jul 1 → Sep 30).

## 3. Percent under construction

For a given month M, expressed as a fraction in [0, 1]:

```
percentUnderConstruction(M, deal) =
    sum(building.units for buildings where building.finalCODate >= M)
  / sum(building.units across all buildings)
```

For a single-building deal:
- M ≤ Final CO Date → 100%
- M > Final CO Date → 0%

For a phased multi-building deal, this steps down each time a building hits
its Final CO.

## 4. The `interest` calc

For each construction-loan interest payment line:

```
month   = month containing invoice_date
pct     = percentUnderConstruction(month, deal)
eligible   = round(amount × pct, 2)
ineligible = amount − eligible
```

There is **no "100% before closing" carve-out** for interest, because
construction-loan interest can't accrue before the loan closes.

## 5. The `re_taxes` / `loan_fees` / `insurance` calc

For each line that carries a multi-month period:

```
spanMonths = (period_end − period_start) / 30           # days, not calendar months
monthlyAlloc = total / spanMonths                       # rounded to 2dp

For each calendar-month M from period_start to period_end:
    pct =
        if M ≤ closingDate:        1.0          # 100% pre-closing
        else:                       percentUnderConstruction(M, deal)
    cappedAlloc = min(monthlyAlloc, remainingTotal)     # don't over-allocate
    eligibleForM   = round(cappedAlloc × pct, 2)
    ineligibleForM = cappedAlloc − eligibleForM
    remainingTotal −= cappedAlloc

eligible   = sum(eligibleForM)
ineligible = total − eligible
```

The cap on `cappedAlloc` mirrors the workbook's `MIN/MAX` over running-sum
pattern (cols K, N, Q… on the workbook's Interim Costs tab) so floating-point
month math can't accidentally over-allocate the bill.

## 6. Storage & flags

- Result writes to `dm_invoice_lines.eligible_amount` +
  `.ineligible_amount`.
- `dm_invoice_lines.eligibility_auto_computed` set to `TRUE` whenever the
  calc writes a value. User can clear the flag (manual override) to
  prevent recalc on subsequent saves.
- The methodology used (which calc, percent applied, months covered) goes
  into `dm_invoice_lines.metadata` for audit trail — surfaced as a
  tooltip in the Invoice Ledger.

## 7. Worked example — Foxcroft Cove

Inputs (from UW Key Project Dates):
- closingDate: 2026-07-01
- certificatesOfOccupancy: 2027-12-31 (single building, 84 units)

Construction loan interest payment for September 2026: $986.30
- Month: 2026-09 → between closing and Final CO → 100% under construction
- eligible = $986.30 × 1.0 = $986.30
- ineligible = $0

Q3 2026 property tax bill: $12,000 covering 2026-07-01 → 2026-09-30
- spanMonths = (2026-09-30 − 2026-07-01) / 30 ≈ 3.0
- monthlyAlloc = $4,000
- Jul 2026 ≤ closingDate → 100% → eligible $4,000
- Aug 2026 > closingDate, ≤ Final CO → 100% → eligible $4,000
- Sep 2026 > closingDate, ≤ Final CO → 100% → eligible $4,000
- TOTAL: eligible $12,000, ineligible $0

Same Q3 bill but for 2027 with Final CO at 2027-12-31:
- Same math, all months still ≤ Final CO → 100% eligible

Same Q3 bill for 2028 (post-CO):
- All months > Final CO → 0% eligible
- TOTAL: eligible $0, ineligible $12,000
