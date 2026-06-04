"use server";

import { createClient } from "@/lib/supabase/server";

// ============================================================================
// Invoice drill-down — on-demand fetch for clickable actuals
// ----------------------------------------------------------------------------
// Returns invoices that contribute to a given set of GL accounts for a deal.
// Each invoice's `amount` is the sum of its dm_invoice_lines amounts that
// match the specified GL set (not the invoice gross amount). Invoices with
// zero matching lines are filtered out.
//
// Designed to handle lines with 100+ invoices (e.g., permits). Three sequential
// Supabase queries:
//   1. dm_invoices            — invoice metadata for the deal
//   2. dm_invoice_lines       — only lines matching the GL set
//   3. dm_vendors             — vendor names for resolved invoices
// Result is sorted by amount descending.
// ============================================================================

export type InvoiceForLine = {
  id: string;
  invoice_number: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  invoice_date: string | null;
  status: string | null;
  amount: number;       // sum of dm_invoice_lines.amount for this invoice in the GL set
  line_count: number;   // number of matching lines on this invoice
};

export type InvoicesForLineResult = {
  invoices: InvoiceForLine[];
  totalAmount: number;
  totalPaidAmount: number;
  invoiceCount: number;
  paidCount: number;
  error?: string;
};

const EMPTY_RESULT: InvoicesForLineResult = {
  invoices: [],
  totalAmount: 0,
  totalPaidAmount: 0,
  invoiceCount: 0,
  paidCount: 0,
};

export async function getInvoicesForGls(
  dealId: string,
  glAccounts: string[],
  filterToPaid: boolean = false
): Promise<InvoicesForLineResult> {
  if (!dealId || glAccounts.length === 0) {
    return EMPTY_RESULT;
  }

  const supabase = await createClient();

  // 1. Fetch invoices for the deal
  const { data: invoicesRaw, error: invErr } = await supabase
    .from("dm_invoices")
    .select("id, invoice_number, vendor_id, invoice_date, status")
    .eq("deal_id", dealId);

  if (invErr) {
    console.error("[invoice-drilldown] dm_invoices:", invErr);
    return { ...EMPTY_RESULT, error: invErr.message };
  }

  let allInvoices = invoicesRaw ?? [];

  // Apply paid filter at the invoice level if requested
  if (filterToPaid) {
    allInvoices = allInvoices.filter(
      (i) => (i.status ?? "").toLowerCase() === "paid"
    );
  }

  if (allInvoices.length === 0) {
    return EMPTY_RESULT;
  }

  const invoiceIds = allInvoices.map((i) => i.id);

  // 2. Fetch only invoice lines matching the GL set
  // Supabase `in` filter has a practical limit ~ a few hundred values. For
  // our case (deal with up to ~500 invoices and ~50 GLs), this stays well
  // under the URL length limit.
  const { data: linesRaw, error: linesErr } = await supabase
    .from("dm_invoice_lines")
    .select("invoice_id, amount, gl_account")
    .in("invoice_id", invoiceIds)
    .in("gl_account", glAccounts);

  if (linesErr) {
    console.error("[invoice-drilldown] dm_invoice_lines:", linesErr);
    return { ...EMPTY_RESULT, error: linesErr.message };
  }

  // 3. Aggregate per invoice
  const sumByInvoice = new Map<string, { amount: number; count: number }>();
  for (const line of linesRaw ?? []) {
    if (!line.invoice_id) continue;
    const existing = sumByInvoice.get(line.invoice_id) ?? { amount: 0, count: 0 };
    existing.amount += Number(line.amount ?? 0);
    existing.count += 1;
    sumByInvoice.set(line.invoice_id, existing);
  }

  // 4. Look up vendor names for invoices with matching lines
  const matchingInvoices = allInvoices.filter((i) => sumByInvoice.has(i.id));
  const vendorIds = Array.from(
    new Set(
      matchingInvoices
        .map((i) => i.vendor_id)
        .filter((v): v is string => !!v)
    )
  );

  let vendorMap = new Map<string, string>();
  if (vendorIds.length > 0) {
    const { data: vendorsRaw, error: vendErr } = await supabase
      .from("dm_vendors")
      .select("id, name")
      .in("id", vendorIds);

    if (vendErr) {
      console.error("[invoice-drilldown] dm_vendors:", vendErr);
      // Continue without vendor names rather than failing the whole drilldown
    } else {
      vendorMap = new Map(
        (vendorsRaw ?? []).map((v) => [v.id, (v.name ?? "") as string])
      );
    }
  }

  // 5. Build final array, sort by amount desc
  const result: InvoiceForLine[] = [];
  let totalAmount = 0;
  let totalPaidAmount = 0;
  let paidCount = 0;

  for (const inv of matchingInvoices) {
    const sum = sumByInvoice.get(inv.id);
    if (!sum) continue;

    const row: InvoiceForLine = {
      id: inv.id,
      invoice_number: inv.invoice_number,
      vendor_id: inv.vendor_id,
      vendor_name: inv.vendor_id ? vendorMap.get(inv.vendor_id) ?? null : null,
      invoice_date: inv.invoice_date,
      status: inv.status,
      amount: sum.amount,
      line_count: sum.count,
    };

    result.push(row);
    totalAmount += sum.amount;

    if ((inv.status ?? "").toLowerCase() === "paid") {
      totalPaidAmount += sum.amount;
      paidCount += 1;
    }
  }

  result.sort((a, b) => b.amount - a.amount);

  return {
    invoices: result,
    totalAmount,
    totalPaidAmount,
    invoiceCount: result.length,
    paidCount,
  };
}
