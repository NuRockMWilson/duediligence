"use server";

// =============================================================================
// Diligence template admin actions (Increment 2)
// =============================================================================
// Create / retire templates, import an investor/lender checklist from Excel or
// CSV (parse → preview → commit), and manage the canonical↔external crosswalk.
// Spreadsheet parsing reuses the `xlsx` server-side pattern from the invoice
// import. Untyped accessor for the not-yet-typed nurock_diligence_* tables.
// =============================================================================

import { revalidatePath } from "next/cache";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/server";
import { logDiligenceEvent } from "@/lib/diligence/audit";
import {
  getTemplateDetail,
  type TemplateKind,
  type TemplateDetail,
} from "@/lib/data/diligence-templates";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySb = any;

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${base || "template"}-${crypto.randomUUID().slice(0, 6)}`;
}

function revalidateTemplates() {
  revalidatePath("/settings/diligence-templates");
}

/** Client-callable wrapper around the read layer (for the detail drawer). */
export async function loadTemplateDetail(
  templateId: string
): Promise<TemplateDetail | null> {
  return getTemplateDetail(templateId);
}

// -----------------------------------------------------------------------------
// Create / retire templates
// -----------------------------------------------------------------------------
export async function createDiligenceTemplate(input: {
  name: string;
  kind: TemplateKind;
  financierName: string | null;
  description: string | null;
}): Promise<{ id?: string; error?: string }> {
  const name = input.name.trim();
  if (!name) return { error: "Template name is required." };
  if (input.kind === "nurock_standard")
    return { error: "Only one canonical template is allowed." };

  const supabase = (await createClient()) as AnySb;
  const { data, error } = await supabase
    .from("nurock_diligence_templates")
    .insert({
      slug: slugify(name),
      name,
      description: input.description?.trim() || null,
      template_kind: input.kind,
      financier_name: input.financierName?.trim() || null,
      source: "manual",
      is_canonical: false,
      is_active: true,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  revalidateTemplates();
  return { id: (data as { id: string }).id };
}

export async function setDiligenceTemplateActive(input: {
  templateId: string;
  active: boolean;
}): Promise<{ error?: string }> {
  const supabase = (await createClient()) as AnySb;
  // Guard: never retire the canonical template.
  const { data: t } = await supabase
    .from("nurock_diligence_templates")
    .select("is_canonical")
    .eq("id", input.templateId)
    .maybeSingle();
  if (!input.active && (t as { is_canonical: boolean } | null)?.is_canonical) {
    return { error: "The canonical template can't be retired." };
  }
  // .select() so a zero-row update (e.g. RLS silently filtering the row)
  // fails loudly instead of toasting success without persisting.
  const { data: updated, error } = await supabase
    .from("nurock_diligence_templates")
    .update({ is_active: input.active, updated_at: new Date().toISOString() })
    .eq("id", input.templateId)
    .select("id");
  if (error) return { error: error.message };
  if (!updated || (updated as unknown[]).length === 0) {
    return {
      error:
        "The change didn't persist — no row was updated. Check row-level security on nurock_diligence_templates.",
    };
  }
  revalidateTemplates();
  return {};
}

// -----------------------------------------------------------------------------
// Import — parse, then commit
// -----------------------------------------------------------------------------
export interface ParsedSheet {
  headers: string[];
  rows: string[][];
}

/** Parse an uploaded .xlsx/.csv into a header row + string data rows. */
export async function previewChecklistImport(
  formData: FormData
): Promise<{ sheet?: ParsedSheet; error?: string }> {
  const file = formData.get("file") as File | null;
  if (!file || !(file instanceof File)) return { error: "No file provided." };

  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buf, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) return { error: "The file has no readable sheet." };

    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      defval: null,
      raw: false,
    });

    // Find the header row: first row with >= 2 non-empty cells.
    let headerIdx = aoa.findIndex(
      (r) => r.filter((c) => c != null && String(c).trim() !== "").length >= 2
    );
    if (headerIdx < 0) headerIdx = 0;

    const headers = (aoa[headerIdx] ?? []).map((c, i) =>
      c != null && String(c).trim() !== "" ? String(c).trim() : `Column ${i + 1}`
    );
    const rows = aoa
      .slice(headerIdx + 1)
      .map((r) => headers.map((_, i) => (r[i] != null ? String(r[i]).trim() : "")))
      .filter((r) => r.some((c) => c !== ""));

    if (rows.length === 0)
      return { error: "No data rows found beneath the header." };

    return { sheet: { headers, rows } };
  } catch (e) {
    return { error: `Could not parse file: ${(e as Error).message}` };
  }
}

export interface ImportColumnMapping {
  title: number; // required column index
  category: number | null;
  description: number | null;
  code: number | null;
}

export async function commitChecklistImport(input: {
  name: string;
  kind: TemplateKind;
  financierName: string | null;
  rows: string[][];
  mapping: ImportColumnMapping;
  source: "import_excel" | "import_csv";
}): Promise<{ templateId?: string; itemCount?: number; error?: string }> {
  const name = input.name.trim();
  if (!name) return { error: "Template name is required." };
  if (input.mapping.title == null || input.mapping.title < 0)
    return { error: "Map a column to the item title." };

  const supabase = (await createClient()) as AnySb;

  const { data: tmpl, error: tErr } = await supabase
    .from("nurock_diligence_templates")
    .insert({
      slug: slugify(name),
      name,
      template_kind: input.kind,
      financier_name: input.financierName?.trim() || null,
      source: input.source,
      is_canonical: false,
      is_active: true,
    })
    .select("id")
    .single();
  if (tErr) return { error: tErr.message };
  const templateId = (tmpl as { id: string }).id;

  const m = input.mapping;
  const items = input.rows
    .map((r, idx) => {
      const title = (r[m.title] ?? "").trim();
      if (!title) return null;
      return {
        template_id: templateId,
        item_number: idx + 1,
        title,
        category:
          m.category != null && r[m.category]?.trim()
            ? r[m.category].trim()
            : "imported",
        description:
          m.description != null && r[m.description]?.trim()
            ? r[m.description].trim()
            : null,
        code: m.code != null && r[m.code]?.trim() ? r[m.code].trim() : null,
        item_type: "document",
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  if (items.length === 0) {
    // Roll back the empty template.
    await supabase.from("nurock_diligence_templates").delete().eq("id", templateId);
    return { error: "No items had a non-empty title." };
  }

  const { error: iErr } = await supabase
    .from("nurock_diligence_items")
    .insert(items);
  if (iErr) {
    await supabase.from("nurock_diligence_templates").delete().eq("id", templateId);
    return { error: iErr.message };
  }

  {
    const authed = await createClient();
    const {
      data: { user },
    } = await authed.auth.getUser();
    await logDiligenceEvent(supabase, {
      dealId: null, // org-level event — no deal
      actorUserId: user?.id ?? null,
      eventType: "template_imported",
      summary: `Imported checklist "${name}" (${items.length} items, ${input.source === "import_csv" ? "CSV" : "Excel"})`,
      detail: { templateId, itemCount: items.length, source: input.source },
    });
  }

  revalidateTemplates();
  return { templateId, itemCount: items.length };
}

// -----------------------------------------------------------------------------
// Crosswalk
// -----------------------------------------------------------------------------
export async function addCrosswalkMapping(input: {
  canonicalItemId: string;
  externalItemId: string;
  mode?: "all" | "any";
}): Promise<{ error?: string }> {
  const supabase = (await createClient()) as AnySb;
  const { error } = await supabase.from("nurock_diligence_crosswalk").upsert(
    {
      canonical_item_id: input.canonicalItemId,
      external_item_id: input.externalItemId,
      requirement_mode: input.mode ?? "all",
    },
    { onConflict: "canonical_item_id,external_item_id", ignoreDuplicates: true }
  );
  if (error) return { error: error.message };
  revalidateTemplates();
  return {};
}

export async function removeCrosswalkMapping(input: {
  canonicalItemId: string;
  externalItemId: string;
}): Promise<{ error?: string }> {
  const supabase = (await createClient()) as AnySb;
  const { error } = await supabase
    .from("nurock_diligence_crosswalk")
    .delete()
    .eq("canonical_item_id", input.canonicalItemId)
    .eq("external_item_id", input.externalItemId);
  if (error) return { error: error.message };
  revalidateTemplates();
  return {};
}

/** requirement_mode is per external item — apply to all its crosswalk rows. */
export async function setCrosswalkMode(input: {
  externalItemId: string;
  mode: "all" | "any";
}): Promise<{ error?: string }> {
  const supabase = (await createClient()) as AnySb;
  const { error } = await supabase
    .from("nurock_diligence_crosswalk")
    .update({ requirement_mode: input.mode, updated_at: new Date().toISOString() })
    .eq("external_item_id", input.externalItemId);
  if (error) return { error: error.message };
  revalidateTemplates();
  return {};
}

// -----------------------------------------------------------------------------
// Per-deal adoption (called from the diligence page's packet picker)
// -----------------------------------------------------------------------------
export async function adoptTemplateForDeal(input: {
  dealId: string;
  templateId: string;
}): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const sb = supabase as AnySb;
  const { error } = await sb.from("dm_diligence_deal_templates").upsert(
    {
      deal_id: input.dealId,
      template_id: input.templateId,
      adopted_by: user?.id ?? null,
    },
    { onConflict: "deal_id,template_id", ignoreDuplicates: true }
  );
  if (error) return { error: error.message };

  await logDiligenceEvent(sb, {
    dealId: input.dealId,
    actorUserId: user?.id ?? null,
    eventType: "packet_attached",
    summary: "Packet attached to the deal",
    detail: { templateId: input.templateId },
  });

  revalidatePath(`/deals/${input.dealId}/diligence`);
  revalidatePath(`/deals/${input.dealId}/dashboard`);
  return {};
}

export async function unadoptTemplateForDeal(input: {
  dealId: string;
  templateId: string;
}): Promise<{ error?: string }> {
  const authed = await createClient();
  const {
    data: { user },
  } = await authed.auth.getUser();
  const supabase = authed as AnySb;
  const { error } = await supabase
    .from("dm_diligence_deal_templates")
    .delete()
    .eq("deal_id", input.dealId)
    .eq("template_id", input.templateId);
  if (error) return { error: error.message };

  // Part 2: clean up the packet's STANDALONE item instances — but only the
  // untouched ones (still not started, no documents, no sign-offs). Instances
  // someone has worked keep their history and stay on the checklist.
  {
    const { data: tmplItems } = await supabase
      .from("nurock_diligence_items")
      .select("id")
      .eq("template_id", input.templateId);
    const itemIds = ((tmplItems ?? []) as Array<{ id: string }>).map((r) => r.id);
    if (itemIds.length > 0) {
      const { data: instances } = await supabase
        .from("dm_diligence_deal_items")
        .select("id")
        .eq("deal_id", input.dealId)
        .in("item_id", itemIds)
        .eq("status", "not_started");
      const instanceIds = ((instances ?? []) as Array<{ id: string }>).map(
        (r) => r.id
      );
      if (instanceIds.length > 0) {
        const [{ data: withDocs }, { data: withSignoffs }] = await Promise.all([
          supabase
            .from("dm_diligence_item_documents")
            .select("deal_item_id")
            .in("deal_item_id", instanceIds),
          supabase
            .from("dm_diligence_signoffs")
            .select("deal_item_id")
            .in("deal_item_id", instanceIds),
        ]);
        const touched = new Set([
          ...((withDocs ?? []) as Array<{ deal_item_id: string }>).map(
            (r) => r.deal_item_id
          ),
          ...((withSignoffs ?? []) as Array<{ deal_item_id: string }>).map(
            (r) => r.deal_item_id
          ),
        ]);
        const removable = instanceIds.filter((id) => !touched.has(id));
        if (removable.length > 0) {
          await supabase
            .from("dm_diligence_deal_items")
            .delete()
            .in("id", removable);
        }
      }
    }
  }

  await logDiligenceEvent(supabase, {
    dealId: input.dealId,
    actorUserId: user?.id ?? null,
    eventType: "packet_removed",
    summary: "Packet removed from the deal",
    detail: { templateId: input.templateId },
  });

  revalidatePath(`/deals/${input.dealId}/diligence`);
  revalidatePath(`/deals/${input.dealId}/dashboard`);
  return {};
}
