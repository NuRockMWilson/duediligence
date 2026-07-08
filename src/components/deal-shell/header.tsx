"use client";

// =============================================================================
// DealHeader — 2-row navy bar, contract-matched to nurock-underwriting
// =============================================================================
// Row 1 (44px): logo + wordmark + module switcher + deal switcher
//               · right cluster: Saved Xs ago + email + SIGN OUT + bell
// Row 2 (44px): KPI chips (TDC / Drawn / Variance / Schedule)
//               · right cluster: PACKAGE + REFRESH + AUDIT
//
// The standalone ⚙ Settings link was removed from row 2 — Settings (and every
// section under it) now lives in the account-menu dropdown (top-right). See
// account-menu.tsx.
//
// Row 1 is BYTE-FOR-BYTE identical to nurock-underwriting/components/Header.tsx
// row 1. Row 2 layout mirrors UW's "KPI strip left, tools cluster right" shape;
// contents differ (devmgmt's KPIs and tools differ from UW's, by design).
// =============================================================================

import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  RefreshCw,
  ScrollText,
} from "lucide-react";
import { formatCurrency, formatCurrencyTerse } from "@/lib/format";
import { ModuleSwitcher } from "./module-switcher";
import { DealSwitcher, type DealOption } from "./deal-switcher";
import AccountMenu from "@/components/account-menu";
import { SaveStatus } from "@/components/save-status";

// Cross-app home target — the Underwriting portfolio dashboard. Absolute URL
// (crosses Vercel deployments); overridable per-env. Mirrors the module switcher.
const UNDERWRITING_URL =
  process.env.NEXT_PUBLIC_UNDERWRITING_URL ?? "https://nurockmodel.vercel.app";

interface DealHeaderProps {
  dealId: string;
  dealName: string;
  dealStage?: string | null;
  /** UW construction-budget total. 0/absent hides the chip (item 5 — never
   *  render a fabricated figure). Drawn/Variance/Schedule props were removed:
   *  those are Dev-module rollups with no data source in this app. */
  totalDevCost: number;
  userEmail: string;
  /** Display name for the account menu (falls back to email). */
  userDisplayName?: string | null;
  /** Whether the current user can manage users — shows Users & Access in the
   *  account menu so org admins reach it from any deal, not just Settings. */
  isOrgAdmin?: boolean;
  deals: DealOption[];
  /** Server-side render timestamp, used as the "last saved" anchor for the
   *  ticker. Re-renders on every revalidatePath, so each server action
   *  effectively resets the displayed save time. */
  savedAt: number;
  /** Server-rendered notifications bell, mounted in the right cluster.
   *  Passed in by the layout because the bell is a server component that
   *  needs to fetch initial items + the current user's id. */
  notificationsBell?: React.ReactNode;
}

