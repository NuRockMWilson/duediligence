"use client";

// =============================================================================
// ModuleSwitcher (diligence side)
// =============================================================================
// Mirror of nurock-underwriting/components/ModuleSwitcher.tsx (shell contract,
// docs/shell.md §2, synced across all three apps). CURRENT PATTERN (2026-07
// crowding fix): a SINGLE compact trigger shows only the active module
// (icon + label on the tan pill + chevron, ~130px); clicking opens a dropdown
// listing every module with a full label — same spirit as the deal switcher
// beside it. This replaced the four-chip all-labeled row (~402px), which fixed
// discoverability but crowded 1280–1440px headers. If you change the switcher
// here, change the UW + devmgmt copies too.
//
//   Underwriting → Development → Diligence (active here) → Cost Cert (soon)
// =============================================================================

import * as React from "react";
import {
  Building2,
  Calculator,
  ChevronDown,
  ClipboardCheck,
  FileCheck2,
} from "lucide-react";
import { usePathname } from "next/navigation";

export type ModuleKey =
  | "underwriting"
  | "development"
  | "diligence"
  | "cost_cert";
export type ModuleStatus = "active" | "live" | "soon";

// Canonical UW deployment (NuRockModel → nurockmodel.vercel.app). Override via
// NEXT_PUBLIC_UNDERWRITING_URL.
const UNDERWRITING_BASE =
  process.env.NEXT_PUBLIC_UNDERWRITING_URL ?? "https://nurockmodel.vercel.app";

// Dev-mgmt deployment (nurock-devmgmt.vercel.app). Override via
// NEXT_PUBLIC_DEVMGMT_URL.
const DEVELOPMENT_BASE =
  process.env.NEXT_PUBLIC_DEVMGMT_URL ?? "https://nurock-devmgmt.vercel.app";

/**
 * Derive the deep-link tab on the UW side from the current path.
 * cert-prep → UW's Cost Cert tab; otherwise UW lands on its default tab.
 */
function uwSectionFromPath(pathname: string): string | null {
  if (pathname.includes("/cert-prep")) return "cost-cert";
  return null;
}

interface MenuModule {
  key: ModuleKey;
  label: string;
  Icon: typeof Calculator;
  /** null href + not active = disabled row (reason in `note`). */
  href: string | null;
  active: boolean;
  note?: string;
}

export function ModuleSwitcher({ dealId }: { dealId?: string }) {
  const pathname = usePathname() ?? "";
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef<HTMLDivElement>(null);

  // Outside click + Escape close the menu (same pattern as the header's
  // other popovers).
  React.useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const uwTab = uwSectionFromPath(pathname);
  const uwUrl = dealId
    ? `${UNDERWRITING_BASE}/?dealId=${encodeURIComponent(dealId)}${
        uwTab ? `&tab=${uwTab}` : ""
      }`
    : null;
  const devUrl = dealId
    ? `${DEVELOPMENT_BASE}/deals/${encodeURIComponent(dealId)}/dashboard`
    : null;

  const modules: MenuModule[] = [
    {
      key: "underwriting",
      label: "Underwriting",
      Icon: Calculator,
      href: uwUrl,
      active: false,
      note: !dealId ? "Select a deal first" : undefined,
    },
    {
      key: "development",
      label: "Development",
      Icon: Building2,
      href: devUrl,
      active: false,
      note: !dealId ? "Select a deal first" : undefined,
    },
    {
      key: "diligence",
      label: "Diligence",
      Icon: ClipboardCheck,
      href: null,
      active: true,
    },
    {
      key: "cost_cert",
      label: "Cost Cert",
      Icon: FileCheck2,
      href: null,
      active: false,
      note: "Coming soon",
    },
  ];

  return (
    <div ref={wrapRef} className="relative">
      {/* Trigger — the active module on the tan pill (unchanged styling) plus
          a chevron; the other modules live in the menu below. */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 h-8 px-2.5 rounded bg-nurock-tan text-nurock-navy-dark font-display font-semibold uppercase tracking-wider text-[10px] hover:bg-nurock-tan/90 transition-colors whitespace-nowrap"
        title="Diligence module — click to switch modules"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <ClipboardCheck className="w-3.5 h-3.5" aria-hidden />
        <span>Diligence</span>
        <ChevronDown
          className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Switch module"
          className="absolute left-0 top-10 z-50 w-60 rounded-md border border-nurock-border bg-white py-1 shadow-lg"
        >
          {modules.map((m) => {
            const Icon = m.Icon;
            if (m.active) {
              return (
                <div
                  key={m.key}
                  role="menuitem"
                  aria-current="page"
                  className="flex items-center justify-between gap-2 bg-nurock-tan/15 px-3 py-2 text-[11px] font-display font-semibold uppercase tracking-wider text-nurock-navy"
                >
                  <span className="flex items-center gap-2">
                    <Icon className="w-3.5 h-3.5" aria-hidden />
                    {m.label}
                  </span>
                  <span className="text-[9px] text-nurock-slate-light normal-case tracking-normal">
                    Current
                  </span>
                </div>
              );
            }
            if (m.href) {
              return (
                <a
                  key={m.key}
                  role="menuitem"
                  href={m.href}
                  className="flex items-center gap-2 px-3 py-2 text-[11px] font-display font-semibold uppercase tracking-wider text-nurock-black hover:bg-nurock-gray/60"
                  title={`Open this deal in the ${m.label} module`}
                >
                  <Icon className="w-3.5 h-3.5 text-nurock-slate" aria-hidden />
                  {m.label}
                </a>
              );
            }
            return (
              <div
                key={m.key}
                role="menuitem"
                aria-disabled="true"
                className="flex items-center justify-between gap-2 px-3 py-2 text-[11px] font-display font-semibold uppercase tracking-wider text-nurock-slate-light cursor-not-allowed"
                title={m.note ? `${m.label} — ${m.note}` : m.label}
              >
                <span className="flex items-center gap-2">
                  <Icon className="w-3.5 h-3.5" aria-hidden />
                  {m.label}
                </span>
                {m.note && (
                  <span className="text-[9px] normal-case tracking-normal">
                    {m.note}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
