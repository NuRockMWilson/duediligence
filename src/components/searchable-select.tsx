"use client";

import * as React from "react";
import { Search, ChevronDown, Check, X } from "lucide-react";

// ============================================================================
// SearchableSelect — drop-in replacement for <select> with text filtering
// ----------------------------------------------------------------------------
// v3 additions:
//   • SearchableOption.group  — visual section dividers in the dropdown
//   • labelMono prop          — false for non-numeric labels (descriptions)
//   • searchPlaceholder prop  — customize the in-dropdown search input
//
// Sort behavior: options without a group render first (ungrouped). Grouped
// options are sorted by group name alphabetically; within-group order is
// preserved (stable sort) so the caller controls intra-group ordering.
// ============================================================================

export type SearchableOption = {
  key: string;
  label: string;
  subLabel?: string;
  rightHint?: string;
  group?: string;
  searchText?: string;
};

export function SearchableSelect({
  value,
  options,
  onChange,
  placeholder = "Select…",
  disabled = false,
  className = "",
  triggerClassName = "",
  emptyLabel = "No matches",
  allowClear = true,
  labelMono = true,
  searchPlaceholder = "Type to search…",
}: {
  value: string | null;
  options: SearchableOption[];
  onChange: (key: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  emptyLabel?: string;
  allowClear?: boolean;
  labelMono?: boolean;
  searchPlaceholder?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [highlightIdx, setHighlightIdx] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const wrapperRef = React.useRef<HTMLDivElement>(null);

  const selected = React.useMemo(
    () => options.find((o) => o.key === value) ?? null,
    [options, value]
  );

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    let result = options;
    if (q) {
      result = result.filter((o) => {
        const text =
          o.searchText ??
          `${o.label} ${o.subLabel ?? ""} ${o.rightHint ?? ""} ${o.group ?? ""}`;
        return text.toLowerCase().includes(q);
      });
    }
    // Stable sort by group: ungrouped first, then alphabetical group order
    result = [...result].sort((a, b) => {
      const ag = a.group ?? "";
      const bg = b.group ?? "";
      if (ag === bg) return 0;
      if (ag === "") return -1;
      if (bg === "") return 1;
      return ag.localeCompare(bg);
    });
    return result;
  }, [options, query]);

  React.useEffect(() => {
    if (open) {
      setHighlightIdx(0);
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  function pick(key: string) {
    onChange(key);
    setOpen(false);
    setQuery("");
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((i) => Math.min(i + 1, filtered.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const opt = filtered[highlightIdx];
      if (opt) pick(opt.key);
    }
  }

  const labelClass = labelMono ? "font-mono tabular-nums" : "";

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        className={`flex w-full items-center justify-between gap-2 rounded-md border bg-white px-3 py-2 text-left text-[12px] shadow-sm transition-colors ${
          disabled ? "cursor-not-allowed opacity-50" : "hover:border-nurock-navy/40"
        } ${triggerClassName || "border-[#E4E7EC]"}`}
      >
        <span className="min-w-0 flex-1 truncate">
          {selected ? (
            <>
              <span className={`${labelClass} text-nurock-navy`}>
                {selected.label}
              </span>
              {selected.subLabel && (
                <span className="ml-2 text-[#667085]">{selected.subLabel}</span>
              )}
            </>
          ) : (
            <span className="text-[#98A2B3]">{placeholder}</span>
          )}
        </span>
        <div className="flex flex-shrink-0 items-center gap-1">
          {allowClear && value !== null && !disabled && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange(null);
              }}
              className="rounded p-0.5 text-[#98A2B3] hover:bg-nurock-gray hover:text-nurock-black"
            >
              <X className="h-3 w-3" />
            </button>
          )}
          <ChevronDown
            className={`h-3.5 w-3.5 text-[#667085] transition-transform ${open ? "rotate-180" : ""}`}
          />
        </div>
      </button>

      {open && (
        <div className="absolute left-0 right-0 z-50 mt-1 max-h-[400px] overflow-hidden rounded-md border border-[#E4E7EC] bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b border-[#E4E7EC] bg-[#FAFBFC] px-3 py-2">
            <Search className="h-3.5 w-3.5 flex-shrink-0 text-[#98A2B3]" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setHighlightIdx(0);
              }}
              onKeyDown={onKeyDown}
              placeholder={searchPlaceholder}
              className="flex-1 bg-transparent text-[12px] outline-none placeholder:text-[#98A2B3]"
            />
            {query && (
              <span className="text-[10px] text-[#98A2B3]">
                {filtered.length} match{filtered.length === 1 ? "" : "es"}
              </span>
            )}
          </div>

          <div className="max-h-[340px] overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-[12px] text-[#98A2B3]">
                {emptyLabel}
              </div>
            ) : (
              filtered.map((opt, idx) => {
                const isSelected = opt.key === value;
                const isHighlighted = idx === highlightIdx;
                const prevGroup = idx > 0 ? filtered[idx - 1].group : undefined;
                const showGroupHeader = opt.group && opt.group !== prevGroup;
                return (
                  <React.Fragment key={opt.key}>
                    {showGroupHeader && (
                      <div className="px-3 pb-1 pt-2 font-display text-[9.5px] uppercase tracking-[0.06em] text-[#98A2B3] bg-[#FAFBFC] border-t border-[#E4E7EC] first:border-t-0">
                        {opt.group}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => pick(opt.key)}
                      onMouseEnter={() => setHighlightIdx(idx)}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors ${
                        isHighlighted ? "bg-nurock-navy/[0.06]" : ""
                      } ${isSelected ? "font-medium" : ""}`}
                    >
                      <span className="flex-shrink-0 w-3.5">
                        {isSelected && <Check className="h-3.5 w-3.5 text-nurock-navy" />}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        <span className={`${labelClass} ${isSelected ? "text-nurock-navy" : "text-nurock-slate"}`}>
                          {opt.label}
                        </span>
                        {opt.subLabel && (
                          <span className="ml-2 text-[#667085]">{opt.subLabel}</span>
                        )}
                      </span>
                      {opt.rightHint && (
                        <span className="flex-shrink-0 rounded bg-nurock-gray px-1 py-px font-display text-[9px] uppercase tracking-wider text-[#667085]">
                          {opt.rightHint}
                        </span>
                      )}
                    </button>
                  </React.Fragment>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