export default function DealHeader({
  dealId,
  dealName,
  dealStage,
  totalDevCost,
  userEmail,
  userDisplayName = null,
  isOrgAdmin = false,
  deals,
  savedAt,
  notificationsBell,
}: DealHeaderProps) {

  return (
    <header className="bg-nurock-navy text-white shadow-lg sticky top-0 z-50">
      {/* ============================================================
          ROW 1 — Identity (mirror of UW Header.tsx row 1)
          ============================================================ */}
      <div className="border-b border-white/10">
        <div className="max-w-[1600px] mx-auto px-3 md:px-5 flex items-center justify-between gap-4 min-h-[44px]">
          <div className="flex items-center gap-3 min-w-0">
            {/* P1: logo → HOME = the Underwriting portfolio dashboard. Cross-
                deployment, so an ABSOLUTE URL via a plain anchor (not next/link).
                Keyboard-focusable. */}
            <a
              href={UNDERWRITING_URL}
              title="Go to the portfolio dashboard"
              aria-label="Go to the portfolio dashboard"
              className="flex-shrink-0 rounded transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/nurock-logo-reversed.png"
                alt="NuRock"
                className="h-9 w-auto drop-shadow-sm"
                width={160}
                height={128}
              />
            </a>
            <div className="min-w-0 flex-shrink-0 hidden sm:block">
              <div className="font-display text-sm uppercase tracking-[0.14em] leading-tight">
                NuRock
              </div>
              <div className="text-[10px] text-white/60 tracking-wide leading-tight">
                Development Platform
              </div>
            </div>

            {/* Module switcher + deal switcher BOTH live in row 1 (next to the
                wordmark), matching the underwriting model's top bar so the deal
                context sits in the same place across every module. The deal
                name truncates so it never collides with the right cluster. */}
            <div className="ml-3 pl-3 border-l border-white/15">
              <ModuleSwitcher dealId={dealId} />
            </div>
            <div className="ml-3 pl-3 border-l border-white/15 min-w-0">
              <DealSwitcher
                activeDealId={dealId}
                activeDealName={dealName}
                activeDealStage={dealStage}
                deals={deals}
              />
            </div>
          </div>

          {/* Right cluster — Saved Ns ago · 🔔 · account menu.
              Mirror of UW Header.tsx row 1 right cluster. See docs/shell.md §5.
              The account menu folds the old email + SIGN OUT into one dropdown
              that also surfaces Users & Access for org admins. */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="hidden md:block">
              <SaveStatus savedAt={savedAt} />
            </div>
            <div className="pl-2 ml-1 border-l border-white/15 flex items-center gap-2">
              {notificationsBell}
              <AccountMenu
                email={userEmail}
                displayName={userDisplayName}
                isOrgAdmin={isOrgAdmin}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ============================================================
          LAYER 2 — Contextual project ribbon: project selector (always
          visible, full single line) + module vitals (md+) + tools (md+).
          ============================================================ */}
      <div className="hidden md:flex max-w-[1600px] mx-auto px-3 md:px-5 items-center justify-between gap-3 min-h-[44px]">
        {/* Left — module vitals (KPI chips). The deal switcher moved UP to row 1
            to match the underwriting model; row 2 now carries vitals + tools. */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
          {/* Item 5: only the TDC chip remains, wired to the deal's REAL UW
              construction-budget total (was hardcoded $0). Drawn / Variance /
              Schedule are Dev-module operational rollups with no data source
              in this app — permanently dash-valued chips were removed rather
              than fabricated. Full draw metrics live in the Development
              module (one click via the module switcher).

              Source: deals.model — the last PROMOTED UW baseline. Downstream
              modules intentionally read the promoted snapshot, never the UW
              app's working draft, so this can lag the UW model header until
              pending changes are promoted through the pipeline. */}
          {totalDevCost > 0 && (
            <HudChip
              label="TDC"
              value={formatCurrencyTerse(totalDevCost)}
              title={`Total Development Cost from the last promoted UW baseline: ${formatCurrency(totalDevCost)}. The UW model's working draft may differ until its pending changes are promoted.`}
              tone="neutral"
            />
          )}
          </div>
        </div>

        {/* Right — Tools cluster (md+). Mirror of UW row 2's
            RATES/HUD/LOG/VERSIONS cluster shape. See docs/shell.md §6. */}
        <div className="hidden md:flex">
          <ToolsCluster dealId={dealId} />
        </div>
      </div>
    </header>
  );
}

// =============================================================================
// ToolsCluster — devmgmt row 2 tools (mirror of UW IconBtn cluster)
// =============================================================================
function ToolsCluster({ dealId }: { dealId: string }) {
  const router = useRouter();
  return (
    <div className="flex items-center gap-1.5 flex-shrink-0">
      {/* BUG-FIX: the "Draw Package" → /deals/{id}/active-draw link was inherited
          from the devmgmt fork, but active-draw is a Development-module route and
          404s here (its <Link> prefetch caused the leaked 404 on every Diligence
          deal page). Draws aren't a Diligence workflow; cross-module access to
          Development is already provided by the ModuleSwitcher (absolute URL). */}
      <IconBtn
        icon={<RefreshCw className="w-3.5 h-3.5" />}
        label="Refresh"
        onClick={() => router.refresh()}
        title="Refresh data from the server"
      />
      {/* Item 6: the audit trail is live — status changes, sign-offs,
          document links, imports, and packet events (migration 0098). */}
      <Link
        href={`/deals/${dealId}/audit`}
        className="h-8 px-2.5 rounded bg-white/10 hover:bg-white/20 transition-colors flex items-center gap-1 text-[10px] uppercase tracking-wider font-display text-white"
        title="Audit trail — every status change, sign-off, document link, import, and packet event"
      >
        <ScrollText className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Audit</span>
      </Link>
      {/* The ⚙ Settings link was removed here — Settings now lives in the
          account-menu dropdown (top-right). */}
    </div>
  );
}

function IconBtn({
  icon,
  label,
  onClick,
  disabled,
  title,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="h-8 px-2.5 rounded bg-white/10 hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1 text-[10px] uppercase tracking-wider font-display text-white"
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function HudChip({
  label,
  value,
  sub,
  tone,
  title,
}: {
  label: string;
  value: string;
  sub?: string;
  tone: "neutral" | "emerald" | "amber";
  title?: string;
}) {
  // Byte-for-byte mirror of UW HudPill (nurock-underwriting/components/
  // Header.tsx). Same outer classes (px-2 py-1 rounded border whitespace-nowrap),
  // same inner structure (single leading-tight wrapper holding label + value),
  // same text sizes (8px/11px), same font weights (display 500, mono bold).
  // Closes the "chips feel chunkier" visual delta the user reported.
  const styles =
    tone === "emerald"
      ? "bg-emerald-500/15 border-emerald-400/30 text-emerald-200"
      : tone === "amber"
      ? "bg-amber-500/15 border-amber-400/30 text-amber-200"
      : "bg-white/5 border-white/10 text-nurock-tan";

  const subTone =
    tone === "emerald"
      ? "text-emerald-300/70"
      : tone === "amber"
      ? "text-amber-300/70"
      : "text-white/50";

  return (
    <div
      className={`flex items-center gap-1.5 px-2 py-1 rounded border whitespace-nowrap ${styles}`}
      title={title}
    >
      <div className="leading-tight">
        <div className="text-[8px] uppercase tracking-widest opacity-70 font-display">
          {label}
        </div>
        <div className="text-[11px] font-mono font-bold tabular-nums">
          {value}
          {sub && <span className={`text-[9px] ml-1 ${subTone}`}>{sub}</span>}
        </div>
      </div>
    </div>
  );
}
