"use client";

// =============================================================================
// AccountMenu — header account dropdown (Settings IA redesign)
// =============================================================================
// Replaces the bare "email · SIGN OUT" cluster in both headers (deals/page.tsx
// and deal-shell/header.tsx) with one consolidated menu:
//
//   [avatar] user@email ▾
//     ├─ <name / email block + Org Admin badge>
//     ├─ CONFIGURATION
//     │    ├─ Report Formats … Diligence Templates
//     ├─ ADMINISTRATION                (org admins only)
//     │    ├─ Users & Access
//     │    └─ Admin
//     └─ Sign out
//
// The settings sections are rendered straight from lib/settings-nav.ts — the
// SAME source the Settings sidebar uses — so this dropdown always mirrors the
// settings page, grouped the same way. The old standalone ⚙ Settings gear in
// the deal-shell tools cluster was removed; this menu is now the single way in.
//
// Trigger styling mirrors SignOutButton / DealSwitcher (h-8, white/10 on navy)
// so it sits cleanly in the navy bar. The dropdown panel matches DealSwitcher's
// white panel. `isOrgAdmin` is resolved server-side via getCurrentUserAccess:
// it drives the "Org Admin" badge AND gates the Administration sections.
// =============================================================================

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ChevronDown, LogOut, UserRound } from "lucide-react";
import { SETTINGS_NAV } from "@/lib/settings-nav";

interface AccountMenuProps {
  email: string;
  displayName?: string | null;
  isOrgAdmin: boolean;
}

export default function AccountMenu({
  email,
  displayName,
  isOrgAdmin,
}: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Outside click + Escape to close (same pattern as DealSwitcher).
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

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  const label = displayName?.trim() || email || "Account";

  // Mirror the settings page, but drop Administration sections for non-admins
  // and any group left empty as a result.
  const visibleGroups = SETTINGS_NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => isOrgAdmin || !item.adminOnly),
  })).filter((group) => group.items.length > 0);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={email}
        aria-haspopup="menu"
        aria-expanded={open}
        className="h-8 pl-1.5 pr-2 rounded bg-white/10 hover:bg-white/20 transition-colors flex items-center gap-1.5 text-white"
      >
        <span className="w-5 h-5 rounded-full bg-white/15 flex items-center justify-center flex-shrink-0">
          <UserRound className="w-3 h-3" />
        </span>
        <span className="hidden md:inline font-mono text-[10px] tabular-nums max-w-[160px] truncate">
          {label}
        </span>
        <ChevronDown className="w-3.5 h-3.5 opacity-80" />
      </button>

      {open && (
        <div
          className="absolute top-full right-0 mt-1 w-72 bg-white text-nurock-black rounded-md shadow-xl border border-nurock-border z-50 overflow-hidden"
          role="menu"
        >
          {/* Identity block */}
          <div className="px-3 py-2.5 border-b border-nurock-border bg-nurock-gray/40">
            {displayName?.trim() && (
              <div className="text-[13px] font-semibold text-nurock-black leading-tight truncate">
                {displayName}
              </div>
            )}
            <div className="text-[11px] text-nurock-slate-light font-mono truncate">
              {email}
            </div>
            {isOrgAdmin && (
              <div className="mt-1 inline-flex items-center gap-1 text-[9px] uppercase tracking-wider font-display text-nurock-navy bg-nurock-navy/10 rounded px-1.5 py-0.5">
                Org Admin
              </div>
            )}
          </div>

          {/* Settings sections — rendered from lib/settings-nav.ts so this
              dropdown always mirrors the settings page, grouped the same way. */}
          <nav className="py-1 text-[13px] max-h-[60vh] overflow-y-auto">
            {visibleGroups.map((group) => (
              <div key={group.label}>
                <div className="px-3 pt-2 pb-1 font-display text-[9px] uppercase tracking-[0.12em] text-nurock-slate-light">
                  {group.label}
                </div>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <a
                      key={item.href}
                      href={item.href}
                      role="menuitem"
                      title={item.label}
                      className="flex items-center gap-2.5 px-3 py-1.5 text-nurock-slate hover:bg-nurock-gray hover:text-nurock-navy transition-colors"
                      onClick={() => setOpen(false)}
                    >
                      <Icon className="w-4 h-4 flex-shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </a>
                  );
                })}
              </div>
            ))}
          </nav>

          <button
            type="button"
            onClick={signOut}
            role="menuitem"
            className="w-full flex items-center gap-2.5 px-3 py-2 border-t border-nurock-border text-[13px] text-nurock-slate hover:bg-red-50 hover:text-red-700 transition-colors"
          >
            <LogOut className="w-4 h-4 flex-shrink-0" />
            <span>Sign out</span>
          </button>
        </div>
      )}
    </div>
  );
}
