# Invoices — Phase 3.5 (Edit Drawer + PDF Panel + Hold Reason)

The Phase 3 design plus the actual editing capability you need. The
existing Ship 2c.2 `InvoiceFormSheetBody` is now reattached via a wider
Sheet drawer with an optional PDF preview panel on the left.

## Ship contents

**In zip (place at repo root):**
```
src/app/(app)/deals/[dealId]/invoices/page.tsx                          → REPLACE
src/app/(app)/deals/[dealId]/invoices/actions.ts                        → REPLACE (Ship 2c.2 + new attachment/hold actions)
src/app/(app)/deals/[dealId]/invoices/_components/invoices-shell.tsx    → REPLACE
src/app/(app)/deals/[dealId]/invoices/_components/invoice-drawer.tsx    → NEW
src/app/(app)/deals/[dealId]/invoices/_components/pdf-panel.tsx         → NEW
```

**Standalone SQL files (place in `nurock-underwriting/supabase/migrations/`):**
```
0030_invoice_attachment_path.sql
0031_invoice_hold_reason.sql
```

Files untouched: `invoice-form.tsx`, `vendor-picker.tsx`,
`formatted-inputs.tsx`. The form has finally been reattached to the new
shell — no orphans.

## Run the migrations first

```bash
# In Supabase Studio SQL editor (or psql), in order:
\i 0030_invoice_attachment_path.sql
\i 0031_invoice_hold_reason.sql
```

Migration 0030 does three things: adds `attachment_path TEXT` to
`dm_invoices`, creates the private `invoice-attachments` Storage bucket,
and applies SELECT/INSERT/UPDATE/DELETE policies on `storage.objects`
scoped to that bucket (PUBLIC-style policies per project convention).

Migration 0031 adds `hold_reason TEXT` to `dm_invoices` — free-text with
canonical suggestions surfaced in the UI.

## Real data wiring (page.tsx)

The new server component fetches everything the shell + drawer need in
five parallel queries:

```ts
const [invoicesRes, vendorsRes, affiliatesRes, fundingSourcesRes, costAccountsRes] =
  await Promise.all([
    supabase.from("dm_invoices").select("..., dm_invoice_lines(...)").eq("deal_id", dealId)...
    supabase.from("dm_vendors").select(...).order("name"),
    supabase.from("dm_affiliates").select("..."),
    supabase.from("dm_funding_sources").select(...).eq("deal_id", dealId),
    supabase.from("cost_account_map").select(...).order("gl_account"),
  ]);
```

Errors are logged to the server console but don't crash the page —
empty arrays propagate to the shell which renders an empty state. This
handles the case where, say, `dm_funding_sources` doesn't exist yet (the
form will just show an empty funding-source dropdown rather than 500'ing).

If any table name differs from what I guessed (especially
`dm_funding_sources` and `dm_affiliates`), you'll see error messages in
the Next.js dev console after deploy. Paste those errors and I'll
correct.

## Drawer behavior

**URL-driven state.** Three URL patterns:
- `/deals/<id>/invoices` — list view, no drawer
- `/deals/<id>/invoices?invoice=<inv-id>` — edit drawer open
- `/deals/<id>/invoices?new=true` — new-invoice drawer open

Click any row → adds `?invoice=<id>` to URL → drawer opens with that
invoice's data loaded. Click the "+ Add invoice" button → adds
`?new=true` → drawer opens with empty form. Close the drawer (X button
or click outside) → clears the param → URL goes back to clean.

This means **invoice edit URLs are bookmarkable and shareable**. Send
someone `/deals/.../invoices?invoice=abc-123` and they land directly on
that invoice's drawer.

**Layout.** On `xl:` screens and up, drawer is 1500px wide. PDF panel on
the left (600px), form on the right (~900px). PDF panel collapsible via
toggle button in the header — "Show PDF" / X button on the panel itself.
On smaller screens, PDF panel is hidden entirely and the drawer takes
full width with just the form.

**Hold banner.** When opening an invoice with `hold_reason` set, an
amber banner appears at the top of the drawer above the form body showing
why it's on hold. You can clear or change the reason through the form's
notes field, or via the `setInvoiceHoldReason` / `clearInvoiceHoldReason`
actions (those don't have UI yet — Phase 4 will add a Hold/Release
toggle to the drawer).

## PDF panel

