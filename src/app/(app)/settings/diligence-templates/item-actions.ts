"use server";

// =============================================================================
// Manual checklist-item editing — add / rename / retire / restore / reorder
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
// TWO SCHEMA FACTS SHAPE THESE ACTIONS. Neither is a preference.
// -----------------------------------------------------------------------------
//   1. UNIQUE (template_id, item_number) is declared inline in 0081, so it is
//      NOT DEFERRABLE. A straight two-row swap collides mid-statement. Hence the
//      three-step move in moveTemplateItem.
//   2. NOTHING IS EVER HARD-DELETED. nurock_diligence_items carries a permissive
//      RLS policy and NO GRANT, so `authenticated` has no DELETE privilege at
//      all — measured live as "permission denied for table
//      nurock_diligence_items" in a session where add and rename had just
//      succeeded. Removal is therefore always is_active=false, which also
//      honours 0081's rule that items are "retired ... never hard-deleted while
//      deals reference them (prevents orphaning live deal tracking)".
//      getTemplateDetail filters on is_active, so a retired item leaves the
//      template UI while any deal tracking it keeps its history — that asymmetry
//      is correct, not a bug.
// =============================================================================

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logDiligenceEvent } from "@/lib/diligence/audit";
import { assertDiligenceCan } from "@/lib/auth/access";
// ONE translation of database faults, shared with group-actions and the
// crosswalk. Three local copies of this logic is how they drift.
import { describeDbError as writeErrorMessage } from "@/lib/diligence/db-errors";

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
  if (error) return { error: writeErrorMessage(error) };

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
  if (error) return { error: writeErrorMessage(error) };
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
// Retire
// -----------------------------------------------------------------------------
export async function removeTemplateItem(input: {
  itemId: string;
}): Promise<{
  /** Always "retired" — see the note in the body on why nothing is deleted. */
  outcome?: "retired";
  /** Deal rows still tracking the item; 0 means it left the system cleanly. */
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

  // ---------------------------------------------------------------------------
  // ALWAYS A RETIRE. NEVER A HARD DELETE.
  // ---------------------------------------------------------------------------
  // The first version of this action hard-deleted when nothing referenced the
  // item. MEASURED LIVE 2026-09-03 on the retired test template: every such
  // delete failed with
  //
  //     permission denied for table nurock_diligence_items
  //
  // as org admin, in a session where add / rename / reorder had just succeeded.
  // That error is a PRIVILEGE error, not row security, and 0081 explains it: the
  // table has `CREATE POLICY nurock_diligence_items_all ... FOR ALL USING (true)`
  // and NO GRANT anywhere in the migration history. A policy never confers a
  // privilege — a permissive FOR ALL policy is inert without a table-level
  // grant — so `authenticated` holds SELECT/INSERT/UPDATE here and not DELETE.
  //
  // THE FIX IS TO STOP DELETING, NOT TO GRANT DELETE. Adding a DELETE privilege
  // on an org-wide catalog table to close a cosmetic gap would widen the write
  // surface on the very class of table this program has spent weeks narrowing
  // (cost_account_map, gl_to_format_line), and it would need a migration to do
  // it. Retiring achieves the whole user-visible goal — getTemplateDetail
  // filters is_active, so the item leaves the template either way — using a
  // privilege the app already holds and needing nothing from anyone.
  //
  // It is also the better record. 0081's own comment says catalog items are
  // "retired via is_active=false, never hard-deleted while deals reference
  // them"; making that unconditional means the catalog keeps its history and a
  // referenced row can never be orphaned by a future change to the reference
  // count. The deal-reference count is still read, but only to say the right
  // thing to the user.
  // ---------------------------------------------------------------------------
  const refs = await dealRefCount(supabase, input.itemId);

  const { data: updated, error } = await supabase
    .from("nurock_diligence_items")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", input.itemId)
    .select("id");
  if (error) return { error: writeErrorMessage(error) };
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
      eventType: "template_item_retired",
      // The refs count stays in the summary because it is the part a reader
      // cares about later: whether retiring this item left live deal tracking
      // pointing at it. The ACTION is the same either way now.
      summary:
        refs === 0
          ? `Retired checklist item "${item.title}" (not tracked on any deal)`
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
  return { outcome: "retired", dealRefs: refs };
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
    .select("id, template_id, item_number, group_id")
    .eq("id", input.itemId)
    .maybeSingle();
  if (!row) return { error: "Item not found." };
  const me = row as {
    id: string;
    template_id: string;
    item_number: number | null;
    group_id: string | null;
  };
  if (me.item_number == null) {
    return { error: "This item has no position to move." };
  }

  // Resolve the NEIGHBOUR by position on the server rather than trusting a
  // client-supplied index: the order the browser rendered may already be stale.
  // And item_number is SPARSE, so "previous" means "greatest number below mine",
  // never "mine − 1".
  //
  // REORDER IS WITHIN-GROUP (ASK 6). Once a template has sections, an item moves
  // among the items in ITS OWN section; the neighbour must share its group_id.
  // Without this predicate a move-up would swap positions with an item under a
  // different heading, which reorders one list by silently corrupting another.
  //
  // CONSEQUENCE, and it is correct: move-up is a no-op on the FIRST item of a
  // group even though items are visible above it on screen. Ungrouped items form
  // their own band (group_id IS NULL) and move among themselves.
  //
  // PostgREST has no "equals or is null", and .eq(col, null) matches nothing
  // rather than matching NULLs — so the ungrouped band needs the .is() form or
  // every ungrouped item would look like it had no neighbours at all.
  const base = supabase
    .from("nurock_diligence_items")
    .select("id, item_number")
    .eq("template_id", me.template_id)
    .eq("is_active", true);
  const q = me.group_id === null
    ? base.is("group_id", null)
    : base.eq("group_id", me.group_id);
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
  if (s1.error) return { error: writeErrorMessage(s1.error) };
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
    return { error: writeErrorMessage(s2.error) };
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

// -----------------------------------------------------------------------------
// Restore
// -----------------------------------------------------------------------------
// A RETIRE YOU CANNOT UNDO IS A DELETE WITH EXTRA STEPS.
//
// Removal was made unconditional (see removeTemplateItem) because the catalog
// table grants no DELETE. That was the right call, but it shipped without a way
// back, and the live session found the consequence by running the acceptance
// test I specified: retiring the test template's two original imported items,
// then enumerating the drawer's whole control set and finding no restore. Their
// words -- "the test template's original sample content is NOT recoverable from
// the browser". Correct, and my omission.
//
// Restoring cannot collide on item_number: retiring never freed the number, and
// addTemplateItem reads MAX including retired rows precisely so a later add
// cannot occupy it. So this is a pure is_active flip.
export async function restoreTemplateItem(input: {
  itemId: string;
}): Promise<{ error?: string }> {
  await assertDiligenceCan("edit");
  const supabase = (await createClient()) as AnySb;

  const { data: row } = await supabase
    .from("nurock_diligence_items")
    .select("id, title, template_id")
    .eq("id", input.itemId)
    .maybeSingle();
  if (!row) return { error: "Item not found." };
  const item = row as { id: string; title: string; template_id: string };

  const { data: updated, error } = await supabase
    .from("nurock_diligence_items")
    .update({ is_active: true, updated_at: new Date().toISOString() })
    .eq("id", input.itemId)
    .select("id");
  if (error) return { error: writeErrorMessage(error) };
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
      eventType: "template_item_restored",
      summary: `Restored checklist item "${item.title}"`,
      detail: { templateId: item.template_id, itemId: input.itemId },
    });
  }

  revalidateTemplates();
  return {};
}
