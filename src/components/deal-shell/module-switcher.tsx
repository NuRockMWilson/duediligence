"use client";

// =============================================================================
// ModuleSwitcher (devmgmt side)
// =============================================================================
// Mirror of nurock-underwriting/components/ModuleSwitcher.tsx. The two files
// implement the SAME contract documented in docs/shell.md — if you change one,
// change the other.
//
//   Underwriting → Development (active here) → Cost Cert (soon)
//
// Active = Development (this app). Cross-app links to Underwriting via
// NEXT_PUBLIC_UNDERWRITING_URL, with section preservation (cert-prep → UW's
// cost-cert tab).
// =============================================================================

import { ChevronRight } from "lucide-react";
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
 * Derive the deep-link tab on the UW side from the current devmgmt path.
 * If you're on cert-prep, send the user to UW's Cost Cert tab.
 * Otherwise, no specific tab — UW lands on its default tab.
 */
function uwSectionFromPath(pathname: string): string | null {
  if (pathname.includes("/cert-prep")) return "cost-cert";
  return null;
}

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

  // IMPORTANT: <button> and <a> elements don't inherit text-transform from
  // a parent div in Chrome's UA stylesheet — each chip needs its own
  // `uppercase` class. Without it the active button renders sentence-case
  // even though the parent has `uppercase`.
  return (
    <div className="flex items-center gap-0.5 text-[10px] font-display tracking-wider whitespace-nowrap">
      {/* Underwriting — cross-app live link */}
      <ChipLink
        label="Underwriting"
        href={uwUrl}
        disabledTitle="Select a deal first to navigate cross-module"
        liveTitle="Open this deal in the Underwriting module"
      />

      <ChevronRight className="w-3 h-3 text-white/20 mx-0.5" aria-hidden />

      {/* Development — cross-app live link to dev-mgmt */}
      <ChipLink
        label="Development"
        href={devUrl}
        disabledTitle="Select a deal first to navigate cross-module"
        liveTitle="Open this deal in the Development module"
      />

      <ChevronRight className="w-3 h-3 text-white/20 mx-0.5" aria-hidden />

      {/* Diligence — active (this app) */}
      <button
        type="button"
        className="px-2.5 py-1 rounded bg-nurock-tan text-nurock-navy-dark font-semibold cursor-default uppercase tracking-wider"
        title="Diligence module — currently active"
        aria-current="page"
      >
        Diligence
      </button>

      <ChevronRight className="w-3 h-3 text-white/20 mx-0.5" aria-hidden />

      {/* Cost Cert — coming soon */}
      <button
        type="button"
        disabled
        className="px-2.5 py-1 rounded bg-white/5 text-white/40 border border-white/10 cursor-not-allowed flex items-center gap-1.5 uppercase tracking-wider"
        title="Cost Cert module — coming soon"
      >
        <span>Cost Cert</span>
        <span className="text-[8px] tracking-widest text-nurock-tan">Soon</span>
      </button>
    </div>
  );
}

function ChipLink({
  label,
  href,
  disabledTitle,
  liveTitle,
}: {
  label: string;
  href: string | null;
  disabledTitle: string;
  liveTitle: string;
}) {
  if (href) {
    return (
      <a
        href={href}
        className="px-2.5 py-1 rounded bg-white/5 hover:bg-white/15 text-white/85 hover:text-white border border-white/10 hover:border-white/30 transition-colors uppercase tracking-wider"
        title={liveTitle}
      >
        {label}
      </a>
    );
  }
  return (
    <button
      type="button"
      disabled
      className="px-2.5 py-1 rounded bg-white/5 text-white/40 border border-white/10 cursor-not-allowed uppercase tracking-wider"
      title={disabledTitle}
    >
      {label}
    </button>
  );
}
