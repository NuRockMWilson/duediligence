import { createClient } from "@/lib/supabase/server";

// ============================================================================
// Budget Actuals — live aggregation from dm_invoice_lines for a deal
// ----------------------------------------------------------------------------
// Returns per-GL-account rollup of invoiced/paid/eligible amounts plus
// metadata from cost_account_map. Used by the Budget vs Actual page (Phase A
// real-data wiring) and reusable from Dashboard / Invoices / Schedule for
// matching aggregations.
//
// Implementation: three sequential queries (invoices for deal → lines for
// those invoices → cost_account_map descriptions). Aggregation done in code
// rather than SQL to avoid assumptions about Supabase join syntax / FK names.
// If any column name is wrong, console.error makes the mistake obvious in
// Vercel function logs.
// ============================================================================

export type GlActivityRow = {
  gl_account: string;
  description: string;
  cb_code: string | null;
  fhfc_reporting_category: string | null;
  is_eligible_basis: boolean | null;
  totalInvoiced: number;
  totalEligible: number;
  totalPaid: number;
  lineCount: number;
  invoiceCount: number; // distinct invoices touching this GL
};

export type BudgetActuals = {
  byGl: GlActivityRow[];
  totalInvoiced: number;
  totalPaid: number;
  totalEligible: number;
  invoiceCount: number;
  lineCount: number;
};

const EMPTY: BudgetActuals = {
  byGl: [],
  totalInvoiced: 0,
  totalPaid: 0,
  totalEligible: 0,
  invoiceCount: 0,
  lineCount: 0,
};

export async function getBudgetActuals(dealId: string): Promise<BudgetActuals> {
  const supabase = await createClient();

  // ----- 1. Invoices for this deal --------------------------------------
  const { data: invoices, error: invErr } = await supabase
    .from("dm_invoices")
    .select("id, status")
    .eq("deal_id", dealId);

  if (invErr) {
    console.error("[budget-actuals] dm_invoices:", invErr);
    return EMPTY;
  }

  const invoiceIds = (invoices ?? []).map((i: { id: string }) => i.id);
  const paidSet = new Set<string>(
    (invoices ?? [])
      .filter((i: { status: string | null }) => (i.status ?? "").toLowerCase() === "paid")
      .map((i: { id: string }) => i.id)
  );

  if (invoiceIds.length === 0) return EMPTY;

  // ----- 2. Lines for those invoices ------------------------------------
  // `dm_invoice_lines.amount` per generated types (not gross_amount — that's
  // an invoice-header column convention, not used on the lines table).
  const { data: lines, error: lineErr } = await supabase
    .from("dm_invoice_lines")
    .select("gl_account, amount, eligible_amount, invoice_id")
    .in("invoice_id", invoiceIds);

  if (lineErr) {
    console.error("[budget-actuals] dm_invoice_lines:", lineErr);
    return EMPTY;
  }

  // ----- 3. Cost account map descriptions -------------------------------
  const glAccounts = Array.from(
    new Set(
      (lines ?? [])
        .map((l: { gl_account: string | null }) => l.gl_account)
        .filter((g: string | null): g is string => !!g)
    )
  );

  type CoaRow = {
    gl_account: string;
    account_description: string | null;
    cb_code: string | null;
    fhfc_reporting_category: string | null;
    is_eligible_basis: boolean | null;
  };

  const coaMap = new Map<string, CoaRow>();
  if (glAccounts.length > 0) {
    const { data: coa, error: coaErr } = await supabase
      .from("cost_account_map")
      .select(
        "gl_account, account_description, cb_code, fhfc_reporting_category, is_eligible_basis"
      )
      .in("gl_account", glAccounts);

    if (coaErr) {
      console.error("[budget-actuals] cost_account_map:", coaErr);
    } else {
      for (const c of (coa ?? []) as CoaRow[]) {
        coaMap.set(c.gl_account, c);
      }
    }
  }

  // ----- 4. Aggregate ---------------------------------------------------
  const byGlMap = new Map<string, GlActivityRow>();
  const invoiceIdsPerGl = new Map<string, Set<string>>();
  let totalInvoiced = 0;
  let totalPaid = 0;
  let totalEligible = 0;

  type LineRow = {
    gl_account: string | null;
    amount: number | string | null;
    eligible_amount: number | string | null;
    invoice_id: string;
  };

  for (const line of (lines ?? []) as LineRow[]) {
    if (!line.gl_account) continue;
    const gl = line.gl_account;
    const meta = coaMap.get(gl);
    const total = Number(line.amount ?? 0);
    const eligible = Number(line.eligible_amount ?? 0);

    const existing = byGlMap.get(gl) ?? {
      gl_account: gl,
      description: meta?.account_description ?? "(unmapped GL)",
      cb_code: meta?.cb_code ?? null,
      fhfc_reporting_category: meta?.fhfc_reporting_category ?? null,
      is_eligible_basis: meta?.is_eligible_basis ?? null,
      totalInvoiced: 0,
      totalEligible: 0,
      totalPaid: 0,
      lineCount: 0,
      invoiceCount: 0,
    };

    existing.totalInvoiced += total;
    existing.totalEligible += eligible;
    if (paidSet.has(line.invoice_id)) existing.totalPaid += total;
    existing.lineCount += 1;

    const invSet = invoiceIdsPerGl.get(gl) ?? new Set<string>();
    invSet.add(line.invoice_id);
    invoiceIdsPerGl.set(gl, invSet);

    byGlMap.set(gl, existing);

    totalInvoiced += total;
    totalEligible += eligible;
    if (paidSet.has(line.invoice_id)) totalPaid += total;
  }

  // Resolve distinct invoice counts per GL
  for (const [gl, set] of invoiceIdsPerGl) {
    const row = byGlMap.get(gl);
    if (row) row.invoiceCount = set.size;
  }

  const byGl = Array.from(byGlMap.values()).sort(
    (a, b) => b.totalInvoiced - a.totalInvoiced
  );

  return {
    byGl,
    totalInvoiced,
    totalPaid,
    totalEligible,
    invoiceCount: invoices?.length ?? 0,
    lineCount: lines?.length ?? 0,
  };
}
