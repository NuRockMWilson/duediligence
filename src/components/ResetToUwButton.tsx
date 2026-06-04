"use client";

// ============================================================================
// Phase 8.11c — ResetToUwButton
// ----------------------------------------------------------------------------
// Drop-in button for the draw schedule page. Loads UW lock state and manual-
// override count on mount; renders disabled with a tooltip explanation if UW
// is locked. On click, shows a confirmation modal that names how many manual
// overrides will be discarded. Calls the server action on confirm and invokes
// `onResetComplete` so the parent can re-fetch the schedule.
//
// Usage:
//
//   <ResetToUwButton
//     dealId={deal.id}
//     onResetComplete={() => router.refresh()}
//   />
//
// Style follows NuRock brand tokens: navy hover, tan/amber accent for warning.
// ============================================================================

import { useEffect, useState } from "react";
import { RotateCcw, AlertTriangle, Lock, X } from "lucide-react";
import {
  resetDealBudgetAction,
  getResetPreviewAction,
} from "@/lib/data/reset-deal-actions";

interface Props {
  dealId: string;
  onResetComplete?: () => void;
  /** Override the button label. Defaults to "Reset Budget to UW". */
  label?: string;
  /** Optional className applied to the button element. */
  className?: string;
}

type Phase = "idle" | "confirming" | "submitting" | "success" | "error";

export function ResetToUwButton({ dealId, onResetComplete, label, className }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [uwLocked, setUwLocked] = useState<boolean>(false);
  const [uwLockedAt, setUwLockedAt] = useState<string | null>(null);
  const [overrideCount, setOverrideCount] = useState<number>(0);
  const [resultMessage, setResultMessage] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [loadingPreview, setLoadingPreview] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    setLoadingPreview(true);
    getResetPreviewAction(dealId).then((p) => {
      if (cancelled) return;
      setUwLocked(p.uwLock.locked);
      setUwLockedAt(p.uwLock.lockedAt);
      setOverrideCount(p.manualOverrideCount);
      setLoadingPreview(false);
    }).catch(() => {
      if (!cancelled) setLoadingPreview(false);
    });
    return () => { cancelled = true; };
  }, [dealId]);

  const refreshPreview = async () => {
    const p = await getResetPreviewAction(dealId);
    setUwLocked(p.uwLock.locked);
    setUwLockedAt(p.uwLock.lockedAt);
    setOverrideCount(p.manualOverrideCount);
  };

  const onConfirm = async () => {
    setPhase("submitting");
    setErrorMessage("");
    const result = await resetDealBudgetAction(dealId);
    if (result.success) {
      setResultMessage(result.status ?? "Reset complete.");
      setPhase("success");
      await refreshPreview();
      onResetComplete?.();
    } else {
      setErrorMessage(result.error ?? "Reset failed for an unknown reason.");
      setPhase("error");
    }
  };

  const buttonLabel = label ?? "Reset Budget to UW";

  // -- Button styling ---------------------------------------------------------
  const baseBtn =
    "inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] font-display uppercase tracking-wider transition-colors";

  if (uwLocked) {
    const lockDate = uwLockedAt ? new Date(uwLockedAt).toLocaleDateString() : "earlier";
    return (
      <button
        type="button"
        disabled
        title={`Underwriting locked ${lockDate}. Use Change Orders for budget changes.`}
        className={`${baseBtn} bg-gray-100 border border-gray-200 text-gray-400 cursor-not-allowed ${className ?? ""}`}
      >
        <Lock className="w-3.5 h-3.5" />
        UW Locked
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        disabled={loadingPreview}
        onClick={() => setPhase("confirming")}
        title={
          loadingPreview
            ? "Checking deal state…"
            : overrideCount > 0
            ? `Discard ${overrideCount} manual override${overrideCount === 1 ? "" : "s"} and reset the schedule to the current UW model`
            : "No manual overrides exist; this will still realign every row to the current UW model"
        }
        className={`${baseBtn} bg-white border border-amber-300 text-amber-800 hover:bg-amber-50 hover:border-amber-400 disabled:opacity-50 disabled:cursor-not-allowed ${className ?? ""}`}
      >
        <RotateCcw className="w-3.5 h-3.5" />
        {buttonLabel}
        {overrideCount > 0 && (
          <span className="ml-1 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-amber-500 text-white text-[9px] font-mono">
            {overrideCount}
          </span>
        )}
      </button>

      {phase !== "idle" && (
        <ResetDialog
          phase={phase}
          overrideCount={overrideCount}
          resultMessage={resultMessage}
          errorMessage={errorMessage}
          onConfirm={onConfirm}
          onClose={() => setPhase("idle")}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Confirmation modal
// ---------------------------------------------------------------------------

function ResetDialog({
  phase,
  overrideCount,
  resultMessage,
  errorMessage,
  onConfirm,
  onClose,
}: {
  phase: Phase;
  overrideCount: number;
  resultMessage: string;
  errorMessage: string;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
      onClick={() => phase !== "submitting" && onClose()}
    >
      <div
        className="bg-white rounded-lg max-w-md w-full shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <div className="font-display uppercase tracking-wider text-xs text-nurock-navy">
            Reset Budget to UW Model
          </div>
          {phase !== "submitting" && (
            <button
              type="button"
              onClick={onClose}
              className="text-nurock-slate hover:text-nurock-navy"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="px-5 py-4 text-sm">
          {phase === "confirming" && (
            <div className="space-y-3">
              <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-xs text-amber-900 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <div>
                  This will discard every manual budget override on this deal
                  and realign the schedule to the current underwriting model.
                  Draws, invoices, and change orders attached to schedule lines
                  are <span className="font-semibold">not affected</span> — only
                  the budget amounts change.
                </div>
              </div>
              <div className="text-xs text-nurock-slate">
                Manual overrides to discard: <span className="font-mono font-semibold text-nurock-navy">{overrideCount}</span>
              </div>
              {overrideCount === 0 && (
                <div className="text-xs italic text-nurock-slate">
                  No overrides set — this will still refresh every row from
                  the current UW model.
                </div>
              )}
            </div>
          )}

          {phase === "submitting" && (
            <div className="text-center py-8 text-nurock-slate text-xs">
              Resetting budget and realigning schedule…
            </div>
          )}

          {phase === "success" && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-md p-3 text-xs text-emerald-800">
              {resultMessage}
            </div>
          )}

          {phase === "error" && (
            <div className="bg-rose-50 border border-rose-200 rounded-md p-3 text-xs text-rose-800 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div>{errorMessage}</div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-200">
          {phase === "confirming" && (
            <>
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 rounded text-[11px] font-display uppercase tracking-wider text-nurock-slate hover:text-nurock-navy"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onConfirm}
                className="px-3 py-1.5 rounded text-[11px] font-display uppercase tracking-wider bg-amber-600 text-white hover:bg-amber-700"
              >
                Reset Budget
              </button>
            </>
          )}
          {(phase === "success" || phase === "error") && (
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded text-[11px] font-display uppercase tracking-wider bg-nurock-navy text-white hover:bg-nurock-navy/85"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
