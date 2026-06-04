import type { BadgeTone } from "@/components/nurock-ui";
import type { DiligenceStatus } from "@/lib/data/diligence-rollup";
import { STATUS_LABEL } from "@/lib/diligence/status-labels";

// Status lifecycle + locked tones shared by the checklist table and the drawer.
//   not_started → in_progress → submitted → approved
//   waived / na reachable from any state (need a reason).
export const DILIGENCE_STATUSES: DiligenceStatus[] = [
  "not_started",
  "in_progress",
  "submitted",
  "approved",
  "waived",
  "na",
];

const BADGE_BY_STATUS: Record<DiligenceStatus, BadgeTone> = {
  not_started: "slate",
  in_progress: "amber",
  submitted: "navy",
  approved: "green",
  waived: "tan",
  na: "slate",
};

export const STATUS_META: Record<
  DiligenceStatus,
  { label: string; badge: BadgeTone }
> = {
  not_started: { label: STATUS_LABEL.not_started, badge: BADGE_BY_STATUS.not_started },
  in_progress: { label: STATUS_LABEL.in_progress, badge: BADGE_BY_STATUS.in_progress },
  submitted: { label: STATUS_LABEL.submitted, badge: BADGE_BY_STATUS.submitted },
  approved: { label: STATUS_LABEL.approved, badge: BADGE_BY_STATUS.approved },
  waived: { label: STATUS_LABEL.waived, badge: BADGE_BY_STATUS.waived },
  na: { label: STATUS_LABEL.na, badge: BADGE_BY_STATUS.na },
};

export const WAIVE_STATES: DiligenceStatus[] = ["waived", "na"];
