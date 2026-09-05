"use server";

// =============================================================================
// Entity catalog admin — create, rename, retire, delete
// =============================================================================
// Until now the catalog was WRITE-ONLY from the app: the org chart created
// parties and nothing could ever list or change them. Round 58 left six test
// entities that would have appeared in the org-chart dropdown on every future
// deal, removable only by hand-written SQL.
//
// -----------------------------------------------------------------------------
// RETIRE IS THE DEFAULT; DELETE IS THE EXCEPTION
// -----------------------------------------------------------------------------
// Both references to nurock_diligence_entities are ON DELETE RESTRICT, so a
// delete only succeeds for a party no deal has ever named. That is the right
// constraint and this file does not fight it: deactivating hides a party from
// every dropdown while its history stays intact, and deleting is offered only
// where it can actually work.
//
// The distinction matters more here than in most catalogs, because deleting a
// party would take its tracked checklist rows with it if the database allowed
// it — and those rows are somebody's collected documents.
//
// A NOTE ON RENAMING. Entities are org-level, so a rename is portfolio-wide and
// changes every deal that names the party. That is usually what someone wants
// (a legal name was entered wrong). When it is NOT — one deal's paperwork calls
// the same entity something else — the per-deal display_name override on
// dm_diligence_deal_entities is the tool, and the UI says so rather than
// letting someone fork the catalog to solve a one-deal problem.
// =============================================================================

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { assertDiligenceCan } from "@/lib/auth/access";
import { describeDbError } from "@/lib/diligence/db-errors";
import { logDiligenceEvent } from "@/lib/diligence/audit";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySb = any;

function revalidateEntities() {
  revalidatePath("/settings/diligence-entities");
}

export async function createCatalogEntity(input: {
  name: string;
  roleKey: string;
  notes: string | null;
}): Promise<{ id?: string; error?: string }> {
  await assertDiligenceCan("edit");
  const name = input.name.trim();
  if (!name) return { error: "Give the party a name." };
  if (!input.roleKey) return { error: "Pick a role." };

  const supabase = (await createClient()) as AnySb;

  // REUSE RATHER THAN DUPLICATE, matching what the org chart does when a name
  // is typed there. Two catalog rows with one name in one role would make every
  // later lookup ambiguous, and nothing in the schema prevents it — so the
  // check lives here, in both places that can create an entity.
  const { data: existing, error: exErr } = await supabase
    .from("nurock_diligence_entities")
    .select("id, name, is_active")
    .eq("role_key", input.roleKey);
  if (exErr) return { error: describeDbError(exErr) };
  const match = ((existing ?? []) as Array<{
    id: string;
    name: string;
    is_active: boolean;
  }>).find((e) => e.name.trim().toLowerCase() === name.toLowerCase());
  if (match) {
    return {
      error: match.is_active
        ? `"${match.name}" already exists in this role.`
        : `"${match.name}" already exists in this role but is retired — reactivate it instead of creating a second one.`,
    };
  }

  const { data, error } = await supabase
    .from("nurock_diligence_entities")
    .insert({ name, role_key: input.roleKey, notes: input.notes?.trim() || null })
    .select("id")
    .single();
  if (error) return { error: describeDbError(error) };

  revalidateEntities();
  return { id: (data as { id: string }).id };
}

