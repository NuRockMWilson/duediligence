"use server";

// =============================================================================
// Template-owned item groups — writes (ASK 6)
// =============================================================================
// Sections and subsections that belong to the FINANCIER'S checklist rather than
// to NuRock's 15 canonical categories. The PNC file has 12 numbered top-level
// sections with subsections beneath them and 329 items; none of its section
// names exist in the canonical list, so before this its structure had nowhere to
// land and the packet rendered flat.
//
// Backed by 20260903_diligence_item_groups.sql, applied and verified 2026-09-04
// (31 assertions across four scripts, 0 leftovers).
//
// GROUPS ARE ORGANISATIONAL. Coverage is computed from
// nurock_diligence_crosswalk and must never read this table. Wiring
// presentation into the coverage denominator is how one quantity ends up
// computed two ways.
//
// Every export is a "use server" function — a public POST endpoint that does NOT
// pass through the (app) route gate — so each calls assertDiligenceCan("edit")
// first. assertDiligenceCan, never assertDevmgmtCan: the latter fails OPEN for a
// caller with no devmgmt role, which is exactly a diligence-only user.
//
// THE DATABASE ENFORCES THE HARD RULES AND THIS FILE DOES NOT RESTATE THEM.
// Triggers refuse a fourth level, a cycle, and cross-template filing; CHECKs
// refuse a blank label and an incoherent entity_role. All are verified firing.
// So these actions TRANSLATE those refusals into sentences rather than
// re-implementing them — a second copy of a rule in the app layer is how the two
// drift, and the app copy is the one that gets forgotten.
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

/**
 * Turn a database refusal into something a person can act on.
 *
 * The trigger messages are already written for a reader ("Checklist groups nest
 * at most three levels…"), so those pass through. Only the CHECK-constraint
 * names, which are not, get translated.
 */
function groupErrorMessage(error: { message?: string; code?: string }): string {
  const raw = error.message ?? "Unknown database error.";
  if (/nurock_diligence_item_groups_entity_role_chk/i.test(raw)) {
    return "A repeating section needs an entity type, and a non-repeating one must not have it.";
  }
  if (/nurock_diligence_item_groups_label_check|btrim\(label\)/i.test(raw)) {
    return "Give the section a name.";
  }
  if (/permission denied for table/i.test(raw)) {
    return (
      "The database refused this change — the app is missing a privilege on the " +
      "checklist catalog. Nothing was changed. Please report this; it needs a " +
      "grant, not a retry."
    );
  }
  return raw;
}

// -----------------------------------------------------------------------------
// Create
// -----------------------------------------------------------------------------
export async function addTemplateGroup(input: {
  templateId: string;
  label: string;
  code: string | null;
  /** NULL for a top-level section. */
  parentGroupId: string | null;
}): Promise<{ id?: string; error?: string }> {
  await assertDiligenceCan("edit");
  const label = input.label.trim();
  if (!label) return { error: "Give the section a name." };

  const supabase = (await createClient()) as AnySb;

  // Append: one past the highest SIBLING. Read the MAX rather than counting,
  // because sort_order is non-unique and gaps are legal.
  //
  // The parent filter needs two forms: `.is(col, null)` for a top-level section
  // and `.eq(col, id)` for a subsection. PostgREST has no "equals or is null"
  // operator, and `.eq(col, null)` matches nothing rather than matching NULLs —
  // which would silently restart every top-level section at sort_order 0 and
  // pile them all at the top of the list.
  const siblingQuery = supabase
    .from("nurock_diligence_item_groups")
    .select("sort_order")
    .eq("template_id", input.templateId);
  const { data: last } = await (input.parentGroupId === null
    ? siblingQuery.is("parent_group_id", null)
    : siblingQuery.eq("parent_group_id", input.parentGroupId)
  )
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextSort = ((last as { sort_order: number } | null)?.sort_order ?? -1) + 1;

  const { data: created, error } = await supabase
    .from("nurock_diligence_item_groups")
    .insert({
      template_id: input.templateId,
      parent_group_id: input.parentGroupId,
      label,
      code: input.code?.trim() || null,
      sort_order: nextSort,
      // depth is trigger-derived and any value supplied here is overwritten —
      // verified live (script 2, check 4). Deliberately not sent.
    })
    .select("id")
    .single();
  if (error) return { error: groupErrorMessage(error) };

  {
    const authed = await createClient();
    const {
      data: { user },
    } = await authed.auth.getUser();
    await logDiligenceEvent(supabase, {
      dealId: null,
      actorUserId: user?.id ?? null,
      eventType: "template_group_added",
      summary: `Added checklist section "${label}"`,
      detail: {
        templateId: input.templateId,
        parentGroupId: input.parentGroupId,
        code: input.code?.trim() || null,
      },
    });
  }

  revalidateTemplates();
  return { id: (created as { id: string }).id };
}

