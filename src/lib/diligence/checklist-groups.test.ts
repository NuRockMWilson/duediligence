import { describe, it, expect } from "vitest";
import {
  groupCombined,
  groupBySection,
  sectionLabel,
  type GroupableItem,
} from "./checklist-groups";

// =============================================================================
// The fixture is ZZ TEST - DELETE as measured in live round 57, scaled down but
// the same shape:
//
//   59 canonical items across canonical categories
//   274 packet items with category "imported", of which
//     14 are GP-block rows        (7 items x 2 named GP entities)
//     26 are Developer-block rows (13 x 2)
//     24 are Guarantor-block rows (12 x 2)
//   ------
//   333 total, and the table rendered 59 of them.
// =============================================================================

let seq = 0;
const item = (over: Partial<GroupableItem> = {}): GroupableItem & { id: string } => ({
  id: `i${++seq}`,
  category: "imported",
  groupId: null,
  groupLabel: null,
  groupParentLabel: null,
  entityId: null,
  entityName: null,
  ...over,
});

const canonical = (category: string, n: number) =>
  Array.from({ length: n }, () => item({ category }));

/** One repeating block, replicated across N named parties. */
const replicated = (
  groupId: string,
  groupLabel: string,
  parent: string,
  parties: Array<{ id: string; name: string }>,
  itemsEach: number
) =>
  parties.flatMap((p) =>
    Array.from({ length: itemsEach }, () =>
      item({
        groupId,
        groupLabel,
        groupParentLabel: parent,
        entityId: p.id,
        entityName: p.name,
      })
    )
  );

const GPS = [
  { id: "e-gp1", name: "ZZ TEST GP ONE - DELETE" },
  { id: "e-gp2", name: "ZZ TEST GP TWO - DELETE" },
];
const DEVS = [
  { id: "e-d1", name: "ZZ TEST DEVELOPER ONE - DELETE" },
  { id: "e-d2", name: "ZZ TEST DEVELOPER TWO - DELETE" },
];

const ITEMS = [
  ...canonical("org_docs", 30),
  ...canonical("insurance", 29),
  // Ordinary packet sections, no entity.
  ...Array.from({ length: 20 }, () =>
    item({ groupId: "g-title", groupLabel: "Title", groupParentLabel: "Real Estate" })
  ),
  ...replicated("g-gp", "GP Entity", "Entity Information", GPS, 7),
  ...replicated("g-dev", "Developer", "Entity Information", DEVS, 13),
];

describe("groupCombined — the round-57 invisible rows", () => {
  const groups = groupCombined(ITEMS);

  it("PARTITIONS the input — nothing is silently dropped", () => {
    // THE PROPERTY THAT BROKE, and the only assertion that could have caught
    // it. The bug was in rows that NEVER APPEARED, so no test of a group's
    // contents would have failed. Both sides derived; neither typed in.
    const rendered = groups.flatMap((g) => g.items);
    expect(rendered).toHaveLength(ITEMS.length);
    expect(new Set(rendered.map((i) => i.id)).size).toBe(ITEMS.length);
  });

  it("renders imported items instead of counting them and hiding them", () => {
    // "imported" is not one of the fifteen canonical keys. The old grouping
    // iterated the canonical list and kept only matches, so on the live deal
    // the counter said 333 and the table drew 59.
    const rendered = groups.flatMap((g) => g.items);
    const importedRendered = rendered.filter((i) => i.category === "imported");
    const importedInput = ITEMS.filter((i) => i.category === "imported");
    // 60 = 20 ordinary packet rows + 14 GP (7 x 2) + 26 Developer (13 x 2).
    // I first typed 74 here and the derived partition test above still passed —
    // which is the point of preferring derived assertions: the hand-count is
    // the part that goes wrong.
    expect(importedInput.length).toBe(60);
    expect(importedRendered).toHaveLength(importedInput.length);
  });

  it("keeps canonical categories first, in seed order, with their blurbs", () => {
    expect(groups[0].key).toBe("org_docs");
    expect(groups[0].blurb).toBeTruthy();
    expect(groups[1].key).toBe("insurance");
    // Non-canonical groups follow and carry no blurb.
    expect(groups.slice(2).every((g) => g.blurb === undefined)).toBe(true);
  });

  it("returns only canonical groups when there is nothing else", () => {
    const only = groupCombined(canonical("org_docs", 5));
    expect(only).toHaveLength(1);
    expect(only[0].items).toHaveLength(5);
  });
});

describe("groupBySection — one section per PARTY, not per role", () => {
  it("splits a repeating block by entity", () => {
    // Round 57: the GP block's 14 rows rendered as ONE section of seven
    // identical consecutive pairs.
    const gpRows = ITEMS.filter((i) => i.groupId === "g-gp");
    expect(gpRows).toHaveLength(14);
    const groups = groupBySection(gpRows);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.items.length)).toEqual([7, 7]);
  });

  it("names each section for the party", () => {
    const groups = groupBySection(ITEMS.filter((i) => i.groupId === "g-gp"));
    expect(groups.map((g) => g.label)).toEqual([
      "Entity Information › GP Entity — ZZ TEST GP ONE - DELETE",
      "Entity Information › GP Entity — ZZ TEST GP TWO - DELETE",
    ]);
    // The party name must actually reach the label — its total absence from the
    // page was the reported defect.
    for (const g of groups) expect(g.label).toContain("ZZ TEST GP");
  });

  it("keeps two parties' rows in different groups", () => {
    const groups = groupBySection(ITEMS.filter((i) => i.groupId === "g-gp"));
    const [a, b] = groups;
    expect(a.items.every((i) => i.entityId === "e-gp1")).toBe(true);
    expect(b.items.every((i) => i.entityId === "e-gp2")).toBe(true);
    expect(a.key).not.toBe(b.key);
  });

  it("leaves a non-entity section as one group", () => {
    const groups = groupBySection(ITEMS.filter((i) => i.groupId === "g-title"));
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("Real Estate › Title");
  });

  it("preserves first-appearance order, never alphabetical", () => {
    // A lender's sections run to 12 and "10" sorts before "2"; sorting would
    // quietly reorder the checklist away from the source document.
    const rows = [
      item({ groupId: "z", groupLabel: "Zoning" }),
      item({ groupId: "a", groupLabel: "Appraisal" }),
    ];
    expect(groupBySection(rows).map((g) => g.label)).toEqual([
      "Zoning",
      "Appraisal",
    ]);
  });

  it("partitions too", () => {
    const packetRows = ITEMS.filter((i) => i.category === "imported");
    const rendered = groupBySection(packetRows).flatMap((g) => g.items);
    expect(rendered).toHaveLength(packetRows.length);
  });
});

describe("sectionLabel edge cases", () => {
  it("falls back to the block name when the entity link has gone", () => {
    // Honest rather than inventing a party: the heading is wrong in the same
    // way it was before, and no fictional name appears.
    expect(
      sectionLabel(
        item({
          groupId: "g",
          groupLabel: "GP Entity",
          groupParentLabel: "Entity Information",
          entityId: "e-missing",
          entityName: null,
        })
      )
    ).toBe("Entity Information › GP Entity — GP Entity");
  });

  it("labels an ungrouped item rather than leaving it blank", () => {
    expect(sectionLabel(item())).toBe("Ungrouped");
  });

  it("uses the party alone when the block has no section path", () => {
    expect(
      sectionLabel(item({ entityId: "e1", entityName: "Robby Block" }))
    ).toBe("Robby Block");
  });
});
