"use client";

// =============================================================================
// SaveStatus — devmgmt counterpart to UW's SaveStatusIndicator
// =============================================================================
// Renders "Saved Xs ago" with a check icon and a live-ticking relative time.
// The `savedAt` prop is set by the layout from Date.now() on server render —
// devmgmt re-renders after each revalidatePath, so the timestamp resets on
// every server action that touches the page. Approximates UW's behavior
// closely enough for visual parity in the navy bar.
//
// Visual matches UW's SaveStatusIndicator (lib/SaveStatusIndicator.tsx):
//   hidden md:flex · text-[10px] · font-mono · check icon · "Saved Xs ago"
// in emerald-300. See docs/shell.md §5.
// =============================================================================

import { useEffect, useState } from "react";
import { Check } from "lucide-react";

function formatRelativeSaveTime(ts: number): string {
  const deltaMs = Date.now() - ts;
  const s = Math.floor(deltaMs / 1000);
  if (s < 2) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function SaveStatus({ savedAt }: { savedAt: number }) {
  // Server render and first client render both show "just now" — same text,
  // so no hydration mismatch. Only after `mounted` flips true (after useEffect
  // runs) do we start computing the dynamic "Xs ago" text. Without this gate,
  // React error #418 fires whenever Date.now() differs between server and
  // client by more than the 2-second "just now" threshold.
  const [mounted, setMounted] = useState(false);
  const [, setTick] = useState(0);
  useEffect(() => {
    setMounted(true);
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const label = mounted ? `Saved ${formatRelativeSaveTime(savedAt)}` : "Saved just now";

  return (
    <div
      className="hidden md:flex items-center gap-1 text-[10px] font-mono leading-tight text-emerald-300"
      title={`Last saved ${new Date(savedAt).toLocaleTimeString()}`}
      suppressHydrationWarning
    >
      <Check className="w-3 h-3" />
      <span className="whitespace-nowrap tabular-nums">{label}</span>
    </div>
  );
}
