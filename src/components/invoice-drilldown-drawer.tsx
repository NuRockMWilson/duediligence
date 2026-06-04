"use client";

import * as React from "react";
import { X, ExternalLink, Loader2, ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { Badge } from "@/components/nurock-ui";
import {
  getInvoicesForGls,
  type InvoiceForLine,
  type InvoicesForLineResult,
} from "@/lib/data/invoice-drilldown";

// ============================================================================
// Invoice Drill-Down Drawer
// ----------------------------------------------------------------------------
// Slide-over from the right side of the screen. Shows the invoices that
// contribute to a clicked actual cell (line, category subtotal, or grand
// total). Fetches on-demand via getInvoicesForGls server action — designed
// for lines with 100+ invoices.
//
// Sort: click column headers to sort by amount / date / vendor / status.
// Default sort is amount descending (from the server).
// ============================================================================

export type DrilldownContext = {
  scope: "line" | "category" | "total";
  label: string;
  glAccounts: string[];
  filterToPaid?: boolean;
};

type SortKey = "amount" | "invoice_date" | "vendor_name" | "status" | "invoice_number";
type SortDir = "asc" | "desc";

export function InvoiceDrilldownDrawer({
  open,
  context,
  dealId,
  onClose,
}: {
  open: boolean;
  context: DrilldownContext | null;
  dealId: string;
  onClose: () => void;
}) {
  const [result, setResult] = React.useState<InvoicesForLineResult | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [sortKey, setSortKey] = React.useState<SortKey>("amount");
  const [sortDir, setSortDir] = React.useState<SortDir>("desc");

  // Fetch when drawer opens or context changes
  React.useEffect(() => {
    if (!open || !context) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    setResult(null);

    getInvoicesForGls(dealId, context.glAccounts, !!context.filterToPaid)
      .then((res) => {
        if (cancelled) return;
        if (res.error) {
          setError(res.error);
          setResult(null);
        } else {
          setResult(res);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, context, dealId]);

  // Close on ESC
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !context) return null;

  const invoices = result?.invoices ?? [];
  const sortedInvoices = sortInvoices(invoices, sortKey, sortDir);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "vendor_name" || key === "invoice_number" ? "asc" : "desc");
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div
        className="fixed right-0 top-0 z-50 flex h-full w-full max-w-[720px] flex-col overflow-hidden bg-white shadow-2xl"
        role="dialog"
        aria-label="Invoice drilldown"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-[#E4E7EC] px-6 py-5">
          <div className="min-w-0 flex-1">
            <div className="font-display text-[10px] uppercase tracking-wider text-[#667085]">
              {context.filterToPaid ? "Paid Invoices" : "Invoices"} ·{" "}
              {context.scope === "line"
                ? "Line"
                : context.scope === "category"
                ? "Category"
                : "Total"}
            </div>
            <h2 className="mt-1 truncate font-display text-[18px] font-semibold text-nurock-black">
              {context.label}
            </h2>
            <div className="mt-1 text-[11px] text-[#667085]">
              {context.glAccounts.length === 0 ? (
                <span className="text-amber-700">No GL accounts mapped to this scope</span>
              ) : (
                <>
                  Scope: {context.glAccounts.length} GL
                  {context.glAccounts.length === 1 ? "" : "s"}
                  {context.glAccounts.length <= 5 && (
                    <span className="ml-1 font-mono text-[10.5px]">
                      ({context.glAccounts.join(", ")})
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-[#667085] transition-colors hover:bg-nurock-gray hover:text-nurock-black"
            aria-label="Close drawer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Stats bar */}
        <div className="flex items-center gap-6 border-b border-[#E4E7EC] bg-nurock-gray/30 px-6 py-3">
          <Stat label="Invoices" value={result ? String(result.invoiceCount) : "—"} />
          <Stat label="Total" value={result ? formatUsd(result.totalAmount) : "—"} tone="navy" />
          <Stat
            label="Paid"
            value={result ? `${formatUsd(result.totalPaidAmount)} · ${result.paidCount}` : "—"}
            tone={result && result.paidCount > 0 ? "green" : undefined}
          />
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="px-6 py-12 text-center text-[12.5px] text-[#667085]">
              <Loader2 className="mr-2 inline-block h-4 w-4 animate-spin" />
              Loading invoices...
            </div>
          )}

          {!loading && error && (
            <div className="m-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-[12px] text-red-900">
              <div className="mb-1 font-semibold">Failed to load invoices</div>
              <div className="font-mono text-[11px] text-red-700">{error}</div>
            </div>
          )}

          {!loading && !error && context.glAccounts.length === 0 && (
            <div className="px-6 py-12 text-center text-[12.5px] text-[#667085]">
              No GL accounts are mapped to this scope.
              <div className="mt-2 text-[11px] text-[#98A2B3]">
                Map GLs in the Underwriting Line → GL settings to enable drill-down here.
              </div>
            </div>
          )}

          {!loading && !error && context.glAccounts.length > 0 && invoices.length === 0 && (
            <div className="px-6 py-12 text-center text-[12.5px] text-[#667085]">
              No {context.filterToPaid ? "paid " : ""}invoices have been coded to{" "}
              {context.glAccounts.length === 1 ? "this GL" : "these GLs"} yet.
            </div>
          )}

          {!loading && !error && invoices.length > 0 && (
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 z-10 bg-[#FAFBFC]">
                <tr>
                  <SortableHeader
                    label="Invoice #"
                    sortKey="invoice_number"
                    activeKey={sortKey}
                    activeDir={sortDir}
                    onToggle={toggleSort}
                    align="left"
                  />
                  <SortableHeader
                    label="Vendor"
                    sortKey="vendor_name"
                    activeKey={sortKey}
                    activeDir={sortDir}
                    onToggle={toggleSort}
                    align="left"
                  />
                  <SortableHeader
                    label="Date"
                    sortKey="invoice_date"
                    activeKey={sortKey}
                    activeDir={sortDir}
                    onToggle={toggleSort}
                    align="left"
                  />
                  <SortableHeader
                    label="Status"
                    sortKey="status"
                    activeKey={sortKey}
                    activeDir={sortDir}
                    onToggle={toggleSort}
                    align="left"
                  />
                  <SortableHeader
                    label="Amount"
                    sortKey="amount"
                    activeKey={sortKey}
                    activeDir={sortDir}
                    onToggle={toggleSort}
                    align="right"
                  />
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E4E7EC]">
                {sortedInvoices.map((inv) => (
                  <InvoiceRow key={inv.id} invoice={inv} dealId={dealId} />
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-[#E4E7EC] bg-nurock-gray/20 px-6 py-3 text-[11px] text-[#667085]">
          Click an invoice to open it in the Invoices tab. Drill-down amounts reflect only{" "}
          <code className="font-mono">dm_invoice_lines</code> rows matching the scope's GLs.
        </div>
      </div>
    </>
  );
}

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

function InvoiceRow({ invoice, dealId }: { invoice: InvoiceForLine; dealId: string }) {
  return (
    <tr className="hover:bg-[#FAFBFC]">
      <td className="px-3 py-2.5">
        <a
          href={`/deals/${dealId}/invoices?invoice=${invoice.id}`}
          className="inline-flex items-center gap-1 font-mono text-[11.5px] text-nurock-navy hover:underline"
          target="_blank"
          rel="noreferrer"
        >
          {invoice.invoice_number || <span className="italic text-[#98A2B3]">no #</span>}
          <ExternalLink className="h-3 w-3" />
        </a>
        {invoice.line_count > 1 && (
          <div className="mt-0.5 text-[10px] text-[#98A2B3]">
            {invoice.line_count} matching lines
          </div>
        )}
      </td>
      <td className="px-3 py-2.5 text-nurock-slate">
        {invoice.vendor_name || <span className="text-[#98A2B3]">—</span>}
      </td>
      <td className="px-3 py-2.5 font-mono tabular-nums text-[#667085]">
        {invoice.invoice_date || <span className="text-[#98A2B3]">—</span>}
      </td>
      <td className="px-3 py-2.5">
        <StatusBadge status={invoice.status} />
      </td>
      <td className="px-3 py-2.5 text-right font-mono font-semibold tabular-nums">
        {formatUsd(invoice.amount)}
      </td>
    </tr>
  );
}

function SortableHeader({
  label,
  sortKey,
  activeKey,
  activeDir,
  onToggle,
  align,
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  activeDir: SortDir;
  onToggle: (k: SortKey) => void;
  align: "left" | "right";
}) {
  const isActive = activeKey === sortKey;
  const Icon = !isActive ? ArrowUpDown : activeDir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th
      className={`border-b border-[#E4E7EC] bg-[#FAFBFC] px-3 py-2.5 font-display text-[10px] font-semibold uppercase tracking-[0.06em] text-${align} text-nurock-slate`}
    >
      <button
        onClick={() => onToggle(sortKey)}
        className={`inline-flex items-center gap-1 hover:text-nurock-navy ${
          align === "right" ? "ml-auto" : ""
        }`}
      >
        {align === "right" && (
          <Icon className={`h-3 w-3 ${isActive ? "text-nurock-navy" : "text-[#98A2B3]"}`} />
        )}
        <span>{label}</span>
        {align === "left" && (
          <Icon className={`h-3 w-3 ${isActive ? "text-nurock-navy" : "text-[#98A2B3]"}`} />
        )}
      </button>
    </th>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "navy" | "green";
}) {
  const toneClass =
    tone === "navy"
      ? "text-nurock-navy"
      : tone === "green"
      ? "text-emerald-700"
      : "text-nurock-black";
  return (
    <div>
      <div className="font-display text-[9px] uppercase tracking-wider text-[#667085]">
        {label}
      </div>
      <div className={`mt-0.5 font-mono text-[13px] font-semibold ${toneClass}`}>
        {value}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  const s = (status ?? "").toLowerCase();
  if (s === "paid") return <Badge tone="green">Paid</Badge>;
  if (s === "hold" || s === "held") return <Badge tone="amber">Hold</Badge>;
  if (s === "approved") return <Badge tone="navy">Approved</Badge>;
  if (s === "rejected") return <Badge tone="amber">Rejected</Badge>;
  return <Badge tone="slate">{status || "Pending"}</Badge>;
}

// =============================================================================
// HELPERS
// =============================================================================

function sortInvoices(
  invoices: InvoiceForLine[],
  key: SortKey,
  dir: SortDir
): InvoiceForLine[] {
  const sign = dir === "asc" ? 1 : -1;
  const sorted = [...invoices];
  sorted.sort((a, b) => {
    const av = a[key];
    const bv = b[key];

    if (av == null && bv == null) return 0;
    if (av == null) return 1; // nulls always last
    if (bv == null) return -1;

    if (typeof av === "number" && typeof bv === "number") {
      return (av - bv) * sign;
    }
    return String(av).localeCompare(String(bv)) * sign;
  });
  return sorted;
}

function formatUsd(n: number): string {
  if (n === 0) return "—";
  const sign = n < 0 ? "−" : "";
  const abs = Math.abs(n);
  return `${sign}$${abs.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
