// =============================================================================
// Cost Cert Readiness (r1)
// =============================================================================
// The bridge between the development module and a cost certification: given
// the live deal state (actual vs budget, draws, invoice backup, buildings,
// sources, lease-up), produce a checklist of what's complete and what's still
// outstanding before the deal can be certified. Pure — the page assembles the
// inputs from its existing queries + a few extras and calls this.
// =============================================================================

export type CheckStatus = "ok" | "warn" | "blocker";

export interface CertReadinessCheck {
  key: string;
  label: string;
  status: CheckStatus;
  detail: string;
  /** Sub-path under /deals/[dealId] to fix the issue (panel prefixes it). */
  href?: string;
}

export interface CertReadiness {
  checks: CertReadinessCheck[];
  pctInvoiced: number; // 0..100
  okCount: number;
  total: number;
  blockers: number;
  warnings: number;
  overall: "ready" | "almost" | "not_ready";
}

export interface CertReadinessInput {
  totalBudget: number;
  totalActual: number;
  /** Lines with a budget where actual is materially below budget. */
  lineGapCount: number;
  unfundedDrawCount: number;
  totalDrawCount: number;
  invoicesMissingPdf: number;
  totalInvoices: number;
  /** Invoices with ≥1 line that has no eligible/ineligible basis breakout. */
  invoicesMissingBreakout: number;
  buildingsIncomplete: number;
  totalBuildings: number;
  /** Committed sources (live-plug DDF applied) − total uses (budget). <0 = short. */
  sourcesVsUses: number;
  leaseUpEntered: boolean;
  buildingsUnitSum: number;
  modelUnitCount: number | null;
}

