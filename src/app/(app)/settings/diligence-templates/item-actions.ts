"use server";

// =============================================================================
// Manual checklist-item editing — add / rename / retire / reorder
// =============================================================================
// WHY THIS EXISTS. Until now items could ONLY arrive by spreadsheet import.
// createDiligenceTemplate makes a template with zero items and there was no way
// to put an item into it, so a manually created packet was a DEAD END. That is
// not hypothetical: the live "PNC Bank - Equity" packet on Residences at
// Westview Landing sat at zero items while adopted on that deal, which also
// produced a vacuous "100% covered" badge (fixed separately in
// lib/data/diligence-rollup.ts). commitChecklistImport deliberately rolls back a
// template whose rows yield no items, which is why every empty template in the
// system arrived through the manual-create path.
//
// SEPARATE FILE, not appended to actions.ts, because that file is already 429
// lines of template/import/crosswalk logic and these four actions are one
// cohesive concern. Every export here is a "use server" function, i.e. a public
// POST endpoint that does NOT pass through the route gate — Next's own docs are
// explicit that "Server Functions are reachable via direct POST requests, not
// just through your application's UI" — so each one calls assertDiligenceCan
// first, before touching anything.
//
// GUARD CHOICE: assertDiligenceCan, NOT assertDevmgmtCan. A diligence-only user
// holds no devmgmt role, and assertDevmgmtCan fails OPEN for a roleless caller
// (bootstrap safety), so using it here would be inert on exactly the users this
// app is for. This matches every existing action in actions.ts.
//
// -----------------------------------------------------------------------------
// TWO SCHEMA FACTS SHAPE ALL FOUR ACTIONS. Neither is a preference.
// -----------------------------------------------------------------------------
//   1. UNIQUE (template_id, item_number) is declared inline in 0081, so it is
//      NOT DEFERRABLE. A straight two-row swap collides mid-statement. Hence the
//      three-step move in moveTemplateItem.
//   2. dm_diligence_deal_items.item_id REFERENCES nurock_diligence_items(id)
//      with NO ON DELETE CASCADE, and 0081 states items are "retired via
//      is_active=false, never hard-deleted while deals reference them (prevents
//      orphaning live deal tracking)". So "delete" is a RETIRE whenever a deal
//      tracks the item. getTemplateDetail filters on is_active, so a retired
//      item leaves the template UI while the deal keeps its history — that
//      asymmetry is correct, not a bug.
// =============================================================================

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logDiligenceEvent } from "@/lib/diligence/audit";
import { assertDiligenceCan } from "@/lib/auth/access";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySb = any;

function revalidateTemplates() {
  revalidatePath("/settings/diligence-templates");
}

/** Rows of dm_diligence_deal_items pointing at this catalog item. */
async function dealRefCount(supabase: AnySb, itemId: string): Promise<number> {
  const { count } = await supabase
    .from("dm_diligence_deal_items")
    .select("id", { count: "exact", head: true })
    .eq("item_id", itemId);
  return count ?? 0;
}

