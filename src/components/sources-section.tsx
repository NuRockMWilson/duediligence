"use client";

import * as React from "react";
import { Card } from "@/components/ui/card";
import { AlertCircle, Info } from "lucide-react";
import { formatCurrency } from "@/lib/format";

// =============================================================================
// Phase 7.4 — Total Sources section
// =============================================================================
// Renders below the Uses table on Schedule and Budget vs Actual. Column layout
// intentionally mirrors the Uses table on each page (Source, Original,
// Adjustments, Revised, Active Draft, Drawn to Date, Remaining, % Drawn) so
// the two tables align visually.
//
// Row generation in lib/db/sources-aggregation.ts produces:
//   - One row per non-decomposed source
//   - For construction-only loans: source row + payoff row (negative)
//   - For LIHTC equity / state credits: two rows (during + post construction)
//
// Total at bottom should equal Total Uses Revised (TDC). The reconciliation
// banner appears when:
//   - usesRevisedTotal !== totals.revised (capital stack mismatch with TDC)
//   - unallocated.drawn > 0 or unallocated.draft > 0 (allocation gap on draws)

export interface SourceDisplayRow {
  rowId: string;
  fundingSourceId: string | null;
  displayName: string;
  lenderName: string | null;
  kind: string;
  role: "source" | "payoff" | "equity_during" | "equity_post";
  original: number;
  adjustments: number;
  revised: number;
  activeDraft: number;
  drawnToDate: number;
  isPayoff: boolean;
  isEstimatedSplit: boolean;
}

export interface SourcesSectionProps {
  rows: SourceDisplayRow[];
  totals: {
    original: number;
    adjustments: number;
    revised: number;
    activeDraft: number;
    drawnToDate: number;
    remaining: number;
  };
  unallocated: {
    drawn: number;
    draft: number;
  };
  anyEquitySplitEstimated: boolean;
  // Total Uses Revised — for reconciliation. Passed in from the page so
  // we use the same number the Uses table is showing.
  usesRevisedTotal: number;
}

