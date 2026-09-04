"use server";

// =============================================================================
// The org chart — the deal's named parties, typed before a packet is adopted
// =============================================================================
// Michael's spec, verbatim: "before you import the template into an actual due
// diligence list, you type in the organizational chart, which determines the GP
// sections, developers, guarantors, and loans to populate all the relevant
// sections based on how many entries are entered."
//
// So this is the step that turns a template's REPEATING BLOCK into a deal's
// ACTUAL ROWS. The importer collapses PNC's five GP subsections into one block
// flagged "repeats per general_partner"; naming three GP entities here makes
// that block produce three sets of items on this deal. The count comes from the
// org chart, never from the lender's file — PNC's file happened to have five GP
// tiers because Westview has five, and the next deal will not.
//
// -----------------------------------------------------------------------------
// WHY ENTITIES ARE ORG-LEVEL AND DEAL LINKS ARE SEPARATE
// -----------------------------------------------------------------------------
// nurock_diligence_entities is a catalog; dm_diligence_deal_entities links a
// catalog row to a deal. NuRock's guarantors are the same three people across
// most deals, so a per-deal entity table would have re-typed "Robby Block" on
// every deal with no way to see his items across the portfolio. The cost of
// sharing is that a rename touches every deal, which is what display_name on
// the link row exists to absorb.
//
// REUSE IS BY EXACT NAME AND ROLE, case-insensitively. "Robby Block" as a
// guarantor is the same catalog row every time; "Robby Block" as a developer is
// a different row, because the role is part of what the entity IS. Fuzzy
// matching was considered and rejected: silently binding "R Block Development"
// to "R Block Development, LLC" would attach one deal's documents to another
// deal's entity, and the failure would be invisible.
//
// NOTHING IS DELETED HERE. Removing a party from a deal removes the LINK; the
// catalog row stays, because ON DELETE RESTRICT on the link means a catalog
// delete would either fail or orphan tracked items. See the migration's note.
// =============================================================================

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logDiligenceEvent } from "@/lib/diligence/audit";
import { assertDiligenceCan } from "@/lib/auth/access";
import { describeDbError } from "@/lib/diligence/db-errors";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySb = any;

export interface OrgChartRole {
  key: string;
  label: string;
  /** How many of the template's blocks repeat over this role. */
  blockCount: number;
  /** The blocks' names, so the user can see what they are filling. */
  blockLabels: string[];
}

export interface DealEntityRow {
  entityId: string;
  name: string;
  displayName: string | null;
  roleKey: string;
  sortOrder: number;
}

/**
 * What a template needs before it can be adopted, and what the deal already
 * has.
 *
 * Returns roles: [] for a template with no repeating blocks — the ordinary
 * case, and the signal to the UI that adoption can proceed straight away
 * rather than showing an empty org-chart step.
 */
