"use client";

// =============================================================================
// OrphanPanel — Phase 8.12
// -----------------------------------------------------------------------------
// Lists every UW line description that appears in any deal's constructionBudget
// but isn't yet mapped to an Excel row. Each orphan shows occurrence count +
// affected deals; clicking "Map to row…" opens a dropdown of all 32 rows for
// instant assignment.
// =============================================================================

import * as React from "react";
import { AlertCircle, ChevronDown, Check } from "lucide-react";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/nurock-ui";
import { addUwDescription } from "@/lib/data/excel-aggregation-mapping-actions";
import type {
  ExcelMappingRow,
  OrphanUwDescription,
} from "@/lib/data/excel-aggregation-mapping";

export function OrphanPanel({
  orphans,
  mappingRows,
}: {
  orphans: OrphanUwDescription[];
  mappingRows: ExcelMappingRow[];
}) {
  const [toast, setToast] = React.useState<{ kind: "ok" | "error"; message: string } | null>(
    null
  );

  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  if (orphans.length === 0) {
    return (
      <Card className="mb-5 border-green-200">
        <CardBody className="py-4">
          <div className="flex items-start gap-3">
            <Check className="mt-0.5 h-5 w-5 flex-shrink-0 text-green-600" />
            <div>
              <div className="font-display text-[13px] font-semibold text-green-900">
                No orphan UW descriptions
              </div>
              <div className="mt-0.5 text-[11.5px] text-green-800">
                Every UW line across every deal is mapped to a row in the 32-row standard.
              </div>
            </div>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card className="mb-5 border-amber-200">
      <CardHeader>
        <CardTitle
          subtitle={`${orphans.length} UW description${orphans.length === 1 ? "" : "s"} appear in deals but aren't mapped to any Excel row`}
        >
          Unmapped UW Descriptions
        </CardTitle>
        <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 font-display text-[10px] font-semibold uppercase tracking-[0.06em] text-amber-900">
          {orphans.length}
        </span>
      </CardHeader>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr>
              <th className="whitespace-nowrap border-b border-[#E4E7EC] bg-[#FAFBFC] px-3 py-2.5 text-left font-display text-[10px] font-semibold uppercase tracking-[0.08em] text-nurock-slate">
                UW Description
              </th>
              <th className="whitespace-nowrap border-b border-[#E4E7EC] bg-[#FAFBFC] px-3 py-2.5 text-right font-display text-[10px] font-semibold uppercase tracking-[0.08em] text-nurock-slate">
                Occurrences
              </th>
              <th className="whitespace-nowrap border-b border-[#E4E7EC] bg-[#FAFBFC] px-3 py-2.5 text-left font-display text-[10px] font-semibold uppercase tracking-[0.08em] text-nurock-slate">
                Affected Deals
              </th>
              <th className="whitespace-nowrap border-b border-[#E4E7EC] bg-[#FAFBFC] px-3 py-2.5 text-right font-display text-[10px] font-semibold uppercase tracking-[0.08em] text-nurock-slate">
                Map to Row
              </th>
            </tr>
          </thead>
          <tbody>
            {orphans.map((orphan) => (
              <OrphanRow
                key={orphan.description}
                orphan={orphan}
                mappingRows={mappingRows}
                onToast={setToast}
              />
            ))}
          </tbody>
        </table>
      </div>

      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-start gap-2 rounded-lg border px-4 py-3 shadow-lg ${
            toast.kind === "ok"
              ? "border-green-200 bg-green-50 text-green-900"
              : "border-red-200 bg-red-50 text-red-900"
          }`}
        >
          {toast.kind === "ok" ? (
            <Check className="mt-0.5 h-4 w-4 flex-shrink-0" />
          ) : (
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          )}
          <div className="text-[12px] leading-relaxed">{toast.message}</div>
        </div>
      )}
    </Card>
  );
}

// -----------------------------------------------------------------------------
// Single orphan row
// -----------------------------------------------------------------------------

function OrphanRow({
  orphan,
  mappingRows,
  onToast,
}: {
  orphan: OrphanUwDescription;
  mappingRows: ExcelMappingRow[];
  onToast: (t: { kind: "ok" | "error"; message: string }) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Close dropdown on outside click.
  React.useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const handleMap = (row: ExcelMappingRow) => {
    setOpen(false);
    startTransition(async () => {
      const result = await addUwDescription(row.excel_item_number, orphan.description);
      if (result.ok) {
        onToast({
          kind: "ok",
          message: `Mapped "${orphan.description}" → Row ${row.excel_item_number} (${row.excel_description}).`,
        });
      } else {
        onToast({ kind: "error", message: result.error });
      }
    });
  };

  return (
    <tr className="border-b border-[#E4E7EC] hover:bg-[#FAFBFC]">
      <td className="px-3 py-2 font-mono text-[11.5px] text-nurock-black">{orphan.description}</td>
      <td className="px-3 py-2 text-right font-mono tabular-nums text-[12px]">
        {orphan.occurrences.toLocaleString("en-US")}
      </td>
      <td className="px-3 py-2 text-[11.5px] text-[#475467]">
        {orphan.affected_deals.map((d) => d.deal_name).join(", ")}
      </td>
      <td className="px-3 py-2 text-right">
        <div ref={containerRef} className="relative inline-block">
          <button
            onClick={() => setOpen((v) => !v)}
            disabled={isPending}
            className="inline-flex items-center gap-1 rounded-md border border-nurock-navy bg-nurock-navy px-2.5 py-1 font-display text-[10px] font-semibold uppercase tracking-[0.06em] text-white hover:bg-nurock-navy-dark disabled:opacity-50"
          >
            {isPending ? "Mapping…" : "Map to row…"}
            <ChevronDown className="h-3 w-3" />
          </button>
          {open && (
            <div className="absolute right-0 z-20 mt-1 max-h-[400px] w-[360px] overflow-y-auto rounded-md border border-[#E4E7EC] bg-white shadow-lg">
              <SectionDivider label="Soft Costs · Rows 1–27" />
              {mappingRows
                .filter((r) => r.excel_section === "soft_costs")
                .map((row) => (
                  <RowPickerItem key={row.excel_item_number} row={row} onClick={() => handleMap(row)} />
                ))}
              <SectionDivider label="Construction Contract · Rows 28–32" />
              {mappingRows
                .filter((r) => r.excel_section === "construction_contract")
                .map((row) => (
                  <RowPickerItem key={row.excel_item_number} row={row} onClick={() => handleMap(row)} />
                ))}
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="border-b border-[#E4E7EC] bg-[#F4F4F4] px-3 py-1.5 font-display text-[9px] font-semibold uppercase tracking-[0.08em] text-[#667085]">
      {label}
    </div>
  );
}

function RowPickerItem({ row, onClick }: { row: ExcelMappingRow; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2 border-b border-[#F4F4F4] px-3 py-1.5 text-left text-[12px] hover:bg-[#FAFBFC]"
    >
      <span className="font-mono tabular-nums text-[#667085] w-6">{row.excel_item_number}</span>
      <span className="flex-1 text-nurock-black">{row.excel_description}</span>
      {row.split_fraction !== null && (
        <span className="font-mono tabular-nums text-[10px] text-[#667085]">
          {(row.split_fraction * 100).toFixed(2)}%
        </span>
      )}
    </button>
  );
}
