"use client";

// =============================================================================
// Portfolio export buttons (Phase 7 r3)
// =============================================================================
// CSV + branded PDF export of the cross-deal portfolio summary. Lives in the
// deals-page header. Server actions return the { base64, filename, mime }
// envelope; triggerDownload streams the file.
// =============================================================================

import { useTransition } from "react";
import { toast } from "sonner";
import { Download, FileText } from "lucide-react";
import { exportPortfolioCsv, exportPortfolioPdf } from "../actions";
import { triggerDownload } from "@/lib/export/download";

export function PortfolioExportButtons() {
  const [isCsv, startCsv] = useTransition();
  const [isPdf, startPdf] = useTransition();

  const runCsv = () =>
    startCsv(async () => {
      try {
        const res = await exportPortfolioCsv();
        if ("error" in res) {
          toast.error(`Export failed: ${res.error}`);
          return;
        }
        triggerDownload(res);
        toast.success("Portfolio summary exported to CSV");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Export failed");
      }
    });

  const runPdf = () =>
    startPdf(async () => {
      try {
        const res = await exportPortfolioPdf();
        if ("error" in res) {
          toast.error(`Report failed: ${res.error}`);
          return;
        }
        triggerDownload(res);
        toast.success("Portfolio report generated");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Report failed");
      }
    });

  return (
    <>
      <button
        onClick={runCsv}
        disabled={isCsv}
        className="inline-flex items-center gap-1.5 rounded-md border border-nurock-border bg-white px-3 py-1.5 text-[12px] font-medium shadow-sm hover:bg-nurock-gray text-nurock-navy disabled:opacity-60 disabled:cursor-not-allowed"
        title="Export the cross-deal portfolio summary to CSV"
      >
        <Download className="h-3.5 w-3.5" />
        {isCsv ? "Exporting…" : "Export CSV"}
      </button>
      <button
        onClick={runPdf}
        disabled={isPdf}
        className="inline-flex items-center gap-1.5 rounded-md border border-nurock-border bg-white px-3 py-1.5 text-[12px] font-medium shadow-sm hover:bg-nurock-gray text-nurock-navy disabled:opacity-60 disabled:cursor-not-allowed"
        title="Download the branded portfolio summary report (PDF)"
      >
        <FileText className="h-3.5 w-3.5" />
        {isPdf ? "Generating…" : "Portfolio Report"}
      </button>
    </>
  );
}
