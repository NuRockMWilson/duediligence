// =============================================================================
// Checklist filter predicates — pure, so they can be tested
// =============================================================================
// EXTRACTED BECAUSE THE SAME MISTAKE SHIPPED TWICE IN TWO ROUNDS.
//
// R2.2's packet scope asks "is this item from a financier's packet, or from the
// canonical NuRock checklist". The obvious-looking answer is `templateId ===
// null` — and it is wrong: canonical items have a template too, the canonical
// one. That assumption was written in two places.
//
//   Round 55 found the first: the packet FILTER rendered on every deal, because
//   the "does this deal have a packet" test could never be false.
//   Round 56 found the second: "NuRock standard only" returned 0 of 97 while
//   the CSV export listed 59 canonical rows on the same deal — the filter and
//   the export disagreeing about the same items.
//
// The first fix corrected one site and left the other, which is exactly how the
// bug survived into a second round. So the decision lives here once, and the
// tests below pin the property that broke: an item is either canonical or from
// a packet, never neither, and the two scopes must partition the list.
//
// The wider pattern this program keeps hitting: two implementations of one
// concept, drifting. A predicate that only one caller can see is a predicate
// nobody can check.
// =============================================================================

/** The only fields a scope decision needs. Deliberately narrow. */
export interface PacketScopedItem {
  templateId: string | null;
  isCanonicalTemplate: boolean;
}

export const PACKET_SCOPE_ALL = "__all__";
export const PACKET_SCOPE_CANONICAL = "__canonical__";

/**
 * Does this item belong in the current packet scope?
 *
 * `scope` is PACKET_SCOPE_ALL, PACKET_SCOPE_CANONICAL, or a template id.
 */
export function matchesPacketScope(
  item: PacketScopedItem,
  scope: string
): boolean {
  if (scope === PACKET_SCOPE_ALL) return true;
  // CANONICAL IS A FACT ABOUT THE TEMPLATE, NOT THE ABSENCE OF ONE.
  if (scope === PACKET_SCOPE_CANONICAL) return item.isCanonicalTemplate;
  return item.templateId === scope;
}

/**
 * The packets — NOT the canonical checklist — that contributed items.
 *
 * Derived from the items actually on the checklist rather than from adopted
 * templates, deliberately: unadopting a packet only removes UNTOUCHED
 * instances, so a retired template's worked items legitimately remain and a
 * filter that hid them would hide rows that are really there.
 */
export function packetsPresent<
  T extends PacketScopedItem & { templateName: string | null; financierName: string | null },
>(items: T[]): Array<{ value: string; label: string }> {
  const seen = new Map<string, string>();
  for (const i of items) {
    if (i.isCanonicalTemplate) continue;
    if (i.templateId && !seen.has(i.templateId)) {
      seen.set(i.templateId, i.templateName ?? i.financierName ?? "Packet");
    }
  }
  return Array.from(seen.entries()).map(([value, label]) => ({ value, label }));
}
