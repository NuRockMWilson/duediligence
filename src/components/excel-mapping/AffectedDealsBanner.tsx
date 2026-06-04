"use client";

// =============================================================================
// AffectedDealsBanner — Phase 8.12
// -----------------------------------------------------------------------------
// Amber banner displayed at the top of the Mapping Settings page when one or
// more deals are out of sync with the current mapping. Single click triggers
// bulkRealignAffectedDeals(), which loops realign_deal_to_excel_format across
// every affected deal. Manual overrides survive (v7 realign).
// =============================================================================

import * as React from "react";
import { AlertTriangle, Check, Loader2, X } from "lucide-react";
import { bulkRealignAffectedDeals } from "@/lib/data/excel-aggregation-mapping-actions";
import type {
  DealAffectedByMapping,
  BulkRealignResult,
} from "@/lib/data/excel-aggregation-mapping";

export function AffectedDealsBanner({
  affectedDeals,
}: {
  affectedDeals: DealAffectedByMapping[];
}) {
  const [dismissed, setDismissed] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();
  const [result, setResult] = React.useState<BulkRealignResult | null>(null);

  if (dismissed) return null;
  if (affectedDeals.length === 0 && !result) return null;

  // Post-realign success view.
  if (result) {
    return (
      <div className="mb-5 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
        <div className="flex items-start gap-3">
          <Check className="mt-0.5 h-5 w-5 flex-shrink-0 text-green-700" />
          <div className="flex-1">
            <div className="font-display text-[13px] font-semibold text-green-900">
              {result.succeeded.length} deal{result.succeeded.length === 1 ? "" : "s"} realigned
            </div>
            <div className="mt-0.5 text-[11.5px] leading-relaxed text-green-800">
              {result.succeeded.length > 0 && (
                <>
                  Realigned: {result.succeeded.map((d) => d.deal_name).join(", ")}.{" "}
                  Manual budget overrides were preserved.
                </>
              )}
              {result.failed.length > 0 && (
                <div className="mt-1 text-amber-800">
                  Skipped or failed: {result.failed.map((d) => `${d.deal_name} (${d.error})`).join("; ")}
                </div>
              )}
            </div>
          </div>
          <button
            onClick={() => {
              setDismissed(true);
              setResult(null);
            }}
            className="rounded p-1 text-green-700 hover:bg-green-100"
            title="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  // Pre-realign warning view.
  const dealCount = affectedDeals.length;
  const variance = affectedDeals.reduce((sum, d) => sum + (d.total_variance ?? 0), 0);

  return (
    <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-700" />
        <div className="flex-1">
          <div className="font-display text-[13px] font-semibold text-amber-900">
            {dealCount} deal{dealCount === 1 ? "" : "s"} out of sync with the current mapping
          </div>
          <div className="mt-0.5 text-[11.5px] leading-relaxed text-amber-800">
            Total variance across affected deals:{" "}
            <span className="font-mono tabular-nums">
              ${variance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            . Affected: {affectedDeals.map((d) => d.deal_name).join(", ")}. Manual overrides will
            be preserved.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              startTransition(async () => {
                const r = await bulkRealignAffectedDeals();
                setResult(r);
              });
            }}
            disabled={isPending}
            className="flex items-center gap-1.5 rounded-md bg-amber-700 px-3 py-1.5 font-display text-[11px] font-semibold uppercase tracking-[0.06em] text-white shadow-sm hover:bg-amber-800 disabled:opacity-60"
          >
            {isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Realigning…
              </>
            ) : (
              <>Realign {dealCount} Deal{dealCount === 1 ? "" : "s"} Now</>
            )}
          </button>
          <button
            onClick={() => setDismissed(true)}
            className="rounded p-1 text-amber-700 hover:bg-amber-100"
            title="Dismiss until next change"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
