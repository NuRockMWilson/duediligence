// =============================================================================
// LIHTC deadline engine (Increment 3)
// =============================================================================
// Surfaces the statutory / closing dates that DD must keep pace with, read from
// the underwriting model's keyDates (the single source of project dates). Each
// returns a countdown + tone so the diligence header can show "Placed in
// Service in 45 days" with escalating urgency. No new table — these dates live
// in the deal's UW model.
// =============================================================================

import { getUwModel, type UwKeyDates } from "@/lib/data/uw-model";
import { parseDateLocal } from "@/lib/format";

export type DeadlineTone = "bad" | "warn" | "ok";

export interface DeadlineItem {
  key: keyof UwKeyDates;
  label: string;
  /** ISO yyyy-mm-dd. */
  date: string;
  /** Whole days from today (negative = past). */
  daysRemaining: number;
  past: boolean;
  tone: DeadlineTone;
}

// The DD-critical milestones, in the order they occur in a LIHTC deal.
const DEADLINE_FIELDS: Array<{ key: keyof UwKeyDates; label: string }> = [
  { key: "closingDate", label: "Closing" },
  { key: "taxCreditPartnershipClosing", label: "Equity Closing" },
  { key: "constructionStart", label: "Construction Start" },
  { key: "constructionCompleteFirstBuilding", label: "First Building Complete" },
  { key: "certificatesOfOccupancy", label: "Certificates of Occupancy" },
  { key: "placedInService", label: "Placed in Service" },
  { key: "permanentFinancingClosing", label: "Permanent Conversion" },
  { key: "stabilizationDate", label: "Stabilization" },
  { key: "form8609Delivery", label: "Form 8609 Delivery" },
  { key: "taxReturnDelivery", label: "Tax Return Delivery" },
];

const SOON_DAYS = 45;

function toneFor(daysRemaining: number): DeadlineTone {
  if (daysRemaining < 0) return "bad";
  if (daysRemaining <= SOON_DAYS) return "warn";
  return "ok";
}

export async function getDiligenceDeadlines(
  dealId: string
): Promise<DeadlineItem[]> {
  const model = await getUwModel(dealId);
  if (!model) return [];

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();

  const out: DeadlineItem[] = [];
  for (const f of DEADLINE_FIELDS) {
    const raw = model.keyDates[f.key];
    if (!raw) continue;
    const d = parseDateLocal(raw);
    if (!d) continue;
    d.setHours(0, 0, 0, 0);
    const daysRemaining = Math.round((d.getTime() - todayMs) / 86_400_000);
    out.push({
      key: f.key,
      label: f.label,
      date: raw,
      daysRemaining,
      past: daysRemaining < 0,
      tone: toneFor(daysRemaining),
    });
  }
  // Soonest first.
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
