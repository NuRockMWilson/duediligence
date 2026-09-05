import { describe, it, expect } from "vitest";
import {
  matchesPacketScope,
  packetsPresent,
  PACKET_SCOPE_ALL,
  PACKET_SCOPE_CANONICAL,
} from "./item-filters";

// =============================================================================
// The fixture mirrors Residences at Westview Landing as measured in live round
// 56: 97 items across three templates.
//
//   PNC Bank - Equity              19
//   NuRock Standard Due Diligence  59   <- canonical
//   PNC                            19   <- retired, but its worked items remain
//                                  --
//                                  97
//
// Those counts are the point. The filter returned 0 for the canonical scope
// while the CSV export listed 59 of them, and the tests below would have caught
// that before it shipped.
// =============================================================================

const CANON = "tmpl-canonical";
const EQUITY = "tmpl-pnc-equity";
const RETIRED = "tmpl-pnc-retired";

const make = (
  templateId: string,
  isCanonicalTemplate: boolean,
  templateName: string,
  financierName: string | null,
  n: number
) =>
  Array.from({ length: n }, () => ({
    templateId,
    isCanonicalTemplate,
    templateName,
    financierName,
  }));

const ITEMS = [
  ...make(EQUITY, false, "PNC Bank - Equity", "PNC Bank", 19),
  ...make(CANON, true, "NuRock Standard Due Diligence", null, 59),
  ...make(RETIRED, false, "PNC", "PNC Bank", 19),
];

const count = (scope: string) =>
  ITEMS.filter((i) => matchesPacketScope(i, scope)).length;

describe("matchesPacketScope", () => {
  it("returns everything for the ALL scope", () => {
    expect(count(PACKET_SCOPE_ALL)).toBe(97);
  });

  it("returns the canonical items — THE ROUND-56 REGRESSION", () => {
    // This returned 0 in production. `templateId === null` looked like the
    // right test for "canonical" and is wrong, because canonical items have a
    // template: the canonical one.
    expect(count(PACKET_SCOPE_CANONICAL)).toBe(59);
    expect(count(PACKET_SCOPE_CANONICAL)).toBeGreaterThan(0);
  });

  it("returns one packet's items for a template id", () => {
    expect(count(EQUITY)).toBe(19);
    expect(count(RETIRED)).toBe(19);
  });

  it("PARTITIONS the list — every item is in exactly one scope", () => {
    // The property that actually broke. Not a spot check of three numbers but
    // the invariant they were meant to express: the scopes must add up to the
    // whole, so a scope silently returning nothing cannot pass.
    const scopes = [PACKET_SCOPE_CANONICAL, EQUITY, RETIRED];
    for (const item of ITEMS) {
      const hits = scopes.filter((s) => matchesPacketScope(item, s));
      expect(hits).toHaveLength(1);
    }
    const summed = scopes.reduce((n, s) => n + count(s), 0);
    expect(summed).toBe(ITEMS.length);
    expect(summed).toBe(count(PACKET_SCOPE_ALL));
  });

  it("never treats a canonical item as belonging to a packet", () => {
    const canonical = ITEMS.filter((i) => i.isCanonicalTemplate);
    expect(canonical).toHaveLength(59);
    for (const i of canonical) {
      expect(matchesPacketScope(i, EQUITY)).toBe(false);
      expect(matchesPacketScope(i, RETIRED)).toBe(false);
    }
  });

  it("does not rely on templateId being null for anything", () => {
    // An item with no template at all still must not masquerade as canonical.
    // Canonical is a fact read from the template row, and an orphan is neither.
    const orphan = {
      templateId: null,
      isCanonicalTemplate: false,
      templateName: null,
      financierName: null,
    };
    expect(matchesPacketScope(orphan, PACKET_SCOPE_CANONICAL)).toBe(false);
    expect(matchesPacketScope(orphan, PACKET_SCOPE_ALL)).toBe(true);
  });
});

describe("packetsPresent", () => {
  it("lists the packets and excludes the canonical checklist", () => {
    // Round 55: the canonical template was offered as a packet, and the filter
    // could never hide itself because the list was never empty.
    const packets = packetsPresent(ITEMS);
    expect(packets.map((p) => p.label).sort()).toEqual([
      "PNC Bank - Equity",
      "PNC",
    ].sort());
    expect(packets.map((p) => p.label)).not.toContain(
      "NuRock Standard Due Diligence"
    );
  });

  it("is EMPTY on a deal with only the canonical checklist", () => {
    // The condition that could never be false before. A ZZ TEST deal is exactly
    // this shape, and the filter hides itself on an empty list.
    const canonicalOnly = ITEMS.filter((i) => i.isCanonicalTemplate);
    expect(packetsPresent(canonicalOnly)).toEqual([]);
  });

  it("keeps a retired packet whose worked items remain", () => {
    // Deliberate, and confirmed against the live deal: unadopting only removes
    // UNTOUCHED instances, so hiding "PNC" would hide rows that are really on
    // the checklist.
    expect(packetsPresent(ITEMS).map((p) => p.value)).toContain(RETIRED);
  });

  it("falls back to the financier when a packet has no name", () => {
    const unnamed = [
      {
        templateId: "t1",
        isCanonicalTemplate: false,
        templateName: null,
        financierName: "Citibank",
      },
    ];
    expect(packetsPresent(unnamed)[0].label).toBe("Citibank");
  });
});
