"use client";

// =============================================================================
// DealSidebar (Due Diligence) — adopts the shared SidebarNav.
// -----------------------------------------------------------------------------
// Was a WHITE rail (bg-white / border-nurock-border / slate links); now the
// same navy rail as Development and Underwriting, by rendering the shared
// components/shared-ui/SidebarNav.tsx (canonical copy lives in nurock-devmgmt).
// Only module-specific wiring stays here: the nav config, route-based active
// state, and the cross-app header block + rail collapse toggle.
//
// Diligence keeps defaultExpanded: false to match Development (the active
// section always force-opens, so nothing is ever hidden from the user).
// =============================================================================

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Settings,
  ArrowLeft,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { buildNav } from "@/lib/nav";
import {
  SidebarNav,
  SidebarShell,
  type SidebarSectionDef,
} from "@/components/shared-ui/SidebarNav";

export default function DealSidebar({ dealId }: { dealId: string }) {
  const pathname = usePathname();
  const groups = buildNav(dealId);

  // Rail collapse — same affordance as the other modules. Diligence has no
  // breakpoint hook, so desktop simply defaults to expanded.
  const [collapsed, setCollapsed] = React.useState(false);

  const sections: SidebarSectionDef[] = React.useMemo(
    () =>
      groups.map((g) => ({
        id: g.label,
        label: g.label,
        items: g.items.map((it) => ({
          id: it.href,
          label: it.label,
          icon: it.icon,
          badge: it.badge,
        })),
      })),
    [groups]
  );

  // Longest-prefix match so a nested route lights up its own item, not a sibling.
  const activeId = React.useMemo(() => {
    let best = "";
    for (const g of groups) {
      for (const it of g.items) {
        if (
          (pathname === it.href || pathname.startsWith(it.href + "/")) &&
          it.href.length > best.length
        ) {
          best = it.href;
        }
      }
    }
    return best;
  }, [groups, pathname]);

  return (
    <SidebarShell collapsed={collapsed}>
      <SidebarNav
        sections={sections}
        activeId={activeId}
        storageNamespace="nurock-diligence"
        defaultExpanded={false}
        collapsed={collapsed}
        header={() => (
          <>
            <div
              className={`mb-2 flex ${
                collapsed ? "justify-center" : "justify-end px-3"
              }`}
            >
              <button
                type="button"
                onClick={() => setCollapsed((c) => !c)}
                className="text-white/50 hover:text-white p-1 rounded hover:bg-white/10 transition-colors"
                title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              >
                {collapsed ? (
                  <PanelLeftOpen className="w-4 h-4" />
                ) : (
                  <PanelLeftClose className="w-4 h-4" />
                )}
              </button>
            </div>

            {/* Cross-app navigation — Portfolio (back to the model) + Settings. */}
            <div
              className={`pb-3 mb-2 border-b border-white/10 space-y-2 ${
                collapsed ? "px-0" : "px-5"
              }`}
            >
              <a
                href={
                  process.env.NEXT_PUBLIC_MODEL_URL ??
                  "https://nurockmodel.vercel.app"
                }
                className={`flex items-center gap-2 text-[12px] font-display uppercase tracking-wider text-white/70 hover:text-white transition-colors group ${
                  collapsed ? "justify-center" : ""
                }`}
                title="Back to the portfolio dashboard in the underwriting model"
              >
                <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform shrink-0" />
                {!collapsed && <span>Portfolio</span>}
              </a>
              <Link
                href="/settings"
                className={`flex items-center gap-2 text-[12px] font-display uppercase tracking-wider text-white/70 hover:text-white transition-colors ${
                  collapsed ? "justify-center" : ""
                }`}
                title="Org-level settings — standard schedule, reporting templates, etc."
              >
                <Settings className="w-3.5 h-3.5 shrink-0" />
                {!collapsed && <span>Settings</span>}
              </Link>
            </div>
          </>
        )}
        renderItem={(item, { className, children }) => (
          <Link
            href={item.id}
            prefetch={false}
            title={collapsed ? item.label : undefined}
            className={className}
          >
            {children}
          </Link>
        )}
      />
    </SidebarShell>
  );
}