export function SourcesSection({
  rows,
  totals,
  unallocated,
  anyEquitySplitEstimated,
  usesRevisedTotal,
}: SourcesSectionProps) {
  const hasAllocGap =
    unallocated.drawn > 0.01 || unallocated.draft > 0.01;
  const tdcGap = totals.revised - usesRevisedTotal;
  const hasTdcGap = Math.abs(tdcGap) > 0.5;

  const incurred = totals.drawnToDate + totals.activeDraft;
  const pctDrawn =
    totals.revised > 0 ? (incurred / totals.revised) * 100 : 0;

  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-5 py-3 border-b border-nurock-border bg-nurock-gray/30 flex items-center justify-between">
        <h2 className="font-display text-sm uppercase tracking-wider text-nurock-navy font-semibold">
          Total Sources
        </h2>
        <span className="text-[10px] text-nurock-slate-light font-display uppercase tracking-wider">
          {formatCurrency(totals.revised, 0)} committed ·{" "}
          {hasTdcGap ? (
            <span className="text-red-700 font-bold">
              {tdcGap > 0 ? "+" : ""}
              {formatCurrency(tdcGap, 0)} vs uses
            </span>
          ) : (
            <span className="text-emerald-700">reconciles to uses</span>
          )}
        </span>
      </div>

      {hasTdcGap && (
        <div className="px-5 py-2.5 bg-red-50 border-b border-red-200">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-700 mt-0.5 shrink-0" />
            <div className="text-xs text-red-900">
              <span className="font-semibold">
                Sources don&apos;t balance to uses.
              </span>{" "}
              Total Sources Revised{" "}
              <span className="font-mono">
                {formatCurrency(totals.revised, 2)}
              </span>{" "}
              vs Total Uses Revised{" "}
              <span className="font-mono">
                {formatCurrency(usesRevisedTotal, 2)}
              </span>{" "}
              = gap of{" "}
              <span className="font-mono font-bold">
                {tdcGap > 0 ? "+" : ""}
                {formatCurrency(tdcGap, 2)}
              </span>
              .{" "}
              {tdcGap > 0
                ? "Sources exceed TDC — likely a missing payoff line or duplicated source."
                : "Sources short of TDC — likely an underfunded capital stack or missing equity-post row."}
            </div>
          </div>
        </div>
      )}

      {anyEquitySplitEstimated && (
        <div className="px-5 py-2.5 bg-amber-50 border-b border-amber-200">
          <div className="flex items-start gap-2">
            <Info className="w-4 h-4 text-amber-700 mt-0.5 shrink-0" />
            <div className="text-xs text-amber-900">
              <span className="font-semibold">
                Equity split is estimated.
              </span>{" "}
              At least one equity source is using the default 25% during /
              75% post construction split because the syndicator pay-in
              schedule hasn&apos;t been populated. Update the underwriting
              model and re-promote, or set{" "}
              <span className="font-mono">
                metadata.equity_during_construction
              </span>{" "}
              on the funding source directly.
            </div>
          </div>
        </div>
      )}

      {hasAllocGap && (
        <div className="px-5 py-2.5 bg-amber-50 border-b border-amber-200">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-amber-700 mt-0.5 shrink-0" />
            <div className="text-xs text-amber-900">
              <span className="font-semibold">
                Allocations don&apos;t fully reconcile to draws.
              </span>{" "}
              {unallocated.draft > 0.01 && (
                <>
                  Draft draw has{" "}
                  <span className="font-mono">
                    {formatCurrency(unallocated.draft, 2)}
                  </span>{" "}
                  in unallocated invoice lines.{" "}
                </>
              )}
              {unallocated.drawn > 0.01 && (
                <>
                  Submitted draws have{" "}
                  <span className="font-mono">
                    {formatCurrency(unallocated.drawn, 2)}
                  </span>{" "}
                  unaccounted for —{" "}
                  <span className="font-semibold">
                    should not happen
                  </span>{" "}
                  since submit validates allocations balance.{" "}
                </>
              )}
              Allocate draft lines on the Active Draw page.
            </div>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-nurock-gray/40 border-b border-nurock-border">
              <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider font-display text-nurock-slate min-w-[320px]">
                Source
              </th>
              <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider font-display text-nurock-slate whitespace-nowrap">
                Original
              </th>
              <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider font-display text-nurock-slate whitespace-nowrap">
                Adjustments
              </th>
              <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider font-display text-nurock-slate whitespace-nowrap border-r border-nurock-border">
                Revised
              </th>
              <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider font-display text-amber-700 whitespace-nowrap border-l border-nurock-border">
                Active Draft
              </th>
              <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider font-display text-nurock-navy whitespace-nowrap border-l border-nurock-border bg-nurock-navy/[0.03]">
                Drawn to Date
              </th>
              <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider font-display text-nurock-slate whitespace-nowrap border-l border-nurock-border">
                Remaining
              </th>
              <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider font-display text-nurock-slate whitespace-nowrap">
                % Drawn
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <SourceRowRender key={r.rowId} row={r} />
            ))}
            <tr className="border-t-2 border-nurock-navy bg-nurock-navy/5">
              <td className="px-3 py-3 text-[10px] uppercase tracking-wider font-display text-nurock-navy font-bold">
                Total Sources
              </td>
              <td className="px-3 py-3 text-right font-mono text-nurock-navy font-bold whitespace-nowrap">
                {formatCurrency(totals.original, 2)}
              </td>
              <td className="px-3 py-3 text-right font-mono whitespace-nowrap">
                {totals.adjustments === 0 ? (
                  <span className="text-nurock-slate-light">—</span>
                ) : (
                  formatCurrency(totals.adjustments, 2)
                )}
              </td>
              <td className="px-3 py-3 text-right font-mono text-nurock-navy font-bold whitespace-nowrap border-r border-nurock-border">
                {formatCurrency(totals.revised, 2)}
              </td>
              <td className="px-3 py-3 text-right font-mono text-amber-700 whitespace-nowrap border-l border-nurock-border">
                {totals.activeDraft === 0
                  ? "—"
                  : formatCurrency(totals.activeDraft, 2)}
              </td>
              <td className="px-3 py-3 text-right font-mono text-nurock-navy font-bold whitespace-nowrap border-l border-nurock-border bg-nurock-navy/[0.03]">
                {incurred === 0 ? "—" : formatCurrency(incurred, 2)}
              </td>
              <td className="px-3 py-3 text-right font-mono text-emerald-700 font-bold whitespace-nowrap border-l border-nurock-border">
                {formatCurrency(totals.remaining, 2)}
              </td>
              <td className="px-3 py-3 text-right font-mono text-xs whitespace-nowrap text-nurock-slate">
                {pctDrawn.toFixed(2)}%
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function SourceRowRender({ row }: { row: SourceDisplayRow }) {
  const incurred = row.drawnToDate + row.activeDraft;
  const remaining = row.revised - incurred;
  const pct = row.revised !== 0 ? (incurred / row.revised) * 100 : 0;

  const balanceColor =
    remaining < 0
      ? "text-red-700"
      : Math.abs(remaining) < Math.abs(row.revised) * 0.1 && row.revised > 0
        ? "text-amber-700"
        : "text-nurock-slate";

  const isPayoff = row.isPayoff;
  const isEquitySplit =
    row.role === "equity_during" || row.role === "equity_post";

  return (
    <tr
      className={`border-b border-nurock-border ${
        isPayoff
          ? "bg-red-50/30 hover:bg-red-50/60"
          : isEquitySplit
            ? "bg-emerald-50/20 hover:bg-emerald-50/40"
            : "hover:bg-nurock-gray/10"
      }`}
    >
      <td className="px-3 py-2 text-nurock-black">
        <div
          className={
            isPayoff
              ? "italic text-nurock-slate"
              : isEquitySplit
                ? "text-nurock-black"
                : "font-medium"
          }
        >
          {row.displayName}
          {row.isEstimatedSplit && (
            <span
              className="ml-1.5 inline-block align-middle text-[9px] uppercase tracking-wider font-display text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded"
              title="Default 25%/75% split — pay-in schedule not yet captured on the underwriting model"
            >
              est
            </span>
          )}
        </div>
        {row.lenderName && !isPayoff && (
          <div className="text-[11px] text-nurock-slate-light">
            {row.lenderName}
          </div>
        )}
      </td>
      <td
        className={`px-3 py-2 text-right font-mono whitespace-nowrap ${
          row.original < 0 ? "text-red-700" : ""
        }`}
      >
        {formatCurrency(row.original, 2)}
      </td>
      <td className="px-3 py-2 text-right font-mono whitespace-nowrap">
        {row.adjustments === 0 ? (
          <span className="text-nurock-slate-light">—</span>
        ) : (
          formatCurrency(row.adjustments, 2)
        )}
      </td>
      <td
        className={`px-3 py-2 text-right font-mono whitespace-nowrap font-medium border-r border-nurock-border ${
          row.revised < 0 ? "text-red-700" : ""
        }`}
      >
        {formatCurrency(row.revised, 2)}
      </td>
      <td className="px-3 py-2 text-right font-mono text-amber-700 whitespace-nowrap border-l border-nurock-border">
        {row.activeDraft === 0 ? "—" : formatCurrency(row.activeDraft, 2)}
      </td>
      <td className="px-3 py-2 text-right font-mono text-nurock-navy font-medium whitespace-nowrap border-l border-nurock-border bg-nurock-navy/[0.03]">
        {incurred === 0 ? "—" : formatCurrency(incurred, 2)}
      </td>
      <td
        className={`px-3 py-2 text-right font-mono whitespace-nowrap border-l border-nurock-border ${balanceColor}`}
      >
        {formatCurrency(remaining, 2)}
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs whitespace-nowrap text-nurock-slate-light">
        {row.revised === 0 ? "—" : pct.toFixed(2) + "%"}
      </td>
    </tr>
  );
}
