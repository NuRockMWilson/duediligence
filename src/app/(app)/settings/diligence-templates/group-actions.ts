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
import { describeDbError } from "@/lib/diligence/db-errors";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySb = any;

function revalidateTemplates() {
  revalidatePath("/settings/diligence-templates");
}

/**
 * Group-specific refusals, then the shared translation for everything else.
 *
 * The trigger messages are already written for a reader ("Checklist groups nest
 * at most three levels…") so those pass straight through describeDbError. Only
 * the CHECK-constraint NAMES, which are not readable, are translated here.
 */
function groupErrorMessage(error: { message?: string; code?: string }): string {
  const raw = error.message ?? "";
  if (/nurock_diligence_item_groups_entity_role_chk/i.test(raw)) {
    return "A repeating section needs an entity type, and a non-repeating one must not have it.";
  }
  if (/nurock_diligence_item_groups_label_check|btrim\(label\)/i.test(raw)) {
    return "Give the section a name.";
  }
  return describeDbError(error);
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

// -----------------------------------------------------------------------------
// Duplicate a section, with its items and its subsections
// -----------------------------------------------------------------------------
// MEASURED FROM THE SOURCE FILE (Residences at Westview Landing - PNC DD
// Checklist, 8.26.2026), comparing each section's item titles by exact match and
// order: ELEVEN SECTIONS COLLAPSE TO THREE DISTINCT ITEM-SETS.
//
//   GP tier      5 sections x  7 identical items -> 28 entries avoided
//   Developers   3 sections x 13 identical items -> 26
//   Guarantors   3 sections x 12 identical items -> 24
//
// 78 item-entries, about a quarter of that checklist's 329 items, and the
// largest single source of hand-typing in the file. What differs between
// siblings in a family is only the SECTION NAME and the entity it refers to, so
// a copy needs no editing pass over the items. The live session checked for
// near-misses -- a family member with one extra or reworded item, which would
// make a naive copy silently wrong -- and found none.
//
// AND THE HONEST CAVEAT, WHICH MICHAEL SHOULD READ BEFORE USING IT.
// Those three families ARE the per-entity blocks. Copy and entity-binding are
// two answers to the same duplication:
//     COPY   -> five independent item-sets, each maintained separately. The
//               moment PNC changes one requirement, the change must be repeated
//               in five places or the sections silently diverge.
//     ENTITY -> ONE item-set bound to N entities (ASK 2). entity_id is already
//               on the deal-item spine and dm_diligence_signoffs keys on
//               deal_item_id, so per-entity sign-off chains come free.
// Both give separate approvals, so both are correct for sign-off. The only
// difference is maintenance drift, and drift is what this codebase has paid for
// most often. So copy exists because it serves ANY repeated section, including
// non-entity ones, and it is cheap -- but for the GP / developer / guarantor
// families specifically, entity binding is the better long-term answer.
// -----------------------------------------------------------------------------
export async function duplicateTemplateGroup(input: {
  groupId: string;
  /** Defaults to the source label plus " (copy)". */
  newLabel?: string | null;
}): Promise<{
  id?: string;
  copiedItems?: number;
  copiedSubsections?: number;
  /** Crosswalk rows carried over with the copied items. */
  copiedMappings?: number;
  error?: string;
}> {
  await assertDiligenceCan("edit");
  const supabase = (await createClient()) as AnySb;

  const { data: srcRow } = await supabase
    .from("nurock_diligence_item_groups")
    .select(
      "id, template_id, parent_group_id, label, code, sort_order, is_entity_parameterized, entity_role"
    )
    .eq("id", input.groupId)
    .maybeSingle();
  if (!srcRow) return { error: "Section not found." };
  const src = srcRow as {
    id: string;
    template_id: string;
    parent_group_id: string | null;
    label: string;
    code: string | null;
    sort_order: number;
    is_entity_parameterized: boolean;
    entity_role: string | null;
  };

  // FINDING B (live, round 53): four copies were all named exactly
  // "<name> (copy)", and the item-level section picker then listed three
  // indistinguishable options for the same label — so a user could not tell
  // which section an item was filed under. The toast does say "Rename it to
  // finish", so it was prompted rather than silent, but a prompt is not a fix.
  // Ordinal-suffix from the second copy onward.
  let label = (input.newLabel ?? "").trim();
  if (!label) {
    const base = `${src.label} (copy`;
    const taken = new Set(
      ((await supabase
        .from("nurock_diligence_item_groups")
        .select("label")
        .eq("template_id", src.template_id)
      ).data ?? [] as Array<{ label: string }>).map((g: { label: string }) => g.label)
    );
    label = `${src.label} (copy)`;
    let n = 2;
    while (taken.has(label)) {
      label = `${base} ${n})`;
      n++;
      if (n > 200) break; // a template with 200 copies has a different problem
    }
  }

  // THE WHOLE SUBTREE, not just the section. A section whose subsections were
  // dropped is not a copy of it -- the user would have to rebuild the structure
  // by hand, which is the work this action exists to remove. Read the template's
  // groups once and walk in memory rather than querying per level.
  const { data: allGroups } = await supabase
    .from("nurock_diligence_item_groups")
    .select(
      "id, parent_group_id, label, code, sort_order, is_entity_parameterized, entity_role"
    )
    .eq("template_id", src.template_id);
  type G = {
    id: string;
    parent_group_id: string | null;
    label: string;
    code: string | null;
    sort_order: number;
    is_entity_parameterized: boolean;
    entity_role: string | null;
  };
  const groups = (allGroups ?? []) as G[];
  const childrenOf = new Map<string, G[]>();
  for (const g of groups) {
    if (!g.parent_group_id) continue;
    const arr = childrenOf.get(g.parent_group_id) ?? [];
    arr.push(g);
    childrenOf.set(g.parent_group_id, arr);
  }
  for (const arr of childrenOf.values()) {
    arr.sort(
      (a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label)
    );
  }

  // Every group in the subtree, in creation order (parents first, so a child
  // always has its new parent's id available when it is inserted).
  const subtree: G[] = [];
  const walk = (id: string) => {
    for (const c of childrenOf.get(id) ?? []) {
      subtree.push(c);
      walk(c.id);
    }
  };
  walk(src.id);

  // The copy sits immediately after the source among its siblings. sort_order is
  // non-unique, so this needs no shuffling of anything else -- the deliberate
  // payoff of that choice in the groups migration.
  const { data: created, error: gErr } = await supabase
    .from("nurock_diligence_item_groups")
    .insert({
      template_id: src.template_id,
      parent_group_id: src.parent_group_id,
      label,
      code: src.code,
      sort_order: src.sort_order + 1,
      // The entity flag is carried over deliberately: if the source repeats per
      // guarantor, so does its copy. Silently dropping the flag would make the
      // copy behave differently from the thing it was copied from, which is
      // worse than letting the user turn it off.
      is_entity_parameterized: src.is_entity_parameterized,
      entity_role: src.entity_role,
    })
    .select("id")
    .single();
  if (gErr) return { error: groupErrorMessage(gErr) };
  const newRootId = (created as { id: string }).id;

  // Source group id -> new group id, so items land under the right copy.
  const idMap = new Map<string, string>([[src.id, newRootId]]);
  for (const g of subtree) {
    const newParent = g.parent_group_id ? idMap.get(g.parent_group_id) : null;
    if (!newParent) continue; // parent failed to copy; skip rather than orphan
    const { data: cg, error: cgErr } = await supabase
      .from("nurock_diligence_item_groups")
      .insert({
        template_id: src.template_id,
        parent_group_id: newParent,
        label: g.label,
        code: g.code,
        sort_order: g.sort_order,
        is_entity_parameterized: g.is_entity_parameterized,
        entity_role: g.entity_role,
      })
      .select("id")
      .single();
    if (cgErr) return { error: groupErrorMessage(cgErr) };
    idMap.set(g.id, (cg as { id: string }).id);
  }

  // Items across the whole subtree, in item_number order so the copy preserves
  // the lender's ordering -- which is the point: the families match "exactly and
  // in the same order".
  const sourceGroupIds = Array.from(idMap.keys());
  const { data: srcItems } = await supabase
    .from("nurock_diligence_items")
    .select(
      "id, item_number, code, category, title, description, item_type, default_required, group_id"
    )
    .eq("template_id", src.template_id)
    .eq("is_active", true)
    .in("group_id", sourceGroupIds)
    .order("item_number", { ascending: true });

  type I = {
    id: string;
    item_number: number | null;
    code: string | null;
    category: string;
    title: string;
    description: string | null;
    item_type: string;
    default_required: boolean;
    group_id: string | null;
  };
  const items = (srcItems ?? []) as I[];

  let copiedItems = 0;
  let copiedMappings = 0;
  if (items.length > 0) {
    // item_number must be unique per template, so the copies APPEND. Read the
    // MAX including retired rows -- a retired item still occupies its number.
    const { data: last } = await supabase
      .from("nurock_diligence_items")
      .select("item_number")
      .eq("template_id", src.template_id)
      .order("item_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    let next =
      ((last as { item_number: number | null } | null)?.item_number ?? 0) + 1;

    // Built as PAIRS so the source item id stays alongside the row that copies
    // it. Needed to repoint the crosswalk afterwards, and keeping them together
    // means the two arrays cannot fall out of step the way two separate .map()
    // passes over a filtered list would.
    const pairs = items
      .map((i) => {
        const targetGroup = i.group_id ? idMap.get(i.group_id) : null;
        if (!targetGroup) return null;
        return {
          sourceId: i.id,
          row: {
            template_id: src.template_id,
            item_number: next++,
            title: i.title,
            code: i.code,
            category: i.category,
            description: i.description,
            item_type: i.item_type,
            default_required: i.default_required,
            group_id: targetGroup,
            is_active: true,
          },
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    const payload = pairs.map((p) => p.row);
    const payloadSourceIds = pairs.map((p) => p.sourceId);

    if (payload.length > 0) {
      const { error: iErr } = await supabase
        .from("nurock_diligence_items")
        .insert(payload);
      if (iErr) {
        // Roll the groups back rather than leave an empty copy. Deleting the
        // root cascades to the copied subsections, and group_id is
        // ON DELETE SET NULL so any item that DID land is detached, not
        // destroyed.
        await supabase
          .from("nurock_diligence_item_groups")
          .delete()
          .eq("id", newRootId);
        return { error: groupErrorMessage(iErr) };
      }
      copiedItems = payload.length;

      // ===================================================================
      // FINDING A (live, round 53): THE MAPPINGS DID NOT COME WITH THE COPY.
      // ===================================================================
      // Section copy saved the 78 duplicate item ENTRIES in PNC's file and none
      // of the crosswalk work — that was still 78 mappings by hand, which is the
      // more tedious half. And it makes no sense on its own terms: the copied
      // items are the SAME requirements, so the canonical item that satisfies
      // one satisfies its twin. Carrying the mapping is the default a user would
      // assume; not carrying it is the surprise.
      //
      // canonical_item_id is kept and external_item_id is repointed at the new
      // item. Correlated by item_number, NOT by array position — PostgREST does
      // not promise insert order, and this assigned the numbers itself moments
      // ago so they are a reliable key.
      const { data: newRows } = await supabase
        .from("nurock_diligence_items")
        .select("id, item_number")
        .eq("template_id", src.template_id)
        .in("item_number", payload.map((x) => x.item_number));
      const newIdByNumber = new Map(
        ((newRows ?? []) as Array<{ id: string; item_number: number }>).map(
          (r) => [r.item_number, r.id]
        )
      );
      // Source item id -> the new item that copied it.
      const newIdBySourceId = new Map<string, string>();
      payload.forEach((row, idx) => {
        const srcId = payloadSourceIds[idx];
        const newId = newIdByNumber.get(row.item_number);
        if (srcId && newId) newIdBySourceId.set(srcId, newId);
      });

      const srcIds = Array.from(newIdBySourceId.keys());
      if (srcIds.length > 0) {
        const { data: xw, error: xwErr } = await supabase
          .from("nurock_diligence_crosswalk")
          .select("canonical_item_id, external_item_id, requirement_mode, coverage_weight")
          .in("external_item_id", srcIds);
        // AN UNREADABLE CROSSWALK IS NOT AN EMPTY ONE — the defect that hid the
        // missing table for months. Report it rather than silently copying no
        // mappings, which would look exactly like "the source had none".
        if (xwErr) {
          console.error(
            "[groups] section copied, but the crosswalk could not be read so no " +
              "mappings were carried over:",
            xwErr.message
          );
        } else {
          const rows = ((xw ?? []) as Array<{
            canonical_item_id: string;
            external_item_id: string;
            requirement_mode: "all" | "any";
            coverage_weight: number;
          }>)
            .map((x) => {
              const target = newIdBySourceId.get(x.external_item_id);
              if (!target) return null;
              return {
                canonical_item_id: x.canonical_item_id,
                external_item_id: target,
                requirement_mode: x.requirement_mode,
                coverage_weight: x.coverage_weight,
              };
            })
            .filter((x): x is NonNullable<typeof x> => x !== null);
          if (rows.length > 0) {
            const { error: cErr } = await supabase
              .from("nurock_diligence_crosswalk")
              .insert(rows);
            if (cErr) {
              // The items ARE copied and usable; only the mappings failed. Do
              // NOT roll the section back for this — losing a good copy to save
              // a re-mapping is the worse trade.
              console.error(
                "[groups] section copied, but mappings failed to copy:",
                cErr.message
              );
            } else {
              copiedMappings = rows.length;
            }
          }
        }
      }
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
      eventType: "template_group_duplicated",
      summary: `Duplicated section "${src.label}" as "${label}" (${copiedItems} item${
        copiedItems === 1 ? "" : "s"
      }, ${copiedMappings} mapping${copiedMappings === 1 ? "" : "s"})`,
      detail: {
        templateId: src.template_id,
        sourceGroupId: src.id,
        newGroupId: newRootId,
        copiedItems,
        copiedSubsections: subtree.length,
        copiedMappings,
      },
    });
  }

  revalidateTemplates();
  return {
    id: newRootId,
    copiedItems,
    copiedSubsections: subtree.length,
    copiedMappings,
  };
}
