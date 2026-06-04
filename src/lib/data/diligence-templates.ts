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
  items: TemplateItemLite[];
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

  const { data: items } = await supabase
    .from("nurock_diligence_items")
    .select("id, item_number, code, category, title, description, item_type, is_active")
    .eq("template_id", templateId)
    .eq("is_active", true)
    .order("item_number", { ascending: true });

  const itemRows = ((items ?? []) as Array<{
    id: string;
    item_number: number | null;
    code: string | null;
    category: string;
    title: string;
    description: string | null;
    item_type: string;
  }>).map((i) => ({
    id: i.id,
    itemNumber: i.item_number,
    code: i.code,
    category: i.category,
    title: i.title,
    description: i.description,
    itemType: i.item_type,
  }));

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
