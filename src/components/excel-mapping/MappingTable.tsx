"use client";

// =============================================================================
// MappingTable — Phase 8.12
// -----------------------------------------------------------------------------
// 32-row Excel mapping editor. Click any editable cell to edit; blur saves.
// Description and notes are free text. Split fraction is a percentage editor
// (stored as decimal, displayed as XX.XX%). UW descriptions are pills with
// remove (×) buttons + an inline "Add UW description" composer per row.
//
// Reads excel_item_number + excel_section as read-only (structural).
// Posts to addUwDescription / removeUwDescription / updateRowFields server
// actions defined in lib/data/excel-aggregation-mapping.ts.
// =============================================================================

import * as React from "react";
import { Plus, X, AlertCircle, Check } from "lucide-react";
import { Badge, Card, CardHeader, CardTitle } from "@/components/nurock-ui";
import {
  addUwDescription,
  removeUwDescription,
  updateRowFields,
} from "@/lib/data/excel-aggregation-mapping-actions";
import type { ExcelMappingRow } from "@/lib/data/excel-aggregation-mapping";

type Toast = { kind: "ok" | "error"; message: string } | null;

export function MappingTable({ rows }: { rows: ExcelMappingRow[] }) {
  const [toast, setToast] = React.useState<Toast>(null);

  // Dismiss toast after 4s.
  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const softCosts = rows.filter((r) => r.excel_section === "soft_costs");
  const construction = rows.filter((r) => r.excel_section === "construction_contract");

  return (
    <Card>
      <CardHeader>
        <CardTitle
          subtitle={`${rows.length} rows · click any field to edit · blur saves`}
        >
          32-Row Standard Mapping
        </CardTitle>
        <Badge tone="green">Live</Badge>
      </CardHeader>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr>
              <HeaderCell className="w-[60px]">#</HeaderCell>
              <HeaderCell className="w-[280px]">Excel Description</HeaderCell>
              <HeaderCell className="w-[110px] text-right">Split %</HeaderCell>
              <HeaderCell>UW Descriptions Mapped</HeaderCell>
              <HeaderCell className="w-[240px]">Notes</HeaderCell>
            </tr>
          </thead>
          <tbody>
            <SectionHeader label="Soft Costs · Rows 1–27" colSpan={5} />
            {softCosts.map((row) => (
              <MappingRow key={row.excel_item_number} row={row} onToast={setToast} />
            ))}
            <SectionHeader label="Construction Contract · Rows 28–32" colSpan={5} />
            {construction.map((row) => (
              <MappingRow key={row.excel_item_number} row={row} onToast={setToast} />
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
// Section header
// -----------------------------------------------------------------------------

function SectionHeader({ label, colSpan }: { label: string; colSpan: number }) {
  return (
    <tr className="bg-[#F4F4F4]">
      <td colSpan={colSpan} className="px-3 py-2 font-display text-[10px] font-semibold uppercase tracking-[0.08em] text-nurock-slate">
        {label}
      </td>
    </tr>
  );
}

// -----------------------------------------------------------------------------
// Single row
// -----------------------------------------------------------------------------

function MappingRow({
  row,
  onToast,
}: {
  row: ExcelMappingRow;
  onToast: (t: Toast) => void;
}) {
  const [isPending, startTransition] = React.useTransition();

  return (
    <tr
      data-excel-item-number={row.excel_item_number}
      className="border-b border-[#E4E7EC] hover:bg-[#FAFBFC]"
    >
      <td className="px-3 py-2 font-mono tabular-nums text-[#667085]">{row.excel_item_number}</td>

      {/* Description (editable) */}
      <td className="px-3 py-2">
        <InlineTextEdit
          value={row.excel_description}
          onSave={async (next) => {
            if (next === row.excel_description) return;
            const r = await updateRowFields(row.excel_item_number, { excel_description: next });
            if (r.ok) onToast({ kind: "ok", message: `Row ${row.excel_item_number} description updated.` });
            else onToast({ kind: "error", message: r.error });
          }}
          placeholder="Excel description"
        />
      </td>

      {/* Split fraction (editable, percentage) */}
      <td className="px-3 py-2 text-right">
        <InlineSplitEdit
          value={row.split_fraction}
          onSave={async (next) => {
            if (next === row.split_fraction) return;
            const r = await updateRowFields(row.excel_item_number, { split_fraction: next });
            if (r.ok) onToast({ kind: "ok", message: `Row ${row.excel_item_number} split updated.` });
            else onToast({ kind: "error", message: r.error });
          }}
        />
      </td>

      {/* UW descriptions (pills + add composer) */}
      <td className="px-3 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {(row.uw_descriptions ?? []).map((desc) => (
            <span
              key={desc}
              className="inline-flex items-center gap-1 rounded-md border border-[#E4E7EC] bg-white px-2 py-0.5 font-mono text-[11px] text-nurock-slate"
            >
              <span>{desc}</span>
              <button
                disabled={isPending}
                onClick={() =>
                  startTransition(async () => {
                    const r = await removeUwDescription(row.excel_item_number, desc);
                    if (r.ok)
                      onToast({
                        kind: "ok",
                        message: `Removed "${desc}" from Row ${row.excel_item_number}.`,
                      });
                    else onToast({ kind: "error", message: r.error });
                  })
                }
                className="rounded p-0.5 text-[#98A2B3] hover:bg-red-50 hover:text-red-700"
                title="Remove from this row"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <AddUwDescriptionComposer
            itemNumber={row.excel_item_number}
            onSaved={(desc) =>
              onToast({
                kind: "ok",
                message: `Added "${desc}" to Row ${row.excel_item_number}.`,
              })
            }
            onError={(err) => onToast({ kind: "error", message: err })}
          />
        </div>
      </td>

      {/* Notes (editable, free text) */}
      <td className="px-3 py-2">
        <InlineTextEdit
          value={row.notes ?? ""}
          onSave={async (next) => {
            const normalized = next.trim() === "" ? null : next;
            if (normalized === (row.notes ?? null)) return;
            const r = await updateRowFields(row.excel_item_number, { notes: normalized });
            if (r.ok) onToast({ kind: "ok", message: `Row ${row.excel_item_number} notes updated.` });
            else onToast({ kind: "error", message: r.error });
          }}
          placeholder="Add notes…"
          muted
        />
      </td>
    </tr>
  );
}

// -----------------------------------------------------------------------------
// Inline text editor
// -----------------------------------------------------------------------------

function InlineTextEdit({
  value,
  onSave,
  placeholder,
  muted = false,
}: {
  value: string;
  onSave: (next: string) => Promise<void> | void;
  placeholder?: string;
  muted?: boolean;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => setDraft(value), [value]);
  React.useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={async () => {
          setEditing(false);
          await onSave(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          }
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        placeholder={placeholder}
        className="w-full rounded border border-nurock-navy bg-white px-1.5 py-0.5 text-[12px] outline-none focus:ring-1 focus:ring-nurock-navy"
      />
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className={`w-full rounded px-1.5 py-0.5 text-left text-[12px] hover:bg-[#F4F4F4] ${
        muted && !value ? "text-[#98A2B3] italic" : ""
      }`}
    >
      {value || placeholder || "—"}
    </button>
  );
}

// -----------------------------------------------------------------------------
// Inline split-fraction editor (percent in / decimal out)
// -----------------------------------------------------------------------------

function InlineSplitEdit({
  value,
  onSave,
}: {
  value: number | null;
  onSave: (next: number | null) => Promise<void> | void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value === null ? "" : (value * 100).toFixed(2));
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    setDraft(value === null ? "" : (value * 100).toFixed(2));
  }, [value]);
  React.useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  if (editing) {
    return (
      <div className="flex items-center justify-end gap-1">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={async () => {
            setEditing(false);
            const trimmed = draft.trim();
            if (trimmed === "") {
              await onSave(null);
              return;
            }
            const parsed = parseFloat(trimmed);
            if (Number.isNaN(parsed)) {
              setDraft(value === null ? "" : (value * 100).toFixed(2));
              return;
            }
            const decimal = parsed / 100;
            await onSave(decimal);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setDraft(value === null ? "" : (value * 100).toFixed(2));
              setEditing(false);
            }
          }}
          className="w-16 rounded border border-nurock-navy bg-white px-1.5 py-0.5 text-right font-mono text-[12px] tabular-nums outline-none focus:ring-1 focus:ring-nurock-navy"
        />
        <span className="text-[12px] text-[#667085]">%</span>
      </div>
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="w-full rounded px-1.5 py-0.5 text-right font-mono text-[12px] tabular-nums hover:bg-[#F4F4F4]"
    >
      {value === null ? <span className="text-[#98A2B3]">100.00%</span> : `${(value * 100).toFixed(2)}%`}
    </button>
  );
}

// -----------------------------------------------------------------------------
// Add UW description composer (inline on each row)
// -----------------------------------------------------------------------------

function AddUwDescriptionComposer({
  itemNumber,
  onSaved,
  onError,
}: {
  itemNumber: number;
  onSaved: (desc: string) => void;
  onError: (err: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [isPending, startTransition] = React.useTransition();
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-md border border-dashed border-[#B4AE92] bg-transparent px-2 py-0.5 font-display text-[10px] font-semibold uppercase tracking-[0.06em] text-nurock-tan hover:bg-[#FAFBFC]"
      >
        <Plus className="h-3 w-3" />
        Add UW description
      </button>
    );
  }

  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      setOpen(false);
      setDraft("");
      return;
    }
    startTransition(async () => {
      const r = await addUwDescription(itemNumber, trimmed);
      if (r.ok) {
        onSaved(trimmed);
        setDraft("");
        setOpen(false);
      } else {
        onError(r.error);
      }
    });
  };

  return (
    <div className="inline-flex items-center gap-1">
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setDraft("");
            setOpen(false);
          }
        }}
        placeholder="UW line description"
        disabled={isPending}
        className="w-48 rounded border border-nurock-navy bg-white px-1.5 py-0.5 font-mono text-[11px] outline-none focus:ring-1 focus:ring-nurock-navy"
      />
      <button
        onClick={commit}
        disabled={isPending}
        className="rounded bg-nurock-navy px-2 py-0.5 font-display text-[10px] font-semibold uppercase tracking-[0.06em] text-white hover:bg-nurock-navy-dark disabled:opacity-50"
      >
        Add
      </button>
      <button
        onClick={() => {
          setDraft("");
          setOpen(false);
        }}
        className="rounded px-1 text-[#98A2B3] hover:text-nurock-slate"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Atoms
// -----------------------------------------------------------------------------

function HeaderCell({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`whitespace-nowrap border-b border-[#E4E7EC] bg-[#FAFBFC] px-3 py-2.5 font-display text-[10px] font-semibold uppercase tracking-[0.08em] text-nurock-slate text-left ${className}`}
    >
      {children}
    </th>
  );
}