export async function updateCatalogEntity(input: {
  entityId: string;
  name: string;
  notes: string | null;
}): Promise<{ error?: string }> {
  await assertDiligenceCan("edit");
  const name = input.name.trim();
  if (!name) return { error: "A party needs a name." };

  const supabase = (await createClient()) as AnySb;
  const { data, error } = await supabase
    .from("nurock_diligence_entities")
    .update({
      name,
      notes: input.notes?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.entityId)
    .select("id");
  if (error) return { error: describeDbError(error) };
  // A zero-row update is the silent-no-op shape RLS produces — the guard this
  // codebase uses on every write that could be filtered away.
  if (!data || (data as unknown[]).length === 0) {
    return {
      error:
        "The change didn't persist — no row was updated. Check row-level security on nurock_diligence_entities.",
    };
  }

  revalidateEntities();
  return {};
}

/**
 * Retire or reactivate. THE SAFE OPERATION, and the one the schema recommends.
 *
 * A retired party disappears from the org-chart dropdown but keeps every row it
 * already owns, so nothing anyone collected is lost or orphaned.
 */
export async function setCatalogEntityActive(input: {
  entityId: string;
  isActive: boolean;
}): Promise<{ error?: string }> {
  await assertDiligenceCan("edit");
  const supabase = (await createClient()) as AnySb;
  const { data, error } = await supabase
    .from("nurock_diligence_entities")
    .update({ is_active: input.isActive, updated_at: new Date().toISOString() })
    .eq("id", input.entityId)
    .select("id");
  if (error) return { error: describeDbError(error) };
  if (!data || (data as unknown[]).length === 0) {
    return {
      error:
        "The change didn't persist — no row was updated. Check row-level security on nurock_diligence_entities.",
    };
  }
  revalidateEntities();
  return {};
}

/**
 * Delete a party outright — ONLY when nothing references it.
 *
 * The usage is re-checked HERE rather than trusted from the button's state.
 * The page that rendered "deletable" may be seconds or hours old, and in
 * between someone can have adopted a packet that names this party. Without the
 * re-check the database would refuse with a raw 23503; with it, the refusal
 * says what is actually in the way.
 */
export async function deleteCatalogEntity(input: {
  entityId: string;
}): Promise<{ error?: string }> {
  await assertDiligenceCan("edit");
  const authed = await createClient();
  const {
    data: { user },
  } = await authed.auth.getUser();
  const supabase = authed as AnySb;

  const { data: ent, error: entErr } = await supabase
    .from("nurock_diligence_entities")
    .select("name")
    .eq("id", input.entityId)
    .maybeSingle();
  if (entErr) return { error: describeDbError(entErr) };
  if (!ent) return { error: "That party no longer exists." };
  const name = (ent as { name: string }).name;

  const [linkRes, itemRes] = await Promise.all([
    supabase
      .from("dm_diligence_deal_entities")
      .select("deal_id")
      .eq("entity_id", input.entityId),
    supabase
      .from("dm_diligence_deal_items")
      .select("id")
      .eq("entity_id", input.entityId),
  ]);
  if (linkRes.error) return { error: describeDbError(linkRes.error) };
  if (itemRes.error) return { error: describeDbError(itemRes.error) };

  const deals = ((linkRes.data ?? []) as unknown[]).length;
  const rows = ((itemRes.data ?? []) as unknown[]).length;
  if (deals > 0 || rows > 0) {
    // FAIL WITH THE REASON, not the error code. The database would refuse this
    // anyway; saying which deals and how many rows is the difference between a
    // dead end and a next step.
    return {
      error:
        `"${name}" is still in use — ${deals} deal${deals === 1 ? "" : "s"} name${deals === 1 ? "s" : ""} it and ${rows} checklist row${rows === 1 ? "" : "s"} belong${rows === 1 ? "s" : ""} to it. ` +
        `Remove it from those deals first, or retire it instead — retiring hides it everywhere and keeps the history.`,
    };
  }

  const { data: deleted, error } = await supabase
    .from("nurock_diligence_entities")
    .delete()
    .eq("id", input.entityId)
    .select("id");
  if (error) return { error: describeDbError(error) };
  if (!deleted || (deleted as unknown[]).length === 0) {
    return {
      error:
        "Nothing was deleted — check row-level security on nurock_diligence_entities.",
    };
  }

  await logDiligenceEvent(supabase, {
    dealId: null, // org-level: a catalog party belongs to no single deal
    actorUserId: user?.id ?? null,
    eventType: "org_chart_updated",
    summary: `Party "${name}" deleted from the entity catalog`,
    detail: { entityId: input.entityId, name },
  });

  revalidateEntities();
  return {};
}
