// =============================================================================
// Checklist grouping — which section each row is rendered under
// =============================================================================
// PURE, AND EXTRACTED BECAUSE THE INVARIANT IT BREAKS IS INVISIBLE ON SCREEN.
//
// Live round 57 adopted a 242-item packet onto a deal with six named parties.
// The engine was exactly right: 64 entity-scoped rows, 333 items total, the
// predicted arithmetic to the item. The RENDERING was wrong twice over:
//
//  1. The counter read "333 of 333 items" while the table rendered 59. Grouping
//     iterated the fifteen canonical categories and kept only those, but
//     imported packet items carry the category "imported" — so 274 rows were
//     counted, filtered, exported, and never drawn. Reachable only by someone
//     who knew to reach for the packet filter.
//
//  2. The GP block's 14 rows rendered as one section per ROLE, appearing as
//     seven identical consecutive pairs. Nothing separated one GP entity's copy
//     from the other's, and none of the six party names appeared on the page at
//     all. The block name is the right label for a template and the wrong one
//     for a deal, where the party has a name — which is the whole reason the
//     org chart is typed.
//
// Both are the same failure: the label did not follow the data. And both are
// invisible to any test that checks a group's contents, because the bug is in
// what NEVER APPEARS. So the property this module exists to guarantee is a
// PARTITION — every item lands in exactly one group, and the groups sum to the
// input. A row that is silently dropped cannot satisfy that, whatever else it
// does.
// =============================================================================

import { DILIGENCE_CATEGORIES } from "./categories";

/** Only the fields grouping needs. Narrow on purpose, so this stays testable. */
export interface GroupableItem {
  category: string;
  groupId: string | null;
  groupLabel: string | null;
  groupParentLabel: string | null;
  entityId: string | null;
  entityName: string | null;
}

export interface ChecklistGroup<T> {
  key: string;
  label: string;
  /** Only canonical categories carry the LIHTC context blurb. */
  blurb?: string;
  items: T[];
}

const CANONICAL_KEYS = new Set(DILIGENCE_CATEGORIES.map((c) => c.key));

/**
 * The key a row's section is identified by.
 *
 * entityId is part of it: two parties filling the same repeating block are two
 * sections, not one section with doubled rows.
 */
export function sectionKey(i: GroupableItem): string {
  return `${i.groupId ?? "__ungrouped__"}::${i.entityId ?? ""}`;
}

/**
 * The heading a row's section shows.
 *
 * For an entity row the PARTY is the heading, with the section path kept as
 * context. Falls back to the block name when the entity link has gone — wrong
 * but honest, rather than inventing a party name.
 */
export function sectionLabel(i: GroupableItem): string {
  const path = [i.groupParentLabel, i.groupLabel].filter(Boolean).join(" › ");
  if (!i.entityId) return path || "Ungrouped";
  const who = i.entityName ?? i.groupLabel ?? "Unnamed party";
  return path ? `${path} — ${who}` : who;
}

/** Group by section, in FIRST-APPEARANCE order. */
export function groupBySection<T extends GroupableItem>(
  items: T[]
): ChecklistGroup<T>[] {
  // First appearance, never alphabetical: the caller sorts by the lender's own
  // numbering, and "10" sorts before "2", so an alphabetical pass would quietly
  // reorder a numbered checklist away from the document it came from.
  const by = new Map<string, T[]>();
  const order: string[] = [];
  for (const i of items) {
    const key = sectionKey(i);
    if (!by.has(key)) {
      by.set(key, []);
      order.push(key);
    }
    by.get(key)!.push(i);
  }
  return order.map((key) => ({
    key,
    label: sectionLabel(by.get(key)![0]),
    items: by.get(key)!,
  }));
}

/**
 * The combined default: canonical categories in seed order, then everything
 * else grouped by its own packet's sections.
 *
 * The "everything else" half is the fix for the 274 invisible rows. Grouping
 * the leftovers by section rather than dumping them in one "Imported" heap is
 * also the same shape the per-packet filter shows, so switching the filter no
 * longer reshuffles the page.
 */
export function groupCombined<T extends GroupableItem>(
  items: T[]
): ChecklistGroup<T>[] {
  const byCat = new Map<string, T[]>();
  for (const i of items) {
    const arr = byCat.get(i.category) ?? [];
    arr.push(i);
    byCat.set(i.category, arr);
  }
  const canonical = DILIGENCE_CATEGORIES.filter((c) => byCat.has(c.key)).map(
    (c) => ({
      key: c.key,
      label: c.label,
      blurb: c.blurb,
      items: byCat.get(c.key)!,
    })
  );
  const leftovers = items.filter((i) => !CANONICAL_KEYS.has(i.category));
  if (leftovers.length === 0) return canonical;
  return [...canonical, ...groupBySection(leftovers)];
}