export async function getOrgChartRequirements(input: {
  dealId: string;
  templateId: string;
}): Promise<{
  roles?: OrgChartRole[];
  existing?: DealEntityRow[];
  error?: string;
}> {
  await assertDiligenceCan("view");
  const supabase = (await createClient()) as AnySb;

  const { data: groups, error: gErr } = await supabase
    .from("nurock_diligence_item_groups")
    .select("id, label, entity_role")
    .eq("template_id", input.templateId)
    .eq("is_entity_parameterized", true);
  if (gErr) return { error: describeDbError(gErr) };

  const byRole = new Map<string, string[]>();
  for (const g of (groups ?? []) as Array<{
    label: string;
    entity_role: string | null;
  }>) {
    if (!g.entity_role) continue;
    const arr = byRole.get(g.entity_role) ?? [];
    arr.push(g.label);
    byRole.set(g.entity_role, arr);
  }

  // Labels for the roles actually used, from the catalog. Falling back to the
  // raw key rather than dropping the role: a role present on a group but absent
  // from the catalog is a data problem the user must still be able to see and
  // fill, not one to hide by rendering nothing.
  let roleLabels = new Map<string, string>();
  if (byRole.size > 0) {
    const { data: roleRows, error: rErr } = await supabase
      .from("nurock_diligence_entity_roles")
      .select("key, label")
      .in("key", Array.from(byRole.keys()));
    if (rErr) return { error: describeDbError(rErr) };
    roleLabels = new Map(
      ((roleRows ?? []) as Array<{ key: string; label: string }>).map((r) => [
        r.key,
        r.label,
      ])
    );
  }

  const roles: OrgChartRole[] = Array.from(byRole.entries()).map(
    ([key, labels]) => ({
      key,
      label: roleLabels.get(key) ?? key.replace(/_/g, " "),
      blockCount: labels.length,
      blockLabels: labels,
    })
  );
  roles.sort((a, b) => a.label.localeCompare(b.label));

  const { data: links, error: lErr } = await supabase
    .from("dm_diligence_deal_entities")
    .select(
      "entity_id, display_name, sort_order, nurock_diligence_entities ( name, role_key )"
    )
    .eq("deal_id", input.dealId)
    .order("sort_order");
  if (lErr) return { error: describeDbError(lErr) };

  const existing: DealEntityRow[] = (
    (links ?? []) as Array<{
      entity_id: string;
      display_name: string | null;
      sort_order: number;
      nurock_diligence_entities: { name: string; role_key: string } | null;
    }>
  )
    .filter((l) => l.nurock_diligence_entities !== null)
    .map((l) => ({
      entityId: l.entity_id,
      name: l.nurock_diligence_entities!.name,
      displayName: l.display_name,
      roleKey: l.nurock_diligence_entities!.role_key,
      sortOrder: l.sort_order,
    }));

  return { roles, existing };
}

export interface OrgChartEntry {
  /** An existing catalog entity, when the user picked one. */
  entityId?: string;
  /** A name typed in. Reused if an active entity already has it in this role. */
  name?: string;
  roleKey: string;
}

/**
 * Write the deal's org chart: create any new catalog entities, then link them
 * all to the deal.
 *
 * IDEMPOTENT AND ADDITIVE. Re-running with the same entries changes nothing,
 * and entries already linked are left alone — this is called from the adoption
 * dialog, which a user may open twice, and from the standalone editor.
 *
 * It does NOT remove links absent from the input. A party dropped from the form
 * is removed explicitly through removeDealEntity, because silently unlinking
 * would silently strip that party's tracked items from the checklist, and
 * "populate based on how many entries are entered" is about creating rows, not
 * reconciling deletions the user did not ask for.
 */