function usd(n: number): string {
  const neg = n < 0;
  const s = `$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
  return neg ? `(${s})` : s;
}

export function computeCertReadiness(input: CertReadinessInput): CertReadiness {
  const checks: CertReadinessCheck[] = [];
  const pctInvoiced =
    input.totalBudget > 0 ? (input.totalActual / input.totalBudget) * 100 : 0;

  // 1. Costs invoiced (actual vs budget) — the heart of a cost cert.
  {
    const gap = input.totalBudget - input.totalActual;
    const status: CheckStatus =
      input.totalBudget <= 0 ? "blocker" : pctInvoiced >= 99 ? "ok" : "warn";
    const detail =
      input.totalBudget <= 0
        ? "No promoted budget to certify against."
        : pctInvoiced >= 99
          ? `All costs booked — ${usd(input.totalActual)} invoiced.`
          : `${pctInvoiced.toFixed(0)}% invoiced (${usd(input.totalActual)} of ${usd(input.totalBudget)}); ${usd(gap)} not yet booked${input.lineGapCount > 0 ? ` across ${input.lineGapCount} line${input.lineGapCount === 1 ? "" : "s"}` : ""}.`;
    checks.push({ key: "costs", label: "Costs invoiced", status, detail, href: "invoices" });
  }

  // 2. Draws funded.
  {
    const status: CheckStatus = input.unfundedDrawCount > 0 ? "warn" : "ok";
    const detail =
      input.totalDrawCount === 0
        ? "No draws yet."
        : input.unfundedDrawCount > 0
          ? `${input.unfundedDrawCount} of ${input.totalDrawCount} draw${input.totalDrawCount === 1 ? "" : "s"} submitted but not yet funded.`
          : `All ${input.totalDrawCount} draw${input.totalDrawCount === 1 ? "" : "s"} funded.`;
    checks.push({ key: "draws", label: "Draws funded", status, detail, href: "draws" });
  }

  // 3. Invoice backup (PDF attached) — cost cert needs source documents.
  {
    const status: CheckStatus = input.invoicesMissingPdf > 0 ? "warn" : "ok";
    const detail =
      input.totalInvoices === 0
        ? "No invoices on file."
        : input.invoicesMissingPdf > 0
          ? `${input.invoicesMissingPdf} of ${input.totalInvoices} invoice${input.totalInvoices === 1 ? "" : "s"} missing a PDF.`
          : `All ${input.totalInvoices} invoice${input.totalInvoices === 1 ? "" : "s"} have backup.`;
    checks.push({ key: "backup", label: "Invoice backup", status, detail, href: "invoices" });
  }

  // 3b. Eligible/ineligible basis breakout — every invoice must be split into
  //     eligible vs ineligible basis (interim costs amortized) before a cost
  //     cert can be produced. BLOCKER: the cert isn't complete until 0 remain.
  {
    const status: CheckStatus =
      input.invoicesMissingBreakout > 0 ? "blocker" : "ok";
    const detail =
      input.totalInvoices === 0
        ? "No invoices on file."
        : input.invoicesMissingBreakout > 0
          ? `${input.invoicesMissingBreakout} of ${input.totalInvoices} invoice${input.totalInvoices === 1 ? "" : "s"} still need an eligible/ineligible basis breakout.`
          : `All ${input.totalInvoices} invoice${input.totalInvoices === 1 ? "" : "s"} have an eligible/ineligible breakout.`;
    checks.push({
      key: "eligibility_breakout",
      label: "Eligible basis breakout",
      status,
      detail,
      href: "invoices",
    });
  }

  // 4. Buildings registry complete (BIN / PIS / unit count).
  {
    const status: CheckStatus =
      input.totalBuildings === 0
        ? "blocker"
        : input.buildingsIncomplete > 0
          ? "warn"
          : "ok";
    const detail =
      input.totalBuildings === 0
        ? "No buildings entered — add the building registry (BIN, PIS date, units)."
        : input.buildingsIncomplete > 0
          ? `${input.buildingsIncomplete} of ${input.totalBuildings} building${input.totalBuildings === 1 ? "" : "s"} missing BIN, placed-in-service date, or unit count.`
          : `All ${input.totalBuildings} building${input.totalBuildings === 1 ? "" : "s"} complete.`;
    checks.push({ key: "buildings", label: "Buildings registry", status, detail, href: "cert-prep" });
  }

  // 5. Sources cover uses.
  {
    const status: CheckStatus = input.sourcesVsUses < -1 ? "warn" : "ok";
    const detail =
      input.sourcesVsUses < -1
        ? `Committed sources fall short of uses by ${usd(-input.sourcesVsUses)}.`
        : "Committed sources cover total uses.";
    checks.push({ key: "sources", label: "Sources cover uses", status, detail, href: "funding-sources" });
  }

  // 6. Lease-up entered (applicable fraction / 8609 timing).
  {
    const status: CheckStatus = input.leaseUpEntered ? "ok" : "warn";
    const detail = input.leaseUpEntered
      ? "Lease-up schedule entered."
      : "No lease-up schedule — needed for the applicable fraction / 8609 timing.";
    checks.push({ key: "leaseup", label: "Lease-up entered", status, detail, href: "cert-prep" });
  }

  // 7. Building unit count reconciles with the UW model.
  if (input.modelUnitCount !== null && input.buildingsUnitSum > 0) {
    const matches = input.modelUnitCount === input.buildingsUnitSum;
    checks.push({
      key: "units",
      label: "Unit count reconciled",
      status: matches ? "ok" : "warn",
      detail: matches
        ? `${input.buildingsUnitSum} units match the model.`
        : `Buildings sum to ${input.buildingsUnitSum} units; model reports ${input.modelUnitCount}.`,
      href: "cert-prep",
    });
  }

  const blockers = checks.filter((c) => c.status === "blocker").length;
  const warnings = checks.filter((c) => c.status === "warn").length;
  const okCount = checks.filter((c) => c.status === "ok").length;
  const overall: CertReadiness["overall"] =
    blockers > 0 ? "not_ready" : warnings > 0 ? "almost" : "ready";

  return {
    checks,
    pctInvoiced,
    okCount,
    total: checks.length,
    blockers,
    warnings,
    overall,
  };
}
