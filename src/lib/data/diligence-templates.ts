// =============================================================================
// Diligence template catalog — reads (Increment 2)
// =============================================================================
// Org-global template management: the canonical NuRock list plus imported
// investor/lender/underwriter checklists, their items, and the crosswalk that
// maps external items to canonical ones. Mutations live in the settings
// actions file; this is the read layer for the templates admin page.
//
// Untyped-accessor pattern for the not-yet-typed nurock_diligence_* tables.
// =============================================================================

import { createClient } from "@/lib/supabase/server";

export type TemplateKind =
  | "nurock_standard"
  | "investor"
  | "lender"
  | "underwriter"
  | "custom";

export interface TemplateSummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  kind: TemplateKind;
  financierName: string | null;
  isCanonical: boolean;
  isActive: boolean;
  source: string;
  itemCount: number;
}

export interface TemplateItemLite {
  id: string;
  itemNumber: number | null;
  code: string | null;
  category: string;
  title: string;
  description: string | null;
  itemType: string;
  /** Template-owned section this item sits in; NULL = ungrouped (ASK 6). */
  groupId: string | null;
}

/**
 * A template-owned section or subsection (ASK 6).
 *
 * ORGANISATIONAL ONLY. Coverage is computed from nurock_diligence_crosswalk and
 * never reads this — see the note in
 * supabase/migrations/20260903_diligence_item_groups.sql. `label` is the
 * financier's OWN wording and is deliberately independent of the canonical 15
 * categories; `code` is their own numbering, verbatim and never parsed.
 */
export interface TemplateGroup {
  id: string;
  parentGroupId: string | null;
  label: string;
  code: string | null;
  /** 0 = section, 1 = subsection, 2 = third level. Trigger-maintained. */
  depth: number;
  sortOrder: number;
  isEntityParameterized: boolean;
  entityRole: string | null;
}

export interface CanonicalItemLite {
  id: string;
  itemNumber: number | null;
  category: string;
  title: string;
}

export interface CrosswalkLink {
  canonicalItemId: string;
  externalItemId: string;
  mode: "all" | "any";
}

