"use client";

// =============================================================================
// AccountMenu — header account dropdown (Settings IA redesign)
// =============================================================================
// Replaces the bare "email · SIGN OUT" cluster in both headers (deals/page.tsx
// and deal-shell/header.tsx) with one consolidated menu:
//
//   [avatar] user@email ▾
//     ├─ <name / email block + Org Admin badge>
//     ├─ Settings            (→ /settings — the gear hub)
//     └─ Sign out
//
// Users & Access is NOT a top-bar item — it lives under the Settings gear
// (Settings → Administration → Users & Access, /settings/team), so admin tools
// are consolidated in one place rather than duplicated in the account menu.
//
// Trigger styling mirrors SignOutButton / DealSwitcher (h-8, white/10 on navy)
// so it sits cleanly in the navy bar. The dropdown panel matches DealSwitcher's
// white panel. `isOrgAdmin` is resolved server-side via getCurrentUserAccess
// and still drives the "Org Admin" badge in the identity block.
// =============================================================================

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ChevronDown, LogOut, Settings, UserRound } from "lucide-react";

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
          className="absolute top-full right-0 mt-1 w-64 bg-white text-nurock-black rounded-md shadow-xl border border-nurock-border z-50 overflow-hidden"
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

          <nav className="py-1 text-[13px]">
            {/* Users & Access now lives under Settings (the gear) →
                Administration, so it isn't duplicated in this menu. */}
            <a
              href="/settings"
              role="menuitem"
              className="flex items-center gap-2.5 px-3 py-2 text-nurock-slate hover:bg-nurock-gray hover:text-nurock-navy transition-colors"
              onClick={() => setOpen(false)}
            >
              <Settings className="w-4 h-4 flex-shrink-0" />
              <span>Settings</span>
            </a>
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