export async function saveDealOrgChart(input: {
  dealId: string;
  entries: OrgChartEntry[];
}): Promise<{ linked?: number; created?: number; error?: string }> {
  await assertDiligenceCan("edit");

  const authed = await createClient();
  const {
    data: { user },
  } = await authed.auth.getUser();
  const supabase = authed as AnySb;

  // Normalise and drop blanks. An empty row in the form is someone who started
  // typing and stopped, not a party named "".
  const entries = input.entries
    .map((e) => ({
      entityId: e.entityId,
      name: (e.name ?? "").trim(),
      roleKey: e.roleKey,
    }))
    .filter((e) => e.entityId || e.name);
  if (entries.length === 0) return { linked: 0, created: 0 };

  for (const e of entries) {
    if (!e.roleKey) return { error: "Every party needs a role." };
  }

  // ---------------------------------------------------------------------------
  // Resolve typed names against the catalog before creating anything
  // ---------------------------------------------------------------------------
  const typed = entries.filter((e) => !e.entityId && e.name);
  const resolvedIds = new Map<string, string>(); // `${role}|${lowername}` -> id
  if (typed.length > 0) {
    const { data: found, error: fErr } = await supabase
      .from("nurock_diligence_entities")
      .select("id, name, role_key")
      .eq("is_active", true)
      .in("role_key", Array.from(new Set(typed.map((t) => t.roleKey))));
    if (fErr) return { error: describeDbError(fErr) };
    for (const r of (found ?? []) as Array<{
      id: string;
      name: string;
      role_key: string;
    }>) {
      resolvedIds.set(`${r.role_key}|${r.name.trim().toLowerCase()}`, r.id);
    }
  }

  // What genuinely has to be created, deduped within this submission too — a
  // form can easily contain the same name twice, and two catalog rows with one
  // name in one role would make the reuse lookup ambiguous forever after.
  const toCreate = new Map<string, { name: string; role_key: string }>();
  for (const e of typed) {
    const key = `${e.roleKey}|${e.name.toLowerCase()}`;
    if (resolvedIds.has(key) || toCreate.has(key)) continue;
    toCreate.set(key, { name: e.name, role_key: e.roleKey });
  }

  let created = 0;
  if (toCreate.size > 0) {
    const payload = Array.from(toCreate.values());
    const { data: newRows, error: cErr } = await supabase
      .from("nurock_diligence_entities")
      .insert(payload)
      .select("id, name, role_key");
    if (cErr) return { error: describeDbError(cErr) };
    const rows = (newRows ?? []) as Array<{
      id: string;
      name: string;
      role_key: string;
    }>;
    if (rows.length !== payload.length) {
      return {
        error: `Only ${rows.length} of ${payload.length} parties were created — check row-level security on nurock_diligence_entities.`,
      };
    }
    for (const r of rows) {
      resolvedIds.set(`${r.role_key}|${r.name.trim().toLowerCase()}`, r.id);
    }
    created = rows.length;
  }

  // ---------------------------------------------------------------------------
  // Link to the deal
  // ---------------------------------------------------------------------------
  // sort_order continues from what the deal already has, so adding a fourth
  // guarantor lands after the first three rather than renumbering them. The
  // lender's i / ii / iii ordering is meaningful and comes from their document.
  const { data: existingLinks, error: elErr } = await supabase
    .from("dm_diligence_deal_entities")
    .select("entity_id, sort_order")
    .eq("deal_id", input.dealId);
  if (elErr) return { error: describeDbError(elErr) };
  const linkedAlready = new Set(
    ((existingLinks ?? []) as Array<{ entity_id: string }>).map(
      (r) => r.entity_id
    )
  );
  let nextOrder =
    ((existingLinks ?? []) as Array<{ sort_order: number }>).reduce(
      (max, r) => Math.max(max, r.sort_order),
      -1
    ) + 1;

  const linkRows: Array<{
    deal_id: string;
    entity_id: string;
    sort_order: number;
    added_by: string | null;
  }> = [];
  const seen = new Set<string>();
  for (const e of entries) {
    const id =
      e.entityId ?? resolvedIds.get(`${e.roleKey}|${e.name.toLowerCase()}`);
    if (!id) {
      return {
        error: `Could not resolve "${e.name || e.entityId}" to a party. Nothing was linked.`,
      };
    }
    if (seen.has(id) || linkedAlready.has(id)) continue;
    seen.add(id);
    linkRows.push({
      deal_id: input.dealId,
      entity_id: id,
      sort_order: nextOrder++,
      added_by: user?.id ?? null,
    });
  }

  if (linkRows.length > 0) {
    const { data: wrote, error: linkErr } = await supabase
      .from("dm_diligence_deal_entities")
      .insert(linkRows)
      .select("entity_id");
    if (linkErr) return { error: describeDbError(linkErr) };
    // A zero-row insert here would mean the parties exist and the checklist
    // still produces nothing for them — the silent-no-op shape RLS produces,
    // and the one this codebase checks for everywhere.
    if (!wrote || (wrote as unknown[]).length !== linkRows.length) {
      return {
        error: `Only ${(wrote as unknown[] | null)?.length ?? 0} of ${linkRows.length} parties were added to the deal — check row-level security on dm_diligence_deal_entities.`,
      };
    }

    await logDiligenceEvent(supabase, {
      dealId: input.dealId,
      actorUserId: user?.id ?? null,
      eventType: "org_chart_updated",
      summary: `Org chart: ${linkRows.length} part${
        linkRows.length === 1 ? "y" : "ies"
      } added${created > 0 ? ` (${created} new to the catalog)` : ""}`,
      detail: { added: linkRows.length, created },
    });
  }

  revalidatePath(`/deals/${input.dealId}/diligence`);
  return { linked: linkRows.length, created };
}

