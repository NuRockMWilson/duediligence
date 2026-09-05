import { describe, it, expect } from "vitest";
import { planInstantiation, type PacketItem } from "./instantiation-plan";

// =============================================================================
// The fixture is ZZ OUTLINE TEST - DELETE as measured across rounds 57-61:
//   242 items total
//    32 inside three repeating blocks — GP 7, Developer 13, Guarantor 12
//   210 standalone
// =============================================================================

const GP = "g-gp";
const DEV = "g-dev";
const GUAR = "g-guar";

const PARAM_ROLES = new Map([
  [GP, "general_partner"],
  [DEV, "developer"],
  [GUAR, "guarantor"],
]);

let seq = 0;
const item = (group_id: string | null): PacketItem => ({
  id: `i${++seq}`,
  default_required: true,
  group_id,
});

const build = () => {
  seq = 0;
  return [
    ...Array.from({ length: 210 }, () => item(null)),
    ...Array.from({ length: 7 }, () => item(GP)),
    ...Array.from({ length: 13 }, () => item(DEV)),
    ...Array.from({ length: 12 }, () => item(GUAR)),
  ];
};

const EMPTY = new Set<string>();
const NO_PAIRS = new Set<string>();

describe("planInstantiation — no parties named (the round-61 bug)", () => {
  const items = build();
  const plan = planInstantiation({
    items,
    mapped: EMPTY,
    have: EMPTY,
    havePair: NO_PAIRS,
    paramGroupRole: PARAM_ROLES,
    entitiesByRole: new Map(),
  });

  it("instantiates 210, NOT 242", () => {
    // Round 61 measured 242. The 32 repeating-block items were written as
    // ordinary standalone rows on a deal with no org chart, contradicting two
    // pieces of the product's own copy and Michael's spec.
    expect(plan.standalone).toHaveLength(210);
    expect(plan.entityScoped).toHaveLength(0);
  });

  it("never files a repeating-block item as standalone", () => {
    // The specific claim. A "GP Entity" row with no GP belongs to nobody.
    const standaloneIds = new Set(plan.standalone.map((s) => s.id));
    const paramItems = items.filter((i) => i.group_id !== null);
    expect(paramItems).toHaveLength(32);
    for (const p of paramItems) expect(standaloneIds.has(p.id)).toBe(false);
  });

  it("reports how many are waiting on the org chart", () => {
    // Silently absent is what made this hard to notice. 32 requirements exist
    // and are held back; a caller can now say so.
    expect(plan.awaitingParties).toBe(32);
  });
});

