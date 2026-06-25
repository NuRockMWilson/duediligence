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
  FileText,
  RefreshCw,
  ScrollText,
} from "lucide-react";
import { formatCurrency, formatCurrencyTerse, formatPercent } from "@/lib/format";
import { ModuleSwitcher } from "./module-switcher";
import { DealSwitcher, type DealOption } from "./deal-switcher";
import AccountMenu from "@/components/account-menu";
import { SaveStatus } from "@/components/save-status";

interface DealHeaderProps {
  dealId: string;
  dealName: string;
  dealStage?: string | null;
  totalDevCost: number;
  drawnAmount?: number | null;
  variance?: number | null;
  scheduleDeltaDays?: number | null;
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
  drawnAmount = null,
  variance = null,
  scheduleDeltaDays = null,
  userEmail,
  userDisplayName = null,
  isOrgAdmin = false,
  deals,
  savedAt,
  notificationsBell,
}: DealHeaderProps) {
  const drawnPct =
    drawnAmount != null && totalDevCost > 0 ? drawnAmount / totalDevCost : null;
  const variancePct =
    variance != null && totalDevCost > 0 ? variance / totalDevCost : null;

  return (
    <header className="bg-nurock-navy text-white shadow-lg sticky top-0 z-50">
      {/* ============================================================
          ROW 1 — Identity (mirror of UW Header.tsx row 1)
          ============================================================ */}
      <div className="border-b border-white/10">
        <div className="max-w-[1600px] mx-auto px-3 md:px-5 flex items-center justify-between gap-4 min-h-[44px]">
          <div className="flex items-center gap-3 min-w-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/nurock-logo-reversed.png"
              alt="NuRock"
              className="h-9 w-auto flex-shrink-0 drop-shadow-sm"
              width={160}
              height={128}
            />
            <div className="min-w-0 flex-shrink-0 hidden sm:block">
              <div className="font-display text-sm uppercase tracking-[0.14em] leading-tight">
                NuRock
              </div>
              <div className="text-[10px] text-white/60 tracking-wide leading-tight">
                Development Platform
              </div>
            </div>

            {/* Module switcher. The deal/project switcher moved DOWN to the
                Layer 2 context ribbon so Layer 1 stays purely global (logo +
                app routing + user utilities) and identical across every module
                — and so the long project name never collides with the right
                cluster. See docs/shell.md (two-layer master shell). */}
            <div className="ml-3 pl-3 border-l border-white/15">
              <ModuleSwitcher dealId={dealId} />
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
      <div className="max-w-[1600px] mx-auto px-3 md:px-5 flex items-center justify-between gap-3 min-h-[44px]">
        {/* Left — project selector + KPI chips (terse currency, md+) */}
        <div className="flex items-center gap-3 min-w-0">
          <DealSwitcher
            activeDealId={dealId}
            activeDealName={dealName}
            activeDealStage={dealStage}
            deals={deals}
          />
          <div className="hidden md:flex items-center gap-1.5 flex-wrap md:pl-3 md:border-l md:border-white/15">
          <HudChip
            label="TDC"
            value={formatCurrencyTerse(totalDevCost)}
            title={`Total Development Cost: ${formatCurrency(totalDevCost)}`}
            tone="neutral"
          />
          <HudChip
            label="Drawn"
            value={drawnAmount == null ? "—" : formatCurrencyTerse(drawnAmount)}
            sub={drawnPct == null ? undefined : formatPercent(drawnPct)}
            title={
              drawnAmount == null
                ? "No draws funded yet"
                : `Drawn to date: ${formatCurrency(drawnAmount)}${
                    drawnPct != null ? ` (${formatPercent(drawnPct)} of TDC)` : ""
                  }`
            }
            tone="emerald"
          />
          <HudChip
            label="Variance"
            value={
              variance == null
                ? "—"
                : (variance >= 0 ? "+" : "") + formatCurrencyTerse(variance)
            }
            sub={
              variancePct == null
                ? undefined
                : (variancePct >= 0 ? "+" : "") + formatPercent(variancePct)
            }
            title={
              variance == null
                ? "Variance not yet computed"
                : `Variance vs UW baseline: ${
                    variance >= 0 ? "+" : ""
                  }${formatCurrency(variance)}`
            }
            tone="amber"
          />
          <HudChip
            label="Schedule"
            value={
              scheduleDeltaDays == null
                ? "—"
                : (scheduleDeltaDays >= 0 ? "+" : "") +
                  scheduleDeltaDays +
                  "d"
            }
            title={
              scheduleDeltaDays == null
                ? "Schedule delta not yet computed"
                : `${
                    scheduleDeltaDays >= 0 ? "Behind by " : "Ahead by "
                  }${Math.abs(scheduleDeltaDays)} days`
            }
            tone="neutral"
          />
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
      <Link
        href={`/deals/${dealId}/active-draw`}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-nurock-tan/20 hover:bg-nurock-tan/30 text-nurock-tan border border-nurock-tan/40 transition-colors font-display uppercase tracking-wider text-[10px]"
        title="Open the active draw — assemble + submit the current draw package"
      >
        <FileText className="w-3 h-3" />
        Draw Package
      </Link>
      <IconBtn
        icon={<RefreshCw className="w-3.5 h-3.5" />}
        label="Refresh"
        onClick={() => router.refresh()}
        title="Refresh data from the server"
      />
      <IconBtn
        icon={<ScrollText className="w-3.5 h-3.5" />}
        label="Audit"
        title="Audit trail — coming soon"
        disabled
      />
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