/**
 * Remove a party from THIS DEAL. The catalog row survives.
 *
 * Refuses while that party still has tracked items with any history, for the
 * same reason unadoptTemplateForDeal only cleans up untouched instances: a
 * signed-off document is a record, and unlinking the party it belongs to would
 * strip it from the checklist with no trace of why.
 */
export async function removeDealEntity(input: {
  dealId: string;
  entityId: string;
}): Promise<{ error?: string }> {
  await assertDiligenceCan("edit");

  const authed = await createClient();
  const {
    data: { user },
  } = await authed.auth.getUser();
  const supabase = authed as AnySb;

  const { data: instances, error: iErr } = await supabase
    .from("dm_diligence_deal_items")
    .select("id, status")
    .eq("deal_id", input.dealId)
    .eq("entity_id", input.entityId);
  if (iErr) return { error: describeDbError(iErr) };

  const rows = (instances ?? []) as Array<{ id: string; status: string }>;
  const ids = rows.map((r) => r.id);
  const started = rows.filter((r) => r.status !== "not_started");

  if (ids.length > 0) {
    const [{ data: withDocs }, { data: withSignoffs }] = await Promise.all([
      supabase
        .from("dm_diligence_item_documents")
        .select("deal_item_id")
        .in("deal_item_id", ids),
      supabase
        .from("dm_diligence_signoffs")
        .select("deal_item_id")
        .in("deal_item_id", ids),
    ]);
    const touchedCount =
      new Set([
        ...((withDocs ?? []) as Array<{ deal_item_id: string }>).map(
          (r) => r.deal_item_id
        ),
        ...((withSignoffs ?? []) as Array<{ deal_item_id: string }>).map(
          (r) => r.deal_item_id
        ),
      ]).size + started.length;

    if (touchedCount > 0) {
      return {
        error:
          `This party has ${touchedCount} item${touchedCount === 1 ? "" : "s"} ` +
          `already in progress or with documents attached. Removing them would ` +
          `take that work off the checklist — clear those items first if you ` +
          `really mean to remove the party.`,
      };
    }

    // Untouched instances go, so the checklist stops asking for documents from
    // someone who is not on the deal.
    const { error: delErr } = await supabase
      .from("dm_diligence_deal_items")
      .delete()
      .in("id", ids);
    if (delErr) return { error: describeDbError(delErr) };
  }

  const { error } = await supabase
    .from("dm_diligence_deal_entities")
    .delete()
    .eq("deal_id", input.dealId)
    .eq("entity_id", input.entityId);
  if (error) return { error: describeDbError(error) };

  await logDiligenceEvent(supabase, {
    dealId: input.dealId,
    actorUserId: user?.id ?? null,
    eventType: "org_chart_updated",
    summary: "Org chart: a party was removed from the deal",
    detail: { entityId: input.entityId, itemsRemoved: ids.length },
  });

  revalidatePath(`/deals/${input.dealId}/diligence`);
  return {};
}

/**
 * Catalog entities in a role, for the "or pick an existing one" half of the
 * form. Read-only, and the reason the guarantors do not get re-typed on every
 * deal.
 */
export async function listCatalogEntities(input: {
  roleKeys: string[];
}): Promise<{
  entities?: Array<{ id: string; name: string; roleKey: string }>;
  error?: string;
}> {
  await assertDiligenceCan("view");
  if (input.roleKeys.length === 0) return { entities: [] };
  const supabase = (await createClient()) as AnySb;
  const { data, error } = await supabase
    .from("nurock_diligence_entities")
    .select("id, name, role_key")
    .eq("is_active", true)
    .in("role_key", input.roleKeys)
    .order("name");
  if (error) return { error: describeDbError(error) };
  return {
    entities: ((data ?? []) as Array<{
      id: string;
      name: string;
      role_key: string;
    }>).map((r) => ({ id: r.id, name: r.name, roleKey: r.role_key })),
  };
}