**For existing invoices with no attachment:** dropzone. Drag-drop a PDF
or click to open the file picker. Max 25 MB, application/pdf only.

**For existing invoices with attachment:** iframe preview using a
short-lived (1 hour) signed URL from Supabase Storage. Replace and Delete
buttons in the header.

**For new invoices (not yet saved):** placeholder explaining you need to
save the invoice first before attaching a PDF. The attachment_path can't
be set on a row that doesn't exist yet, and we don't want to upload to
storage with a temp path then have to rename later — keeps things clean.

**Storage path format:** `<dealId>/<invoiceId>.pdf` in the
`invoice-attachments` bucket. Replacing an existing attachment upserts
to the same path (overwrites). Deleting removes the object from storage
and clears the attachment_path column.

## Hold reason tooltip (the polish item)

Invoices with `hold_reason` set render with a red "Hold ⓘ" badge in the
Status column. Hover the badge → tooltip appears showing the human-
readable reason. Canonical reasons mapped in `HOLD_REASON_LABELS`:

| Stored value     | Display label                    |
|------------------|----------------------------------|
| waiver_missing   | Missing lien waiver              |
| coi_expired      | Expired COI                      |
| budget_overage   | Budget overage — CO pending      |
| vendor_dispute   | Vendor dispute                   |
| other            | Other                            |

Any other value (free-text) displays as-is — you can write whatever you
want in the field, but the canonical values get the nicely formatted
labels.

## Status derivation

Real DB doesn't have a single "status" column — it has `payment_status`
(unpaid/paid) and now `hold_reason`. The shell derives the displayed
status from those:

| Display status | Rule                                                |
|----------------|-----------------------------------------------------|
| Hold (red)     | `hold_reason IS NOT NULL`                           |
| Posted (green) | `payment_status = 'paid'`                           |
| Pending (amber)| otherwise (unpaid, no hold)                         |

The Phase 3 design also had "Awaiting Approval" (in-pipeline) and "Over
Budget" (line exceeds budget) and "Code ?" (ambiguous coding) statuses.
Those depend on infrastructure we haven't built yet:

- **Awaiting** needs approval workflow tables (`dm_approval_steps` or
  similar) so we know which invoices are mid-flow vs. just sitting there
- **Over Budget** needs the budget lookup against `cost_account_map`
  budgets (or `deals.model.constructionBudget` per line)
- **Code ?** needs a `coding_confidence` field on `dm_invoice_lines`
  populated by the OCR / auto-coding pipeline

When those land, the derivation logic in `deriveDisplayInvoice` extends
naturally.

## Skipped from the reviewer's polish list

Two items I explicitly deferred and noted in the chat:

**Inline GL coding fix on Code ? rows.** Needs `coding_confidence` to
exist before there's anything to flag. Coming with the Co-Pilot rules
engine in a later phase.

**Unfunded Gap sub-text on Over Bgt rows.** Needs the budget-lookup
infrastructure (per-line comparison against the deal's budget). Coming
when we wire `deals.model.constructionBudget` into invoice validation.

Both remain on the polish backlog.

## What now works that didn't before

- ✅ Click any invoice row to edit
- ✅ Click "+ Add invoice" to create a new one
- ✅ Existing `upsertInvoiceWithLines` / `deleteInvoice` / vendor-create
  actions all wired through
- ✅ Attach a PDF to any saved invoice
- ✅ Preview the PDF side-by-side with the form
- ✅ Replace or delete attachments
- ✅ See hold reason inline on the list and as a banner in the drawer
- ✅ URL params make edit views bookmarkable and shareable

## Deploy

```bash
# 1. Run migrations in Supabase Studio (paste each .sql file)
# 2. Drop the zip files into the project, then:
git add -A && git commit -m "feat(invoices): drawer reattachment + PDF panel + hold reason (Phase 3.5)" && git push
```

After Vercel deploys, hit `/deals/<foxcroft-id>/invoices`:
- Existing invoices should appear in the list with their real data
- Click any row → drawer opens with the form populated
- For an invoice without a PDF, the right side shows the dropzone
  (assuming there's an invoice to attach to)
- Try uploading a small PDF to verify storage works end-to-end

If any Supabase query name doesn't match your real schema
(`dm_funding_sources`, `dm_affiliates`, `cost_account_map`), you'll see
console errors. Paste them and I'll patch — most likely they're just
named differently.
