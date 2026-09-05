// =============================================================================
// The entity catalog — org-level parties, and where each one is in use
// =============================================================================
// Entities are ORG-LEVEL on purpose: NuRock's guarantors are the same three
// people across most deals, so a per-deal table would have meant retyping
// "Robby Block" on every deal with no way to see his items across the
// portfolio.
//
// The cost of that choice is that entities have, until now, been WRITE-ONLY
// from the app. The org chart creates them; nothing lists, renames, retires or
// removes them. Live round 58 left six test parties in the catalog that will
// appear in the org-chart dropdown on every future deal, with no UI able to
// touch them — they needed hand-written SQL to clear.
//
// USAGE COUNTS ARE THE POINT OF THIS READ, not decoration. Both references to
// nurock_diligence_entities are ON DELETE RESTRICT, so a delete of an entity
// that any deal still names FAILS at the database. Showing the counts lets the
// UI offer delete only where it can actually succeed, and explain the block
// where it cannot, instead of surfacing a 23503 as a mystery.
// =============================================================================

import { createClient } from "@/lib/supabase/server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySb = any;

export interface EntityRoleRow {
  key: string;
  label: string;
  description: string | null;
  sortOrder: number;
}

export interface CatalogEntity {
  id: string;
  name: string;
  roleKey: string;
  roleLabel: string;
  notes: string | null;
  isActive: boolean;
  /** Deals that name this party. */
  dealCount: number;
  /** Checklist rows scoped to this party, across every deal. */
  itemCount: number;
  /** True only when nothing references it — the one case delete can succeed. */
  deletable: boolean;
}

export interface EntityCatalog {
  roles: EntityRoleRow[];
  entities: CatalogEntity[];
}

export async function getEntityCatalog(): Promise<EntityCatalog> {
  const supabase = (await createClient()) as AnySb;

  const [rolesRes, entRes, linkRes, itemRes] = await Promise.all([
    supabase
      .from("nurock_diligence_entity_roles")
      .select("key, label, description, sort_order")
      .order("sort_order"),
    supabase
      .from("nurock_diligence_entities")
      .select("id, name, role_key, notes, is_active")
      .order("name"),
    supabase.from("dm_diligence_deal_entities").select("entity_id, deal_id"),
    // Only rows that actually carry an entity. A full-table scan of the spine
    // would be far larger and answer the same question.
    supabase
      .from("dm_diligence_deal_items")
      .select("entity_id")
      .not("entity_id", "is", null),
  ]);

  const roles: EntityRoleRow[] = (
    (rolesRes.data ?? []) as Array<{
      key: string;
      label: string;
      description: string | null;
      sort_order: number;
    }>
  ).map((r) => ({
    key: r.key,
    label: r.label,
    description: r.description,
    sortOrder: r.sort_order,
  }));
  const roleLabel = new Map(roles.map((r) => [r.key, r.label]));

  // DISTINCT DEALS, not link rows. The primary key is (deal_id, entity_id) so
  // they cannot differ today — counted properly anyway, because "used on 3
  // deals" is the sentence the UI writes, and a count that only happens to be
  // right is a count waiting to be wrong.
  const dealsByEntity = new Map<string, Set<string>>();
  for (const l of (linkRes.data ?? []) as Array<{
    entity_id: string;
    deal_id: string;
  }>) {
    const s = dealsByEntity.get(l.entity_id) ?? new Set<string>();
    s.add(l.deal_id);
    dealsByEntity.set(l.entity_id, s);
  }

  const itemsByEntity = new Map<string, number>();
  for (const i of (itemRes.data ?? []) as Array<{ entity_id: string | null }>) {
    if (!i.entity_id) continue;
    itemsByEntity.set(i.entity_id, (itemsByEntity.get(i.entity_id) ?? 0) + 1);
  }

  const entities: CatalogEntity[] = (
    (entRes.data ?? []) as Array<{
      id: string;
      name: string;
      role_key: string;
      notes: string | null;
      is_active: boolean;
    }>
  ).map((e) => {
    const dealCount = dealsByEntity.get(e.id)?.size ?? 0;
    const itemCount = itemsByEntity.get(e.id) ?? 0;
    return {
      id: e.id,
      name: e.name,
      roleKey: e.role_key,
      roleLabel: roleLabel.get(e.role_key) ?? e.role_key,
      notes: e.notes,
      isActive: e.is_active,
      dealCount,
      itemCount,
      // BOTH must be zero. Either reference blocks the delete at the database,
      // and offering a button that cannot work is worse than not offering one.
      deletable: dealCount === 0 && itemCount === 0,
    };
  });

  return { roles, entities };
}
