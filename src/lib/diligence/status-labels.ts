// UI-free status labels — shared by server (PDF/export) and client (badges).
import type { DiligenceStatus } from "@/lib/data/diligence-rollup";

export const STATUS_LABEL: Record<DiligenceStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  submitted: "Submitted",
  approved: "Approved",
  waived: "Waived",
  na: "N/A",
};
