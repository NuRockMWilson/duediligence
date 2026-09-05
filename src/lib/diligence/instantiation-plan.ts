// =============================================================================
// Which packet items become deal rows, and in what shape
// =============================================================================
// PURE, AND EXTRACTED BECAUSE THE DECISION HAS THREE INPUTS AND GETTING ANY ONE
// OF THEM EMPTY CHANGES THE ANSWER SILENTLY.
//
// A packet item can end up one of three ways:
//
//   VIRTUAL       it is crosswalk-mapped, so its coverage flows through the
//                 canonical item that satisfies it and it needs no row
//   STANDALONE    unmapped and not in a repeating section — one plain row
//   PER-ENTITY    inside a section flagged is_entity_parameterized — one row
//                 per named party of that section's role, and NOTHING if no
//                 party of that role is named
//
// THE LAST CLAUSE IS THE ONE THAT BROKE. Round 61 adopted a 242-item packet
// with no parties and got 242 rows instead of 210: all 32 items inside the
// repeating blocks were written as ordinary standalone rows, filed under
// headings like "GP Entity" on a deal with no GP. Two pieces of the product's
// own copy promise those sections will not appear until a party is named, and
// Michael's spec is explicit — the org chart determines those sections "based
// on how many entries are entered". Zero entries means zero sections.
//
// The cause was an unchecked query error making paramGroupRole empty, and an
// empty paramGroupRole excludes nothing. Which is the real lesson here: every
// one of these three inputs FAILS TOWARD OVER-INSTANTIATION when it comes back
// empty. An empty mappedSet makes everything standalone; an empty
// paramGroupRole makes repeating items standalone; an empty entitiesByRole
// makes parameterized sections vanish. The caller must therefore distinguish
// "empty" from "unreadable" BEFORE calling this — this function cannot, and
// says so rather than pretending otherwise.
// =============================================================================

export interface PacketItem {
  id: string;
  default_required: boolean;
  group_id: string | null;
}

export interface InstantiationPlan {
  /** Unmapped, ungrouped-or-unparameterized items: one row each. */
  standalone: Array<{ id: string; default_required: boolean }>;
  /** One row per (item, party) for items in a repeating section. */
  entityScoped: Array<{
    id: string;
    default_required: boolean;
    entity_id: string;
  }>;
  /**
   * Items inside a repeating section that produced NOTHING because no party of
   * their role is named. Not an error — the designed behaviour — but worth
   * returning so a caller can say "32 requirements are waiting on your org
   * chart" instead of leaving them silently absent.
   */
  awaitingParties: number;
}

export function planInstantiation(input: {
  items: PacketItem[];
  /** External item ids that are crosswalk-mapped, so they stay virtual. */
  mapped: Set<string>;
  /** Item ids already on the deal, unscoped. */
  have: Set<string>;
  /** `${itemId}|${entityId}` pairs already on the deal. */
  havePair: Set<string>;
  /** group_id -> entity_role, for groups flagged is_entity_parameterized. */
  paramGroupRole: Map<string, string>;
  /** entity_role -> the deal's party ids in that role. */
  entitiesByRole: Map<string, string[]>;
}): InstantiationPlan {
  const { items, mapped, have, havePair, paramGroupRole, entitiesByRole } = input;

  const isParameterized = (i: PacketItem) =>
    i.group_id != null && paramGroupRole.has(i.group_id);

  const standalone = items
    .filter((i) => !mapped.has(i.id) && !have.has(i.id) && !isParameterized(i))
    .map((i) => ({ id: i.id, default_required: i.default_required }));

  const entityScoped: InstantiationPlan["entityScoped"] = [];
  let awaitingParties = 0;
  for (const item of items) {
    if (!isParameterized(item)) continue;
    const role = paramGroupRole.get(item.group_id!)!;
    const parties = entitiesByRole.get(role) ?? [];
    if (parties.length === 0) {
      // NOTHING, deliberately. A "GP Entity" row with no GP names a party that
      // does not exist and belongs to nobody.
      awaitingParties++;
      continue;
    }
    for (const entityId of parties) {
      if (havePair.has(`${item.id}|${entityId}`)) continue;
      entityScoped.push({
        id: item.id,
        default_required: item.default_required,
        entity_id: entityId,
      });
    }
  }

  return { standalone, entityScoped, awaitingParties };
}