export interface TemplateDetail {
  template: TemplateSummary;
  /** ACTIVE items only, in item_number order. */
  items: TemplateItemLite[];
  /**
   * Retired items (is_active = false), so removal is not a one-way door.
   *
   * WHY THIS FIELD EXISTS. Removal is a retire, never a delete, and until now a
   * retired item was simply invisible with no way back. The live session hit the
   * consequence directly on 2026-09-03: running the acceptance test retired the
   * test template's two original imported items, then enumerated the drawer's
   * entire control set and found no restore — so sample data was unrecoverable
   * from the UI. A retire you cannot undo is a delete with extra steps.
   *
   * DELIBERATELY A SEPARATE LIST rather than an is_active flag on `items`.
   * `items` drives crosswalk mapping and the first/last disabling of the reorder
   * controls; folding retired rows into it would change both of those by
   * accident.
   */
  retiredItems: TemplateItemLite[];
  /**
   * Template-owned sections, already ordered for rendering (ASK 6).
   *
   * Flat, not a tree, deliberately: the drawer needs to render a heading then
   * its items then the next heading, and a nested structure would have to be
   * flattened again at the point of use. `depth` carries the indent and the
   * array is in display order, so the consumer walks it once.
   */
  groups: TemplateGroup[];
  crosswalk: CrosswalkLink[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySb = any;

export async function getDiligenceTemplates(): Promise<TemplateSummary[]> {
  const supabase = (await createClient()) as AnySb;
  const [{ data: templates }, { data: items }] = await Promise.all([
    supabase
      .from("nurock_diligence_templates")
      .select(
        "id, slug, name, description, template_kind, financier_name, is_canonical, is_active, source, sort_order"
      )
      .order("is_canonical", { ascending: false })
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase.from("nurock_diligence_items").select("template_id, is_active"),
  ]);

  const countByTemplate = new Map<string, number>();
  for (const i of (items ?? []) as Array<{
    template_id: string;
    is_active: boolean;
  }>) {
    if (!i.is_active) continue;
    countByTemplate.set(
      i.template_id,
      (countByTemplate.get(i.template_id) ?? 0) + 1
    );
  }

  return ((templates ?? []) as Array<Record<string, unknown>>).map((t) => ({
    id: t.id as string,
    slug: t.slug as string,
    name: t.name as string,
    description: (t.description as string) ?? null,
    kind: t.template_kind as TemplateKind,
    financierName: (t.financier_name as string) ?? null,
    isCanonical: Boolean(t.is_canonical),
    isActive: Boolean(t.is_active),
    source: t.source as string,
    itemCount: countByTemplate.get(t.id as string) ?? 0,
  }));
}

export async function getCanonicalItems(): Promise<CanonicalItemLite[]> {
  const supabase = (await createClient()) as AnySb;
  const { data: tmpl } = await supabase
    .from("nurock_diligence_templates")
    .select("id")
    .eq("is_canonical", true)
    .maybeSingle();
  const canonicalId = tmpl?.id as string | undefined;
  if (!canonicalId) return [];

  const { data } = await supabase
    .from("nurock_diligence_items")
    .select("id, item_number, category, title")
    .eq("template_id", canonicalId)
    .eq("is_active", true)
    .order("item_number", { ascending: true });

  return ((data ?? []) as Array<{
    id: string;
    item_number: number | null;
    category: string;
    title: string;
  }>).map((i) => ({
    id: i.id,
    itemNumber: i.item_number,
    category: i.category,
    title: i.title,
  }));
}

export async function getTemplateDetail(
  templateId: string
): Promise<TemplateDetail | null> {
  const supabase = (await createClient()) as AnySb;

  const { data: t } = await supabase
    .from("nurock_diligence_templates")
    .select(
      "id, slug, name, description, template_kind, financier_name, is_canonical, is_active, source"
    )
    .eq("id", templateId)
    .maybeSingle();
  if (!t) return null;

  // Fetch BOTH states in one query and partition below — the drawer needs the
  // retired list to offer a restore, and a second round trip for it would be
  // wasteful. `items` still means ACTIVE ONLY to every existing consumer.
  const { data: items } = await supabase
    .from("nurock_diligence_items")
    .select("id, item_number, code, category, title, description, item_type, is_active, group_id")
    .eq("template_id", templateId)
    .order("item_number", { ascending: true });

  const allRows = (items ?? []) as Array<{
    id: string;
    item_number: number | null;
    code: string | null;
    category: string;
    title: string;
    description: string | null;
    item_type: string;
    is_active: boolean;
    group_id: string | null;
  }>;

  const toLite = (i: (typeof allRows)[number]): TemplateItemLite => ({
    id: i.id,
    itemNumber: i.item_number,
    code: i.code,
    category: i.category,
    title: i.title,
    description: i.description,
    itemType: i.item_type,
    groupId: i.group_id ?? null,
  });

  const itemRows = allRows.filter((i) => i.is_active).map(toLite);
  const retiredRows = allRows.filter((i) => !i.is_active).map(toLite);

  // ---------------------------------------------------------------------------
  // Template-owned groups (ASK 6), returned FLAT AND IN DISPLAY ORDER.
  // ---------------------------------------------------------------------------
  // Ordering happens here rather than in SQL because it is a TREE walk: a
  // subsection must follow its own parent, not sit with the other subsections.
  // `ORDER BY depth, sort_order` would group all the level-1s together, which
  // reads as a flat list of headings with the hierarchy lost.
  //
  // sort_order is deliberately NON-unique (see the migration header — the
  // opposite choice to items.item_number, whose unique constraint forces a
  // three-step swap), so `label` breaks ties and ordering stays deterministic.
  const { data: groupRows } = await supabase
    .from("nurock_diligence_item_groups")
    .select(
      "id, parent_group_id, label, code, depth, sort_order, is_entity_parameterized, entity_role"
    )
    .eq("template_id", templateId);

  const rawGroups = ((groupRows ?? []) as Array<{
    id: string;
    parent_group_id: string | null;
    label: string;
    code: string | null;
    depth: number;
    sort_order: number;
    is_entity_parameterized: boolean;
    entity_role: string | null;
  }>).map((g) => ({
    id: g.id,
    parentGroupId: g.parent_group_id ?? null,
    label: g.label,
    code: g.code,
    depth: g.depth,
    sortOrder: g.sort_order,
    isEntityParameterized: g.is_entity_parameterized,
    entityRole: g.entity_role ?? null,
  }));

  const childrenOf = new Map<string | null, TemplateGroup[]>();
  for (const g of rawGroups) {
    const key = g.parentGroupId;
    const arr = childrenOf.get(key) ?? [];
    arr.push(g);
    childrenOf.set(key, arr);
  }
  for (const arr of childrenOf.values()) {
    arr.sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
  }

  // Depth-first, so each heading is immediately followed by its own subtree.
  // ITERATIVE rather than recursive, and with a visited set: the migration's
  // trigger refuses cycles, but this read must not be the thing that hangs if a
  // cycle ever exists (created out of band, or by a future migration that drops
  // the trigger). A read that can loop forever is worse than one that returns a
  // short list.
  const groups: TemplateGroup[] = [];
  const seen = new Set<string>();
  const walk = (parentId: string | null) => {
    for (const g of childrenOf.get(parentId) ?? []) {
      if (seen.has(g.id)) continue;
      seen.add(g.id);
      groups.push(g);
      walk(g.id);
    }
  };
  walk(null);
  // Anything unreachable from a root (an orphan whose parent vanished, or a
  // cycle member) is appended rather than dropped — invisible rows are how a
  // template silently loses structure.
  for (const g of rawGroups) if (!seen.has(g.id)) groups.push(g);

  // Crosswalk rows touching this template's items (external side).
  const externalItemIds = itemRows.map((i) => i.id);
  let crosswalk: CrosswalkLink[] = [];
  if (externalItemIds.length > 0) {
    const { data: xw } = await supabase
      .from("nurock_diligence_crosswalk")
      .select("canonical_item_id, external_item_id, requirement_mode")
      .in("external_item_id", externalItemIds);
    crosswalk = ((xw ?? []) as Array<{
      canonical_item_id: string;
      external_item_id: string;
      requirement_mode: "all" | "any";
    }>).map((x) => ({
      canonicalItemId: x.canonical_item_id,
      externalItemId: x.external_item_id,
      mode: x.requirement_mode,
    }));
  }

  return {
    template: {
      id: t.id,
      slug: t.slug,
      name: t.name,
      description: t.description ?? null,
      kind: t.template_kind,
      financierName: t.financier_name ?? null,
      isCanonical: Boolean(t.is_canonical),
      isActive: Boolean(t.is_active),
      source: t.source,
      itemCount: itemRows.length,
    },
    items: itemRows,
    retiredItems: retiredRows,
    groups,
    crosswalk,
  };
}

/** Active, non-canonical templates a deal can adopt as a packet. */
export async function getAdoptableTemplates(
  dealId: string
): Promise<{ adopted: TemplateSummary[]; available: TemplateSummary[] }> {
  const supabase = (await createClient()) as AnySb;
  const all = await getDiligenceTemplates();
  const external = all.filter((t) => !t.isCanonical && t.isActive);

  const { data: adoptedRows } = await supabase
    .from("dm_diligence_deal_templates")
    .select("template_id")
    .eq("deal_id", dealId);
  const adoptedIds = new Set(
    ((adoptedRows ?? []) as Array<{ template_id: string }>).map(
      (r) => r.template_id
    )
  );

  return {
    adopted: external.filter((t) => adoptedIds.has(t.id)),
    available: external.filter((t) => !adoptedIds.has(t.id)),
  };
}
