"use client";

import { createClient } from "@/lib/supabase/client";
import { LogOut } from "lucide-react";

/**
 * Compact sign-out button styled to mirror UW SignInBar's signed-in state
 * (h-8, white/10 bg, ALL CAPS "SIGN OUT" label). See docs/shell.md §5.
 */
export default function SignOutButton() {
  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  return (
    <button
      type="button"
      onClick={signOut}
      title="Sign out"
      className="h-8 px-2.5 rounded bg-white/10 hover:bg-white/20 transition-colors flex items-center gap-1 text-[10px] uppercase tracking-wider font-display text-white"
    >
      <LogOut className="w-3 h-3" />
      <span className="hidden lg:inline">Sign Out</span>
    </button>
  );
}
