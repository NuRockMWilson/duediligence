"use client";

// =============================================================================
// ModuleSwitcher (diligence side)
// =============================================================================
// Mirror of nurock-underwriting/components/ModuleSwitcher.tsx — the SAME shell
// contract (docs/shell.md §2): the ACTIVE module shows icon + label on a tan
// pill; every other module collapses to an icon-only square with a tooltip, so
// the switcher stays compact. If you change the switcher here, change the UW +
// devmgmt copies too.
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
  "flex items-center justify-center w-8 h-8 rounded transition-colors";

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
      {/* Underwriting — icon-only cross-app link. */}
      <ModuleIcon
        Icon={Calculator}
        href={uwUrl}
        liveTitle="Open this deal in the Underwriting module"
        disabledTitle="Underwriting — select a deal first to navigate cross-module"
      />

      {/* Development — icon-only cross-app link to dev-mgmt. */}
      <ModuleIcon
        Icon={Building2}
        href={devUrl}
        liveTitle="Open this deal in the Development module"
        disabledTitle="Development — select a deal first to navigate cross-module"
      />

      {/* Diligence — active (this app): icon + label on the tan pill. */}
      <button
        type="button"
        className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-nurock-tan text-nurock-navy-dark font-semibold cursor-default uppercase tracking-wider text-[10px]"
        title="Diligence module — currently active"
        aria-current="page"
      >
        <ClipboardCheck className="w-3.5 h-3.5" aria-hidden />
        <span>Diligence</span>
      </button>

      {/* Cost Cert — coming soon (icon-only, disabled). */}
      <button
        type="button"
        disabled
        className={`${ICON_BOX} bg-white/5 text-white/30 border border-white/10 cursor-not-allowed`}
        title="Cost Cert module — coming soon"
        aria-label="Cost Cert — coming soon"
      >
        <FileCheck2 className="w-3.5 h-3.5" aria-hidden />
      </button>
    </div>
  );
}

// Icon-only chip for a non-active module — links cross-app when a deal is
// selected, else renders disabled with a tooltip.
function ModuleIcon({
  Icon,
  href,
  liveTitle,
  disabledTitle,
}: {
  Icon: typeof Calculator;
  href: string | null;
  liveTitle: string;
  disabledTitle: string;
}) {
  if (href) {
    return (
      <a
        href={href}
        className={`${ICON_BOX} bg-white/5 hover:bg-white/15 text-white/85 hover:text-white border border-white/10 hover:border-white/30`}
        title={liveTitle}
        aria-label={liveTitle}
      >
        <Icon className="w-3.5 h-3.5" aria-hidden />
      </a>
    );
  }
  return (
    <button
      type="button"
      disabled
      className={`${ICON_BOX} bg-white/5 text-white/40 border border-white/10 cursor-not-allowed`}
      title={disabledTitle}
      aria-label={disabledTitle}
    >
      <Icon className="w-3.5 h-3.5" aria-hidden />
    </button>
  );
}
