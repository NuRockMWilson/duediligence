// =============================================================================
// computeDiligenceRollup — coverage over an empty denominator
// =============================================================================
// THIS FILE EXISTS BECAUSE THE BROWSER COULD NOT REACH THE BRANCH, AND SAID SO.
// From the live measurement session, 2026-09-03:
//
//   "The readiness-rollup branch (applicable === 0) CANNOT FIRE on current
//    data: it needs every item on a deal waived/N-A'd, and no deal is close —
//    Westview has 1 waived of 59, the other eleven have zero waivers. I did NOT
//    verify its null branch renders '—', and my method could not have produced
//    that result under any available input. Calling it verified would be the
//    check-that-cannot-fail error."
//
// That is the correct call, and manufacturing an all-waived deal in production
// to exercise a display branch would be state pollution rather than a test. So
// the branch is covered here instead.
//
// WHAT IS ACTUALLY BEING PROTECTED. The defect fixed in 9005859 was that
// coverage over an EMPTY SET reported 100 — a badge that could not come out
// wrong, which is why it was worthless. The regression risk now runs BOTH ways,
// so both directions are asserted: null when nothing is applicable, and a real
// number the moment anything is.
// =============================================================================

import { describe, expect, it } from "vitest";
import { computeDiligenceRollup, type RollupItemRow } from "./diligence-rollup";

const TODAY = "2026-09-03";

function row(over: Partial<RollupItemRow> = {}): RollupItemRow {
  return {
    status: "not_started",
    isRequired: true,
    dueDate: null,
    assigneeUserId: null,
    assigneeName: null,
    ...over,
  };
}

describe("computeDiligenceRollup — empty denominator", () => {
  it("returns NULL coverage when there are no rows at all", () => {
    const r = computeDiligenceRollup([], TODAY);
    expect(r.coveragePct).toBeNull();
    expect(r.applicable).toBe(0);
    expect(r.total).toBe(0);
  });

  it("returns NULL coverage when every item is waived or N/A", () => {
    // The exact live-unreachable state: rows exist, but none count toward the
    // denominator. Before the fix this reported 100% — "fully ready" for a deal
    // on which nothing had been approved.
    const r = computeDiligenceRollup(
      [
        row({ status: "waived" }),
        row({ status: "waived" }),
        row({ status: "na" }),
      ],
      TODAY
    );
    expect(r.coveragePct).toBeNull();
    expect(r.applicable).toBe(0);
    expect(r.total).toBe(3);
    expect(r.waivedCount).toBe(2);
    expect(r.naCount).toBe(1);
  });

  it("NEVER reports 100 for an empty denominator — the original defect", () => {
    // Stated as its own assertion rather than folded into the above, because
    // this specific value is the regression: `applicable === 0 ? 100` is an easy
    // thing to reintroduce while "fixing" a null-handling complaint downstream.
    for (const rows of [[], [row({ status: "waived" })], [row({ status: "na" })]]) {
      expect(computeDiligenceRollup(rows, TODAY).coveragePct).not.toBe(100);
    }
  });
});

describe("computeDiligenceRollup — the normal path still works", () => {
  // The fix must not have turned real ratios into nulls. This is the direction
  // the browser DID verify live across all twelve deals; asserting it here means
  // a future change cannot quietly break it between deploys.
  it("computes a real percentage when items are applicable", () => {
    const r = computeDiligenceRollup(
      [
        row({ status: "approved" }),
        row({ status: "approved" }),
        row({ status: "submitted" }),
        row({ status: "not_started" }),
      ],
      TODAY
    );
    expect(r.coveragePct).toBe(50);
    expect(r.applicable).toBe(4);
    expect(r.approved).toBe(2);
    expect(r.outstandingCount).toBe(2);
  });

  it("reports 100 only when the denominator is real AND fully approved", () => {
    const r = computeDiligenceRollup(
      [row({ status: "approved" }), row({ status: "approved" })],
      TODAY
    );
    expect(r.coveragePct).toBe(100);
    expect(r.allClear).toBe(true);
  });

  it("excludes waived/N-A from the denominator without nulling a live ratio", () => {
    // Westview's actual shape in miniature: some waived, the rest real. The
    // waived row must shrink the denominator (59 -> 58 live) and must NOT push
    // coverage to null.
    const r = computeDiligenceRollup(
      [
        row({ status: "approved" }),
        row({ status: "not_started" }),
        row({ status: "waived" }),
      ],
      TODAY
    );
    expect(r.applicable).toBe(2);
    expect(r.coveragePct).toBe(50);
    expect(r.total).toBe(3);
  });
});