// -----------------------------------------------------------------------------
// Rename / recode
// -----------------------------------------------------------------------------
export async function updateTemplateGroup(input: {
  groupId: string;
  label: string;
  code: string | null;
}): Promise<{ error?: string }> {
  await assertDiligenceCan("edit");
  const label = input.label.trim();
  if (!label) return { error: "Give the section a name." };

  const supabase = (await createClient()) as AnySb;

  const { data: before } = await supabase
    .from("nurock_diligence_item_groups")
    .select("id, label, template_id")
    .eq("id", input.groupId)
    .maybeSingle();
  if (!before) return { error: "Section not found." };
  const prev = before as { label: string; template_id: string };

  // .select() so a zero-row update fails LOUDLY instead of toasting success
  // without persisting — RLS filtering a row otherwise looks like success.
  const { data: updated, error } = await supabase
    .from("nurock_diligence_item_groups")
    .update({
      label,
      code: input.code?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.groupId)
    .select("id");
  if (error) return { error: groupErrorMessage(error) };
  if (!updated || (updated as unknown[]).length === 0) {
    return {
      error:
        "The change didn't persist — no row was updated. Check row-level security on nurock_diligence_item_groups.",
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
      eventType: "template_group_updated",
      summary:
        prev.label === label
          ? `Edited checklist section "${label}"`
          : `Renamed checklist section "${prev.label}" → "${label}"`,
      detail: { templateId: prev.template_id, groupId: input.groupId },
    });
  }

  revalidateTemplates();
  return {};
}

// -----------------------------------------------------------------------------
// Reorder — ONE UPDATE, no park-and-swap
// -----------------------------------------------------------------------------
// This is the payoff for making sort_order non-unique. Items need a three-step
// park-and-swap through a negative number because UNIQUE (template_id,
// item_number) is non-deferrable; groups just trade values, and two groups
// sharing a sort_order is legal (verified live — script 4, check 1).
export async function moveTemplateGroup(input: {
  groupId: string;
  direction: "up" | "down";
}): Promise<{ error?: string }> {
  await assertDiligenceCan("edit");
  const supabase = (await createClient()) as AnySb;

  const { data: row } = await supabase
    .from("nurock_diligence_item_groups")
    .select("id, template_id, parent_group_id, sort_order, label")
    .eq("id", input.groupId)
    .maybeSingle();
  if (!row) return { error: "Section not found." };
  const me = row as {
    id: string;
    template_id: string;
    parent_group_id: string | null;
    sort_order: number;
    label: string;
  };

  // Siblings only — a section moves among sections, a subsection among its own
  // parent's children. Resolved SERVER-SIDE rather than from a client index,
  // because the order the browser rendered may already be stale.
  let q = supabase
    .from("nurock_diligence_item_groups")
    .select("id, sort_order, label")
    .eq("template_id", me.template_id);
  q = me.parent_group_id === null
    ? q.is("parent_group_id", null)
    : q.eq("parent_group_id", me.parent_group_id);
  const { data: siblingRows } = await q;

  const siblings = ((siblingRows ?? []) as Array<{
    id: string;
    sort_order: number;
    label: string;
  }>).sort(
    (a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label)
  );

  const idx = siblings.findIndex((s) => s.id === me.id);
  if (idx < 0) return { error: "Section not found among its siblings." };
  const swapWith = siblings[input.direction === "up" ? idx - 1 : idx + 1];
  if (!swapWith) return {}; // already at the end — a no-op, not an error

  const stamp = new Date().toISOString();
  // If the two share a sort_order (legal), a straight trade is a no-op, so
  // assign explicit adjacent positions from the sorted order instead.
  const mine = swapWith.sort_order;
  const theirs = me.sort_order === swapWith.sort_order
    ? me.sort_order + (input.direction === "up" ? 1 : -1)
    : me.sort_order;

  const a = await supabase
    .from("nurock_diligence_item_groups")
    .update({ sort_order: mine, updated_at: stamp })
    .eq("id", me.id)
    .select("id");
  if (a.error) return { error: groupErrorMessage(a.error) };

  const b = await supabase
    .from("nurock_diligence_item_groups")
    .update({ sort_order: theirs, updated_at: stamp })
    .eq("id", swapWith.id)
    .select("id");
  if (b.error) {
    // Put mine back. No unique constraint means this cannot fail on a conflict.
    await supabase
      .from("nurock_diligence_item_groups")
      .update({ sort_order: me.sort_order, updated_at: stamp })
      .eq("id", me.id);
    return { error: groupErrorMessage(b.error) };
  }

  revalidateTemplates();
  return {};
}

