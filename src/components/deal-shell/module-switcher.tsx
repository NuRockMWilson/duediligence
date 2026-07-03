"use client";

// =============================================================================
// ModuleSwitcher (diligence side)
// =============================================================================
// Mirror of nurock-underwriting/components/ModuleSwitcher.tsx (shell contract,
// docs/shell.md §2, synced across all three apps 2026-07): EVERY module chip
// shows icon + label at md+, and EVERY chip collapses to icon-only (tooltips)
// below md — never a mix. The active module keeps the tan pill for context.
// If you change the switcher here, change the UW + devmgmt copies too.
//
//   Underwriting → Development → Diligence (active here) → Cost Cert (soon)
// =============================================================================

import { Building2, Calculator, ClipboardCheck, FileCheck2 } from "lucide-react";
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

const ICON_BOX =
  "flex items-center justify-center gap-1.5 h-8 px-2 rounded transition-colors text-[10px] font-semibold";
const CHIP_LABEL = "hidden md:inline";

export function ModuleSwitcher({ dealId }: { dealId?: string }) {
  const pathname = usePathname() ?? "";
  const uwTab = uwSectionFromPath(pathname);
  const uwUrl = dealId
    ? `${UNDERWRITING_BASE}/?dealId=${encodeURIComponent(dealId)}${
        uwTab ? `&tab=${uwTab}` : ""
      }`
    : null;
  const devUrl = dealId
    ? `${DEVELOPMENT_BASE}/deals/${encodeURIComponent(dealId)}/dashboard`
    : null;

  return (
    <div className="flex items-center gap-1 font-display uppercase tracking-wider whitespace-nowrap">
      {/* Underwriting — cross-app link. */}
      <ModuleIcon
        Icon={Calculator}
        label="Underwriting"
        href={uwUrl}
        liveTitle="Open this deal in the Underwriting module"
        disabledTitle="Underwriting — select a deal first to navigate cross-module"
      />

      {/* Development — cross-app link to dev-mgmt. */}
      <ModuleIcon
        Icon={Building2}
        label="Development"
        href={devUrl}
        liveTitle="Open this deal in the Development module"
        disabledTitle="Development — select a deal first to navigate cross-module"
      />

      {/* Diligence — active (this app): tan pill for context. */}
      <button
        type="button"
        className="flex items-center gap-1.5 h-8 px-2.5 rounded bg-nurock-tan text-nurock-navy-dark font-semibold cursor-default uppercase tracking-wider text-[10px]"
        title="Diligence module — currently active"
        aria-current="page"
      >
        <ClipboardCheck className="w-3.5 h-3.5" aria-hidden />
        <span className={CHIP_LABEL}>Diligence</span>
      </button>

      {/* Cost Cert — coming soon (disabled). */}
      <button
        type="button"
        disabled
        className={`${ICON_BOX} bg-white/5 text-white/30 border border-white/10 cursor-not-allowed uppercase tracking-wider`}
        title="Cost Cert module — coming soon"
        aria-label="Cost Cert — coming soon"
      >
        <FileCheck2 className="w-3.5 h-3.5" aria-hidden />
        <span className={CHIP_LABEL}>Cost Cert</span>
      </button>
    </div>
  );
}

// Non-active module chip — icon + label (label hides below md so every chip
// collapses together). Links cross-app when a deal is selected, else renders
// disabled with a tooltip.
function ModuleIcon({
  Icon,
  label,
  href,
  liveTitle,
  disabledTitle,
}: {
  Icon: typeof Calculator;
  label: string;
  href: string | null;
  liveTitle: string;
  disabledTitle: string;
}) {
  if (href) {
    return (
      <a
        href={href}
        className={`${ICON_BOX} bg-white/5 hover:bg-white/15 text-white/85 hover:text-white border border-white/10 hover:border-white/30 uppercase tracking-wider`}
        title={liveTitle}
        aria-label={liveTitle}
      >
        <Icon className="w-3.5 h-3.5" aria-hidden />
        <span className={CHIP_LABEL}>{label}</span>
      </a>
    );
  }
  return (
    <button
      type="button"
      disabled
      className={`${ICON_BOX} bg-white/5 text-white/40 border border-white/10 cursor-not-allowed uppercase tracking-wider`}
      title={disabledTitle}
      aria-label={disabledTitle}
    >
      <Icon className="w-3.5 h-3.5" aria-hidden />
      <span className={CHIP_LABEL}>{label}</span>
    </button>
  );
}
