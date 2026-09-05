import { describe, it, expect } from "vitest";
import {
  planUnadopt,
  needsHistoryCheck,
  type UnadoptCandidate,
} from "./unadopt-plan";

// =============================================================================
// The fixture is ZZ TEST 0901B - DELETE as measured in live round 60c:
//   249 packet rows on the deal
//   1 of them worked (item 57, set to In progress)
//   248 untouched
// The toast reported "248 rows deleted" and said nothing about the 1 kept,
// because kept was derived from a set already filtered to not_started.
// =============================================================================

const rows = (n: number, status: string, prefix: string): UnadoptCandidate[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, status }));

const NONE = new Set<string>();

describe("planUnadopt — the round-60c count", () => {
  const candidates = [
    ...rows(248, "not_started", "u"),
    { id: "worked-57", status: "in_progress" },
  ];

  it("keeps the worked row and deletes the rest", () => {
    const plan = planUnadopt(candidates, NONE);
    expect(plan.removable).toHaveLength(248);
    expect(plan.kept).toBe(1);
    expect(plan.total).toBe(249);
  });

  it("PARTITIONS — removed and kept must add back to the total", () => {
    // THE PROPERTY THAT BROKE. The old code derived kept from the not-started
    // subset, so this identity could not hold whenever a row was kept on its
    // STATUS rather than on an attached document. Both sides derived here;
    // neither typed in.
    const plan = planUnadopt(candidates, NONE);
    expect(plan.removable.length + plan.kept).toBe(plan.total);
    expect(plan.total).toBe(candidates.length);
  });

  it("never deletes a row that is not 'not_started', whatever its status", () => {
    // Any status other than not_started means somebody has been here.
    for (const status of ["in_progress", "submitted", "approved", "waived", "na"]) {
      const plan = planUnadopt([{ id: "x", status }], NONE);
      expect(plan.removable).toEqual([]);
      expect(plan.kept).toBe(1);
    }
  });

  it("keeps a not-started row that carries a document or sign-off", () => {
    const plan = planUnadopt(
      [
        { id: "clean", status: "not_started" },
        { id: "has-doc", status: "not_started" },
      ],
      new Set(["has-doc"])
    );
    expect(plan.removable).toEqual(["clean"]);
    expect(plan.kept).toBe(1);
  });

  it("counts BOTH reasons for keeping, not just one", () => {
    // The old bug could see documents but not statuses. A row kept for each
    // reason must both land in kept.
    const plan = planUnadopt(
      [
        { id: "clean", status: "not_started" },
        { id: "has-doc", status: "not_started" },
        { id: "worked", status: "submitted" },
      ],
      new Set(["has-doc"])
    );
    expect(plan.removable).toEqual(["clean"]);
    expect(plan.kept).toBe(2);
    expect(plan.removable.length + plan.kept).toBe(plan.total);
  });

  it("reports zero kept when everything is untouched — round 58's case", () => {
    // 274 rows, nothing worked. The toast should then carry a single number,
    // and kept must be a real 0 rather than an accidental one.
    const plan = planUnadopt(rows(274, "not_started", "r"), NONE);
    expect(plan.removable).toHaveLength(274);
    expect(plan.kept).toBe(0);
  });

  it("handles a packet with no rows at all", () => {
    const plan = planUnadopt([], NONE);
    expect(plan.removable).toEqual([]);
    expect(plan.kept).toBe(0);
    expect(plan.total).toBe(0);
  });

  it("keeps everything when every row has been worked", () => {
    const plan = planUnadopt(rows(12, "approved", "a"), NONE);
    expect(plan.removable).toEqual([]);
    expect(plan.kept).toBe(12);
  });
});

describe("needsHistoryCheck", () => {
  it("asks about not-started rows only", () => {
    // A worked row is kept on its status, so looking up its documents would be
    // a query whose answer cannot change the outcome.
    const ids = needsHistoryCheck([
      { id: "a", status: "not_started" },
      { id: "b", status: "in_progress" },
      { id: "c", status: "not_started" },
    ]);
    expect(ids).toEqual(["a", "c"]);
  });

  it("returns nothing when no row is a delete candidate", () => {
    // And the caller must then issue no query at all.
    expect(needsHistoryCheck(rows(5, "approved", "x"))).toEqual([]);
  });
});