// -----------------------------------------------------------------------------
// Delete — the section, never its items
// -----------------------------------------------------------------------------
// group_id is ON DELETE SET NULL, so the lender's requirements survive and fall
// back to ungrouped; subsections DO cascade. Both verified live (script 4,
// checks 2-4). So this is a real DELETE, unlike removeTemplateItem, which had to
// become a retire because that table grants no DELETE privilege. The groups
// table was granted DELETE deliberately for exactly this: structure is
// disposable, requirements are not.
export async function deleteTemplateGroup(input: {
  groupId: string;
}): Promise<{ detachedItems?: number; removedSubsections?: number; error?: string }> {
  await assertDiligenceCan("edit");
  const supabase = (await createClient()) as AnySb;

  const { data: row } = await supabase
    .from("nurock_diligence_item_groups")
    .select("id, label, template_id")
    .eq("id", input.groupId)
    .maybeSingle();
  if (!row) return { error: "Section not found." };
  const g = row as { label: string; template_id: string };

  // Counted BEFORE the delete, so the toast can say what happened. After the
  // cascade these rows are gone and the numbers are unrecoverable.
  const [{ count: itemCount }, { count: subCount }] = await Promise.all([
    supabase
      .from("nurock_diligence_items")
      .select("id", { count: "exact", head: true })
      .eq("group_id", input.groupId),
    supabase
      .from("nurock_diligence_item_groups")
      .select("id", { count: "exact", head: true })
      .eq("parent_group_id", input.groupId),
  ]);

  const { error } = await supabase
    .from("nurock_diligence_item_groups")
    .delete()
    .eq("id", input.groupId);
  if (error) return { error: groupErrorMessage(error) };

  {
    const authed = await createClient();
    const {
      data: { user },
    } = await authed.auth.getUser();
    await logDiligenceEvent(supabase, {
      dealId: null,
      actorUserId: user?.id ?? null,
      eventType: "template_group_deleted",
      summary: `Deleted checklist section "${g.label}" (${itemCount ?? 0} item${
        (itemCount ?? 0) === 1 ? "" : "s"
      } kept, ungrouped)`,
      detail: {
        templateId: g.template_id,
        groupId: input.groupId,
        detachedItems: itemCount ?? 0,
        removedSubsections: subCount ?? 0,
      },
    });
  }

  revalidateTemplates();
  return {
    detachedItems: itemCount ?? 0,
    removedSubsections: subCount ?? 0,
  };
}

// -----------------------------------------------------------------------------
// File an item into a section (or out of one)
// -----------------------------------------------------------------------------
export async function setTemplateItemGroup(input: {
  itemId: string;
  /** NULL removes the item from its section without deleting anything. */
  groupId: string | null;
}): Promise<{ error?: string }> {
  await assertDiligenceCan("edit");
  const supabase = (await createClient()) as AnySb;

  const { data: updated, error } = await supabase
    .from("nurock_diligence_items")
    .update({ group_id: input.groupId, updated_at: new Date().toISOString() })
    .eq("id", input.itemId)
    .select("id");
  // The same-template trigger fires here — verified live (script 3, check 4) —
  // so a cross-template filing arrives as its own message rather than silently
  // succeeding.
  if (error) return { error: groupErrorMessage(error) };
  if (!updated || (updated as unknown[]).length === 0) {
    return {
      error:
        "The change didn't persist — no row was updated. Check row-level security on nurock_diligence_items.",
    };
  }

  revalidateTemplates();
  return {};
}