// -----------------------------------------------------------------------------
// Add
// -----------------------------------------------------------------------------
export async function addTemplateItem(input: {
  templateId: string;
  title: string;
  category: string;
  description: string | null;
  code: string | null;
}): Promise<{ id?: string; propagatesToDeals?: number; error?: string }> {
  await assertDiligenceCan("edit");
  const title = input.title.trim();
  if (!title) return { error: "Item title is required." };
  const category = input.category.trim() || "imported";

  const supabase = (await createClient()) as AnySb;

  const { data: tmpl } = await supabase
    .from("nurock_diligence_templates")
    .select("id, name, is_canonical")
    .eq("id", input.templateId)
    .maybeSingle();
  if (!tmpl) return { error: "Template not found." };
  const t = tmpl as { id: string; name: string; is_canonical: boolean };

  // Next item_number = max + 1. Read the MAX rather than counting rows: the
  // canonical seed numbers are SPARSE (100s, 500s, 600s) and retired rows still
  // occupy their number, so count(*) would collide with the unique constraint.
  // Not filtered on is_active for the same reason.
  const { data: last } = await supabase
    .from("nurock_diligence_items")
    .select("item_number")
    .eq("template_id", input.templateId)
    .order("item_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextNumber =
    ((last as { item_number: number | null } | null)?.item_number ?? 0) + 1;

  const { data: created, error } = await supabase
    .from("nurock_diligence_items")
    .insert({
      template_id: input.templateId,
      item_number: nextNumber,
      title,
      category,
      description: input.description?.trim() || null,
      code: input.code?.trim() || null,
      item_type: "document",
      default_required: true,
      is_active: true,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  // ADDING TO THE CANONICAL TEMPLATE IS NOT A LOCAL EDIT. ensureDealItems()
  // instantiates every active canonical item on every adopting deal at the next
  // diligence page load, so this silently lengthens live checklists across the
  // portfolio. Returned so the caller can SAY SO rather than let it happen
  // invisibly. (A packet add affects only deals that adopted that packet, and
  // only for unmapped items, so it is not surfaced the same way.)
  let propagatesToDeals = 0;
  if (t.is_canonical) {
    const { count } = await supabase
      .from("dm_diligence_deal_templates")
      .select("deal_id", { count: "exact", head: true })
      .eq("template_id", input.templateId);
    propagatesToDeals = count ?? 0;
  }

  {
    const authed = await createClient();
    const {
      data: { user },
    } = await authed.auth.getUser();
    await logDiligenceEvent(supabase, {
      dealId: null, // org-level catalog change, not a deal event
      actorUserId: user?.id ?? null,
      eventType: "template_item_added",
      summary: `Added "${title}" to checklist "${t.name}"`,
      detail: {
        templateId: input.templateId,
        itemNumber: nextNumber,
        category,
        isCanonical: t.is_canonical,
        propagatesToDeals,
      },
    });
  }

  revalidateTemplates();
  return { id: (created as { id: string }).id, propagatesToDeals };
}

// -----------------------------------------------------------------------------
// Rename / edit
// -----------------------------------------------------------------------------
export async function updateTemplateItem(input: {
  itemId: string;
  title: string;
  category: string;
  description: string | null;
  code: string | null;
}): Promise<{ error?: string }> {
  await assertDiligenceCan("edit");
  const title = input.title.trim();
  if (!title) return { error: "Item title is required." };

  const supabase = (await createClient()) as AnySb;

  const { data: before } = await supabase
    .from("nurock_diligence_items")
    .select("id, title, template_id")
    .eq("id", input.itemId)
    .maybeSingle();
  if (!before) return { error: "Item not found." };
  const prev = before as { id: string; title: string; template_id: string };

  // .select() so a zero-row update fails LOUDLY instead of toasting success
  // without persisting — the same guard setDiligenceTemplateActive uses, and the
  // reason it exists: RLS filtering a row silently produces a successful-looking
  // update that changed nothing.
  const { data: updated, error } = await supabase
    .from("nurock_diligence_items")
    .update({
      title,
      category: input.category.trim() || "imported",
      description: input.description?.trim() || null,
      code: input.code?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.itemId)
    .select("id");
  if (error) return { error: error.message };
  if (!updated || (updated as unknown[]).length === 0) {
    return {
      error:
        "The change didn't persist — no row was updated. Check row-level security on nurock_diligence_items.",
    };
  }

  {
    const authed = await createClient();
    const {
      data: { user },
    } = await authed.auth.getUser();
    await logDiligenceEvent(supabase, {
      dealId: null,
      actorUserId: user?.id ?? null,
      eventType: "template_item_updated",
      summary:
        prev.title === title
          ? `Edited checklist item "${title}"`
          : `Renamed checklist item "${prev.title}" → "${title}"`,
      detail: {
        templateId: prev.template_id,
        itemId: input.itemId,
        titleBefore: prev.title,
        titleAfter: title,
      },
    });
  }

  revalidateTemplates();
  return {};
}

// -----------------------------------------------------------------------------
// Retire (or delete, when nothing references it)
// -----------------------------------------------------------------------------
export async function removeTemplateItem(input: {
  itemId: string;
}): Promise<{
  outcome?: "deleted" | "retired";
  dealRefs?: number;
  error?: string;
}> {
  await assertDiligenceCan("edit");
  const supabase = (await createClient()) as AnySb;

  const { data: row } = await supabase
    .from("nurock_diligence_items")
    .select("id, title, template_id")
    .eq("id", input.itemId)
    .maybeSingle();
  if (!row) return { error: "Item not found." };
  const item = row as { id: string; title: string; template_id: string };

  // THE BRANCH IS THE WHOLE POINT. A hard delete of a referenced item fails on
  // the FK — and if that FK were ever loosened it would orphan live deal
  // tracking instead — so it is only attempted when nothing references the row.
  // The outcome is RETURNED, not inferred, so the UI can tell the user which of
  // the two things actually happened to their item.
  const refs = await dealRefCount(supabase, input.itemId);

  if (refs === 0) {
    const { error } = await supabase
      .from("nurock_diligence_items")
      .delete()
      .eq("id", input.itemId);
    if (error) return { error: error.message };
  } else {
    const { data: updated, error } = await supabase
      .from("nurock_diligence_items")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("id", input.itemId)
      .select("id");
    if (error) return { error: error.message };
    if (!updated || (updated as unknown[]).length === 0) {
      return {
        error:
          "The change didn't persist — no row was updated. Check row-level security on nurock_diligence_items.",
      };
    }
  }

  {
    const authed = await createClient();
    const {
      data: { user },
    } = await authed.auth.getUser();
    await logDiligenceEvent(supabase, {
      dealId: null,
      actorUserId: user?.id ?? null,
      eventType: refs === 0 ? "template_item_deleted" : "template_item_retired",
      summary:
        refs === 0
          ? `Deleted checklist item "${item.title}" (unused)`
          : `Retired checklist item "${item.title}" (still tracked on ${refs} deal item${
              refs === 1 ? "" : "s"
            })`,
      detail: {
        templateId: item.template_id,
        itemId: input.itemId,
        dealRefs: refs,
      },
    });
  }

  revalidateTemplates();
  return { outcome: refs === 0 ? "deleted" : "retired", dealRefs: refs };
}

// -----------------------------------------------------------------------------
// Reorder
// -----------------------------------------------------------------------------
export async function moveTemplateItem(input: {
  itemId: string;
  direction: "up" | "down";
}): Promise<{ error?: string }> {
  await assertDiligenceCan("edit");
  const supabase = (await createClient()) as AnySb;

  const { data: row } = await supabase
    .from("nurock_diligence_items")
    .select("id, template_id, item_number")
    .eq("id", input.itemId)
    .maybeSingle();
  if (!row) return { error: "Item not found." };
  const me = row as {
    id: string;
    template_id: string;
    item_number: number | null;
  };
  if (me.item_number == null) {
    return { error: "This item has no position to move." };
  }

  // Resolve the NEIGHBOUR by position on the server rather than trusting a
  // client-supplied index: the order the browser rendered may already be stale.
  // And item_number is SPARSE, so "previous" means "greatest number below mine",
  // never "mine − 1".
  const q = supabase
    .from("nurock_diligence_items")
    .select("id, item_number")
    .eq("template_id", me.template_id)
    .eq("is_active", true);
  const { data: neighbourRow } = await (input.direction === "up"
    ? q.lt("item_number", me.item_number).order("item_number", { ascending: false })
    : q.gt("item_number", me.item_number).order("item_number", { ascending: true })
  )
    .limit(1)
    .maybeSingle();
  if (!neighbourRow) return {}; // already at the end — a no-op, not an error
  const other = neighbourRow as { id: string; item_number: number };

  // ---------------------------------------------------------------------------
  // THREE-STEP SWAP. UNIQUE (template_id, item_number) is non-deferrable, so
  // setting mine to the neighbour's number while the neighbour still holds it
  // violates the constraint outright. Park mine at a temp value first.
  //
  // THE PARKING VALUE IS DERIVED FROM MY OWN NUMBER, NOT A CONSTANT. item_number
  // is unique within the template, so -(mine) - 1_000_000 is unique too, and two
  // concurrent moves in the same template cannot pick the same slot — which a
  // fixed sentinel like -1 would not guarantee. item_number carries no CHECK
  // constraint, so a negative value is legal.
  //
  // NOT ATOMIC, and it cannot be made atomic from here: supabase-js has no
  // multi-statement transaction, and a SQL function would be a migration, which
  // is not mine to run. So each step is checked, step 2 rolls step 1 back, and a
  // step-3 failure reports the parked number instead of failing silently. A
  // half-applied reorder is the one failure mode worth reporting from the live
  // app; everything else here surfaces as a toast.
  // ---------------------------------------------------------------------------
  const parking = -me.item_number - 1_000_000;
  const stamp = new Date().toISOString();

  const s1 = await supabase
    .from("nurock_diligence_items")
    .update({ item_number: parking, updated_at: stamp })
    .eq("id", me.id)
    .select("id");
  if (s1.error) return { error: s1.error.message };
  if (!s1.data || (s1.data as unknown[]).length === 0) {
    return {
      error:
        "Reorder didn't persist — no row was updated. Check row-level security on nurock_diligence_items.",
    };
  }

  const s2 = await supabase
    .from("nurock_diligence_items")
    .update({ item_number: me.item_number, updated_at: stamp })
    .eq("id", other.id)
    .select("id");
  if (s2.error) {
    // Put mine back so the template is not left holding a parked negative.
    await supabase
      .from("nurock_diligence_items")
      .update({ item_number: me.item_number, updated_at: stamp })
      .eq("id", me.id);
    return { error: s2.error.message };
  }

  const s3 = await supabase
    .from("nurock_diligence_items")
    .update({ item_number: other.item_number, updated_at: stamp })
    .eq("id", me.id)
    .select("id");
  if (s3.error) {
    return {
      error: `Reorder half-applied — this item is parked at position ${parking}. ${s3.error.message}`,
    };
  }

  revalidateTemplates();
  return {};
}