describe("planInstantiation — parties named", () => {
  it("produces one row per party, per role, asymmetrically", () => {
    // Round 60b's live shape: 2 GP, 1 Developer, 2 Guarantor -> 51.
    const plan = planInstantiation({
      items: build(),
      mapped: EMPTY,
      have: EMPTY,
      havePair: NO_PAIRS,
      paramGroupRole: PARAM_ROLES,
      entitiesByRole: new Map([
        ["general_partner", ["gp1", "gp2"]],
        ["developer", ["d1"]],
        ["guarantor", ["gu1", "gu2"]],
      ]),
    });
    expect(plan.standalone).toHaveLength(210);
    expect(plan.entityScoped).toHaveLength(7 * 2 + 13 * 1 + 12 * 2);
    expect(plan.entityScoped).toHaveLength(51);
    expect(plan.awaitingParties).toBe(0);
    // 210 + 51 = 261 added, which is exactly what round 60b measured.
    expect(plan.standalone.length + plan.entityScoped.length).toBe(261);
  });

  it("holds back only the roles with nobody named", () => {
    // A partially-filled org chart must not withhold the roles that ARE filled.
    const plan = planInstantiation({
      items: build(),
      mapped: EMPTY,
      have: EMPTY,
      havePair: NO_PAIRS,
      paramGroupRole: PARAM_ROLES,
      entitiesByRole: new Map([["guarantor", ["gu1"]]]),
    });
    expect(plan.entityScoped).toHaveLength(12);
    expect(plan.awaitingParties).toBe(7 + 13);
    expect(plan.standalone).toHaveLength(210);
  });

  it("does not duplicate a party's rows on a repeat pass", () => {
    // ensureDealItems runs on every page load. havePair is what stops it
    // writing a second copy.
    const items = build();
    const gpItems = items.filter((i) => i.group_id === GP);
    const plan = planInstantiation({
      items,
      mapped: EMPTY,
      have: EMPTY,
      havePair: new Set(gpItems.map((i) => `${i.id}|gp1`)),
      paramGroupRole: PARAM_ROLES,
      entitiesByRole: new Map([["general_partner", ["gp1", "gp2"]]]),
    });
    // gp1's seven already exist; only gp2's seven are new.
    expect(plan.entityScoped).toHaveLength(7);
    expect(plan.entityScoped.every((e) => e.entity_id === "gp2")).toBe(true);
  });

  it("does not duplicate a standalone row already on the deal", () => {
    // Round 61's idempotency case: a kept row survives an unadopt, the packet
    // is re-adopted, and that row must not be written twice.
    const items = build();
    const kept = items[0];
    const plan = planInstantiation({
      items,
      mapped: EMPTY,
      have: new Set([kept.id]),
      havePair: NO_PAIRS,
      paramGroupRole: PARAM_ROLES,
      entitiesByRole: new Map(),
    });
    expect(plan.standalone).toHaveLength(209);
    expect(plan.standalone.map((s) => s.id)).not.toContain(kept.id);
  });
});

describe("planInstantiation — crosswalk-mapped items stay virtual", () => {
  it("skips a mapped standalone item", () => {
    const items = build();
    const mappedItem = items[0];
    const plan = planInstantiation({
      items,
      mapped: new Set([mappedItem.id]),
      have: EMPTY,
      havePair: NO_PAIRS,
      paramGroupRole: PARAM_ROLES,
      entitiesByRole: new Map(),
    });
    expect(plan.standalone).toHaveLength(209);
  });

  it("instantiates a mapped item that is ALSO parameterized", () => {
    // Deliberate departure, documented in ensureDealItems: one canonical item
    // cannot represent three guarantors, so per-entity tracking wins over
    // coverage-through-mapping wherever the two conflict.
    const items = build();
    const gpItems = items.filter((i) => i.group_id === GP);
    const plan = planInstantiation({
      items,
      mapped: new Set(gpItems.map((i) => i.id)),
      have: EMPTY,
      havePair: NO_PAIRS,
      paramGroupRole: PARAM_ROLES,
      entitiesByRole: new Map([["general_partner", ["gp1"]]]),
    });
    expect(plan.entityScoped).toHaveLength(7);
  });
});

describe("planInstantiation — every empty input over-instantiates", () => {
  // The reason the caller must distinguish "empty" from "unreadable". This
  // function cannot tell the difference, and each empty input fails toward
  // writing MORE rows than it should.
  it("an empty paramGroupRole turns every repeating item into a plain row", () => {
    const plan = planInstantiation({
      items: build(),
      mapped: EMPTY,
      have: EMPTY,
      havePair: NO_PAIRS,
      paramGroupRole: new Map(),
      entitiesByRole: new Map(),
    });
    // 242, which is exactly what round 61 saw. Asserted so the failure mode is
    // documented rather than merely described in a comment.
    expect(plan.standalone).toHaveLength(242);
    expect(plan.awaitingParties).toBe(0);
  });

  it("an empty mapped set instantiates items that should have stayed virtual", () => {
    const plan = planInstantiation({
      items: build(),
      mapped: EMPTY,
      have: EMPTY,
      havePair: NO_PAIRS,
      paramGroupRole: PARAM_ROLES,
      entitiesByRole: new Map(),
    });
    expect(plan.standalone).toHaveLength(210);
  });
});
