// =============================================================================
// MetPill — target-vs-actual status pill for the completed/met date
// =============================================================================
// Shared by the checklist table's "Met" column and the item drawer so the
// on-time/late semantics can never drift between the two surfaces:
//   * no completed date            → neutral "Pending" (target/due only)
//   * completed ≤ due (or no due)  → emerald "On time" / "Met"
//   * completed >  due             → amber "Late" (crimson when > 30d late)
// The day variance renders font-mono tabular-nums next to the pill
// ("+6d" late / "−3d" early), matching the app's numeric column treatment.

import { Badge } from "@/components/nurock-ui";

/** Whole-day difference completed − due (UTC-midnight math — immune to TZ).
 *  Positive = late, negative = early, null = no due date to compare. */
export function metVarianceDays(
  dueDate: string | null,
  completedDate: string
): number | null {
  const m = (s: string) =>
    /^\d{4}-\d{2}-\d{2}/.test(s)
      ? Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10))
      : null;
  const due = dueDate ? m(dueDate) : null;
  const done = m(completedDate);
  if (due === null || done === null) return null;
  return Math.round((done - due) / 86_400_000);
}

export function MetPill({
  dueDate,
  completedDate,
}: {
  dueDate: string | null;
  completedDate: string | null;
}) {
  if (!completedDate) {
    return <Badge tone="slate">Pending</Badge>;
  }
  const v = metVarianceDays(dueDate, completedDate);
  if (v === null) {
    // Met, but no due date to measure against — state without variance.
    return <Badge tone="green">Met</Badge>;
  }
  const late = v > 0;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <Badge tone={late ? (v > 30 ? "red" : "amber") : "green"}>
        {late ? "Late" : "On time"}
      </Badge>
      <span
        className={`font-mono tabular-nums text-[11px] ${
          late ? (v > 30 ? "text-red-700" : "text-amber-700") : "text-emerald-700"
        }`}
      >
        {v === 0 ? "±0d" : v > 0 ? `+${v}d` : `−${-v}d`}
      </span>
    </span>
  );
}
