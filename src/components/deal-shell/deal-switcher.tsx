"use client";

// =============================================================================
// DealSwitcher (devmgmt side)
// =============================================================================
// Visual structure mirrors UW's DealSwitcher exactly so row 1 of the navy bar
// looks identical when navigating between modules. UW's button is:
//
//   [stage_dot] <Deal Name> <STAGE> [chevron]
//
// inline horizontally, on a bg-white/10 pill. Devmgmt previously used a
// stacked "ACTIVE PROJECT / Deal Name" layout — that's what made row 1 visibly
// shift between apps. Now identical.
//
// Stage colors come from a small local copy of UW's DEAL_STAGES table so the
// dot color matches. Stages devmgmt doesn't recognize fall back to the
// underwriting-blue dot (the most common stage by far).
// =============================================================================

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { ChevronDown, Check, Search } from "lucide-react";

export interface DealOption {
  id: string;
  name: string;
  stage?: string | null;
}

interface DealSwitcherProps {
  activeDealId: string;
  activeDealName: string;
  /** Stage of the active deal, e.g. "underwriting", "committed", "closed". */
  activeDealStage?: string | null;
  deals: DealOption[];
}

// Mirror of UW DEAL_STAGES (nurock-underwriting/lib/deals.ts). If UW adds
// stages, mirror them here too — keeps cross-app dots aligned.
const STAGE_META: Record<
  string,
  { label: string; color: string }
> = {
  prospect: { label: "Prospect", color: "#9CA3AF" },
  underwriting: { label: "Underwriting", color: "#164576" },
  committed: { label: "Committed", color: "#1E5A94" },
  closed: { label: "Closed", color: "#059669" },
  stabilized: { label: "Stabilized", color: "#10B981" },
  disposed: { label: "Disposed", color: "#B4AE92" },
  dead: { label: "Dead", color: "#DC2626" },
};

function metaFor(stage: string | null | undefined) {
  const key = (stage ?? "underwriting").toLowerCase();
  return STAGE_META[key] ?? STAGE_META.underwriting;
}

export function DealSwitcher({
  activeDealId,
  activeDealName,
  activeDealStage,
  deals,
}: DealSwitcherProps) {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const [open, setOpen] = useState(false);
  // Dropdown filters — default shows ALL deals; search by name + narrow to a
  // single stage.
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const wrapperRef = useRef<HTMLDivElement>(null);
  const stageMeta = metaFor(activeDealStage);

  const q = search.trim().toLowerCase();
  const filteredDeals = useMemo(
    () =>
      deals.filter((d) => {
        if (statusFilter !== "all" && (d.stage ?? "underwriting") !== statusFilter) return false;
        if (!q) return true;
        return d.name.toLowerCase().includes(q);
      }),
    [deals, statusFilter, q]
  );

  // Outside click + Escape to close
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Reset the filters whenever the dropdown closes.
  useEffect(() => {
    if (!open) { setSearch(""); setStatusFilter("all"); }
  }, [open]);

  // Build the target URL for a deal swap: keep the section if the current
  // path is /deals/<id>/<section>, else fall back to the deal's main page.
  function targetFor(dealId: string): string {
    const match = pathname.match(/^\/deals\/[^/]+\/(.+)$/);
    if (match) return `/deals/${encodeURIComponent(dealId)}/${match[1]}`;
    return `/deals/${encodeURIComponent(dealId)}/dashboard`;
  }

  function handlePick(dealId: string) {
    setOpen(false);
    router.push(targetFor(dealId));
  }

  return (
    <div ref={wrapperRef} className="relative">
      {/* Trigger button — byte-for-byte same shape as UW DealSwitcher button.
          See nurock-underwriting/components/DealSwitcher.tsx (search for
          `bg-white/10 hover:bg-white/20`). */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/20 transition-colors text-sm"
        title="Switch deal"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <div
          className="w-2 h-2 rounded-full"
          style={{ background: stageMeta.color }}
        />
        <span className="font-display tracking-wide truncate max-w-[260px]">
          {activeDealName}
        </span>
        <span className="text-[10px] text-white/60 uppercase">
          {stageMeta.label}
        </span>
        <ChevronDown className="w-4 h-4" />
      </button>

      {open && (
        <div
          className="absolute top-full left-0 mt-1 w-72 bg-white text-nurock-black rounded-md shadow-xl border border-nurock-border z-50 overflow-hidden"
          role="listbox"
        >
          <div className="px-3 py-2 border-b border-nurock-border bg-nurock-gray/40">
            <div className="text-[9px] uppercase tracking-wider text-nurock-slate font-display font-semibold">
              Switch Deal
            </div>
          </div>
          {/* Search + status filter — default shows all deals. */}
          <div className="p-2 border-b border-nurock-border space-y-1.5">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-nurock-slate-light pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search deals…"
                className="w-full text-xs rounded border border-nurock-border pl-7 pr-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-nurock-navy"
                autoFocus
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full text-xs rounded border border-nurock-border px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-nurock-navy"
            >
              <option value="all">All statuses ({deals.length})</option>
              {Object.keys(STAGE_META).map((key) => {
                const n = deals.filter((d) => (d.stage ?? "underwriting") === key).length;
                if (n === 0) return null;
                return <option key={key} value={key}>{STAGE_META[key].label} ({n})</option>;
              })}
            </select>
          </div>
          <div className="max-h-[360px] overflow-y-auto">
            {filteredDeals.length === 0 ? (
              <div className="px-3 py-4 text-xs text-nurock-slate-light italic text-center">
                No deals match your filters.
              </div>
            ) : (
              filteredDeals.map((d) => {
                const isActive = d.id === activeDealId;
                const rowMeta = metaFor(d.stage);
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => handlePick(d.id)}
                    className={`w-full px-3 py-2 text-left text-[12px] flex items-center gap-2 transition-colors ${
                      isActive
                        ? "bg-nurock-navy/5 font-semibold text-nurock-navy"
                        : "hover:bg-nurock-gray"
                    }`}
                    role="option"
                    aria-selected={isActive}
                  >
                    <div
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ background: rowMeta.color }}
                    />
                    <span className="truncate flex-1">{d.name}</span>
                    <span className="text-[9px] uppercase text-nurock-slate-light tracking-wider">
                      {rowMeta.label}
                    </span>
                    {isActive && (
                      <Check className="w-3.5 h-3.5 text-nurock-navy flex-shrink-0" />
                    )}
                  </button>
                );
              })
            )}
          </div>
          <a
            href="/deals"
            className="block px-3 py-2 border-t border-nurock-border text-[10px] uppercase tracking-wider font-display text-nurock-slate hover:bg-nurock-gray hover:text-nurock-navy text-center"
          >
            Browse All Deals →
          </a>
        </div>
      )}
    </div>
  );
}
