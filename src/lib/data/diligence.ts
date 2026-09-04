// =============================================================================
// Due-diligence checklist data layer
// =============================================================================
// getDiligenceChecklist() returns everything the /diligence screen renders in
// one pass: the deal name, every tracked item (with its catalog metadata,
// assignee name, and linked documents), the team roster for the assignee
// picker, and the readiness rollup.
//
// ensureDealDiligenceItems() makes the canonical checklist self-healing: it
// adopts the canonical template for the deal and instantiates any canonical
// items not yet tracked. Idempotent — safe to call on every page load, so new
// deals (and newly-added catalog items) populate without a migration.
//
// dm_diligence_* / nurock_diligence_* aren't in the generated DB types yet, so
// we use the established untyped-accessor cast (see lien-waiver-rollup.ts).
// Drop the casts after regenerating database.types.ts.
// =============================================================================

import { createClient } from "@/lib/supabase/server";
import { categoryOrder } from "@/lib/diligence/categories";
import {
  computeDiligenceRollup,
  type DiligenceRollup,
  type DiligenceStatus,
} from "@/lib/data/diligence-rollup";

export type { DiligenceStatus } from "@/lib/data/diligence-rollup";

export interface DiligenceDoc {
  id: string;
  displayName: string | null;
  originalFilename: string;
  filePath: string;
  mimeType: string | null;
  byteSize: number | null;
}

export type SignoffRole = "preparer" | "reviewer" | "approver";

export interface DiligenceSignoff {
  role: SignoffRole;
  decision: "approved" | "rejected";
  actorUserId: string;
  actorName: string | null;
  comment: string | null;
  createdAt: string;
}

export interface DiligenceItem {
  id: string; // dm_diligence_deal_items.id (the tracked row)
  itemId: string; // nurock_diligence_items.id (catalog item)
  itemNumber: number | null;
  category: string;
  title: string;
  description: string | null;
  status: DiligenceStatus;
  isRequired: boolean;
  assigneeUserId: string | null;
  assigneeName: string | null;
  dueDate: string | null;
  /** Actual date the item was met (migration 0101). Independent of dueDate;
   *  defaults to today when the sign-off chain approves; editable/back-datable.
   *  Read tolerantly so pre-migration deploys still work. */
  completedDate: string | null;
  notes: string | null;
  approvedAt: string | null;
  waivedReason: string | null;
  docs: DiligenceDoc[];
  signoffs: DiligenceSignoff[];
  /** Part 2 — document requirement mode for the approver gate: 'all' (every
   *  expected-document slot filled) or 'any' (one linked doc suffices).
   *  Defaults 'all'; read tolerantly so pre-migration-0099 deploys still work. */
  documentRequirement: "all" | "any";
  /** Expected-document slots (migration 0100). Under 'all', every slot must
   *  be filled by a linked document before the Approver can approve; items
   *  with no slots fall back to ">=1 linked document". */
  expectedDocs: ExpectedDoc[];
}

export interface ExpectedDoc {
  id: string;
  label: string;
  /** The linked document filling this slot, if any. */
  documentId: string | null;
}

export interface TeamMember {
  userId: string;
  name: string;
  email: string;
}

/** Part 2 — one document in the deal's shared library, with every checklist
 *  item it is linked to (many-to-many). */
export interface LibraryDoc extends DiligenceDoc {
  linkedItemIds: string[];
}

export interface DiligenceChecklist {
  dealId: string;
  dealName: string;
  items: DiligenceItem[];
  team: TeamMember[];
  rollup: DiligenceRollup;
  /** The deal's shared document library (every uploaded document, deduped,
   *  with its linked items). */
  library: LibraryDoc[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySb = any;

/**
 * Adopt the canonical template + instantiate any missing canonical items for
 * the deal. Idempotent. Returns the number of newly-created items.
 */
export async function ensureDealDiligenceItems(
  dealId: string
): Promise<number> {
  const supabase = (await createClient()) as AnySb;

  const { data: tmpl } = await supabase
    .from("nurock_diligence_templates")
    .select("id")
    .eq("is_canonical", true)
    .maybeSingle();
  const templateId = tmpl?.id as string | undefined;
  if (!templateId) return 0; // seed not applied yet — nothing to ensure

  // Adopt (ignore if already adopted).
  await supabase
    .from("dm_diligence_deal_templates")
    .upsert(
      { deal_id: dealId, template_id: templateId },
      { onConflict: "deal_id,template_id", ignoreDuplicates: true }
    );

  // Canonical items vs. what the deal already tracks → insert the difference.
  const [{ data: catalog }, { data: existing }] = await Promise.all([
    supabase
      .from("nurock_diligence_items")
      .select("id, default_required")
      .eq("template_id", templateId)
      .eq("is_active", true),
    supabase
      .from("dm_diligence_deal_items")
      .select("item_id")
      .eq("deal_id", dealId),
  ]);

  const have = new Set(
    ((existing ?? []) as Array<{ item_id: string }>).map((r) => r.item_id)
  );
  const missing = ((catalog ?? []) as Array<{
    id: string;
    default_required: boolean;
  }>).filter((c) => !have.has(c.id));

  // Part 2: STANDALONE packet items. For every non-canonical template this
  // deal adopted, instantiate per-deal rows for items with NO crosswalk
  // mapping — they're worked, signed off, and document-linked exactly like
  // canonical items. Crosswalk-mapped packet items stay virtual (their
  // coverage flows through the canonical items they map to). Running here
  // (every diligence page load) makes packet adoption self-healing the same
  // way the canonical checklist is.
  const [{ data: adopted }, { data: mappedRows, error: mappedErr }] =
    await Promise.all([
      supabase
        .from("dm_diligence_deal_templates")
        .select("template_id")
        .eq("deal_id", dealId),
      supabase.from("nurock_diligence_crosswalk").select("external_item_id"),
    ]);
  const adoptedExternal = ((adopted ?? []) as Array<{ template_id: string }>)
    .map((r) => r.template_id)
    .filter((id) => id !== templateId);
  let standalone: Array<{ id: string; default_required: boolean }> = [];
  // Per-entity rows (ASK 2): the same catalog item once per named entity.
  const entityScoped: Array<{
    id: string;
    default_required: boolean;
    entity_id: string;
  }> = [];
  if (adoptedExternal.length > 0) {
    // =======================================================================
    // AN UNREADABLE CROSSWALK MUST NOT LOOK LIKE AN EMPTY ONE. THIS IS A WRITE.
    // =======================================================================
    // MEASURED 2026-09-04: the live session tried to create a mapping and got
    // "Could not find the table 'public.nurock_diligence_crosswalk' in the
    // schema cache". Every read of that table in this codebase — here,
    // getTemplateDetail, and getDiligenceFinancierCoverage — destructured only
    // `data` and ignored `error`, so an UNREACHABLE table was indistinguishable
    // from a table with no rows. That is why three rounds of investigation kept
    // concluding "there are simply no mappings".
    //
    // Here it is worse than a wrong display, because mappedSet decides WHICH
    // PACKET ITEMS GET INSTANTIATED. Empty means "nothing is mapped", so every
    // item of every adopted packet becomes STANDALONE and is written as a
    // deal-item row — for PNC's 329-item checklist, 329 rows that should mostly
    // have stayed virtual. A read failure would have silently changed a deal's
    // tracked scope.
    //
    // So this returns 0 and instantiates NOTHING for packets when the crosswalk
    // cannot be read. The canonical items above are unaffected — they do not
    // depend on the crosswalk — so a deal still gets its standard checklist.
    // Deciding packet scope from a failed read is the one thing that must not
    // happen.
    // `standalone` is left EMPTY rather than returning early: the canonical
    // items below must still be instantiated, because they do not depend on the
    // crosswalk at all. A deal keeps its standard checklist; only packet scope
    // is withheld, which is the part that cannot be decided from a failed read.
    if (mappedErr) {
      console.error(
        "[diligence] crosswalk unreadable — instantiating NO packet items rather " +
          "than treating every packet item as unmapped. The canonical checklist " +
          "is unaffected. Apply supabase/migrations/0082_diligence_crosswalk.sql " +
          "and NOTIFY pgrst, 'reload schema'.",
        mappedErr
      );
    } else {
    const mappedSet = new Set(
      ((mappedRows ?? []) as Array<{ external_item_id: string }>).map(
        (r) => r.external_item_id
      )
    );
    const { data: extItems } = await supabase
      .from("nurock_diligence_items")
      .select("id, default_required, group_id")
      .in("template_id", adoptedExternal)
      .eq("is_active", true);
    const extRows = (extItems ?? []) as Array<{
      id: string;
      default_required: boolean;
      group_id: string | null;
    }>;

    // =======================================================================
    // PER-ENTITY INSTANTIATION (ASK 2)
    // =======================================================================
    // A group flagged is_entity_parameterized repeats once per named entity of
    // its entity_role. PNC's section 1 has guarantors i/ii/iii as separate
    // blocks with their own item lists, and a deal is not closed until EACH
    // guarantor's documents are in — so each gets its own tracked row, its own
    // assignee, its own documents and its own sign-off chain.
    //
    // ITEMS IN A PARAMETERIZED GROUP ARE INSTANTIATED PER ENTITY REGARDLESS OF
    // CROSSWALK MAPPING, and that is a deliberate departure from the rule above.
    // The standalone rule keeps a MAPPED packet item virtual because its
    // coverage flows through the canonical item that satisfies it. But one
    // canonical item cannot represent three guarantors: approving "Guarantor
    // Financials" once would satisfy all three, which is the fabricated record
    // this whole design exists to prevent. Per-entity tracking wins over
    // coverage-through-mapping wherever the two conflict.
    //
    // FLAGGED FOR MICHAEL: that means a crosswalk mapping on an item inside a
    // parameterized group has no effect on how it is tracked. It still counts
    // toward the packet's coverage percentage, which now aggregates several
    // entity instances behind one canonical item — a number worth a second look
    // once real per-entity data exists.
    const [{ data: dealEnts }, { data: paramGroups }] = await Promise.all([
      supabase
        .from("dm_diligence_deal_entities")
        .select("entity_id, sort_order, nurock_diligence_entities ( role_key )")
        .eq("deal_id", dealId),
      supabase
        .from("nurock_diligence_item_groups")
        .select("id, entity_role")
        .in("template_id", adoptedExternal)
        .eq("is_entity_parameterized", true),
    ]);

    type DealEntRow = {
      entity_id: string;
      sort_order: number;
      nurock_diligence_entities: { role_key: string } | null;
    };
    const entitiesByRole = new Map<string, string[]>();
    for (const e of (dealEnts ?? []) as DealEntRow[]) {
      const role = e.nurock_diligence_entities?.role_key;
      if (!role) continue;
      const arr = entitiesByRole.get(role) ?? [];
      arr.push(e.entity_id);
      entitiesByRole.set(role, arr);
    }

    const paramGroupRole = new Map<string, string>();
    for (const g of (paramGroups ?? []) as Array<{
      id: string;
      entity_role: string | null;
    }>) {
      if (g.entity_role) paramGroupRole.set(g.id, g.entity_role);
    }

    // A parameterized-group item must NOT also be instantiated unscoped, or the
    // checklist would show a headless copy beside the per-entity ones. So these
    // are excluded from `standalone` rather than added on top of it.
    standalone = extRows.filter(
      (i) =>
        !mappedSet.has(i.id) &&
        !have.has(i.id) &&
        !(i.group_id != null && paramGroupRole.has(i.group_id))
    );

    if (paramGroupRole.size > 0 && entitiesByRole.size > 0) {
      // Existing (item, entity) pairs, so repeated page loads do not duplicate.
      // The partial unique index would refuse a duplicate anyway, but an INSERT
      // that throws would take the whole self-healing pass down with it.
      const { data: existingEnt } = await supabase
        .from("dm_diligence_deal_items")
        .select("item_id, entity_id")
        .eq("deal_id", dealId)
        .not("entity_id", "is", null);
      const havePair = new Set(
        ((existingEnt ?? []) as Array<{ item_id: string; entity_id: string }>).map(
          (r) => `${r.item_id}|${r.entity_id}`
        )
      );

      for (const item of extRows) {
        if (item.group_id == null) continue;
        const role = paramGroupRole.get(item.group_id);
        if (!role) continue;
        for (const entityId of entitiesByRole.get(role) ?? []) {
          if (havePair.has(`${item.id}|${entityId}`)) continue;
          entityScoped.push({
            id: item.id,
            default_required: item.default_required,
            entity_id: entityId,
          });
        }
      }
    }
    }
  }

  // entity_id is sent as NULL for the unscoped rows rather than omitted, so one
  // insert covers both shapes and the partial unique indexes see the value they
  // are predicated on.
  const toInsert: Array<{
    id: string;
    default_required: boolean;
    entity_id?: string;
  }> = [...missing, ...standalone, ...entityScoped];
  if (toInsert.length === 0) return 0;

  const { error } = await supabase.from("dm_diligence_deal_items").insert(
    toInsert.map((m) => ({
      deal_id: dealId,
      item_id: m.id,
      is_required: m.default_required ?? true,
      entity_id: m.entity_id ?? null,
    }))
  );
  if (error) {
    console.error("[diligence] ensure insert failed:", error.message);
    return 0;
  }
  return toInsert.length;
}

export async function getDiligenceChecklist(
  dealId: string
): Promise<DiligenceChecklist> {
  // Self-heal first so the fetch below sees a complete set.
  await ensureDealDiligenceItems(dealId);

  const supabase = await createClient();
  const sb = supabase as AnySb;

  const [dealRes, itemsRes, linksRes, signoffsRes, teamRes] = await Promise.all([
    supabase.from("deals").select("name").eq("id", dealId).maybeSingle(),
    sb
      .from("dm_diligence_deal_items")
      .select(
        `id, item_id, status, is_required, assignee_user_id, due_date, notes,
         approved_at, waived_reason,
         nurock_diligence_items ( item_number, category, title, description )`
      )
      .eq("deal_id", dealId),
    sb
      .from("dm_diligence_item_documents")
      .select(
        `deal_item_id,
         dm_diligence_documents ( id, display_name, original_filename, file_path, mime_type, byte_size )`
      )
      .eq("deal_id", dealId),
    sb
      .from("dm_diligence_signoffs")
      .select("deal_item_id, role, decision, actor_user_id, comment, created_at")
      .eq("deal_id", dealId),
    supabase
      .from("app_users")
      .select("user_id, display_name, email")
      .order("display_name", { ascending: true }),
  ]);

  const dealName =
    (dealRes.data as { name: string } | null)?.name ?? "Deal";

  const team: TeamMember[] = (
    (teamRes.data ?? []) as Array<{
      user_id: string;
      display_name: string | null;
      email: string | null;
    }>
  ).map((u) => ({
    userId: u.user_id,
    name: u.display_name ?? u.email ?? "Team member",
    email: u.email ?? "",
  }));
  const nameByUser = new Map(team.map((t) => [t.userId, t.name]));

  // Group documents by deal-item.
  type LinkRow = {
    deal_item_id: string;
    dm_diligence_documents: {
      id: string;
      display_name: string | null;
      original_filename: string;
      file_path: string;
      mime_type: string | null;
      byte_size: number | null;
    } | null;
  };
  const docsByItem = new Map<string, DiligenceDoc[]>();
  // Part 2 — the shared library: every document deduped, with its linked items.
  const libraryById = new Map<string, LibraryDoc>();
  for (const l of (linksRes.data ?? []) as LinkRow[]) {
    const d = l.dm_diligence_documents;
    if (!d) continue;
    const doc: DiligenceDoc = {
      id: d.id,
      displayName: d.display_name,
      originalFilename: d.original_filename,
      filePath: d.file_path,
      mimeType: d.mime_type,
      byteSize: d.byte_size,
    };
    const arr = docsByItem.get(l.deal_item_id) ?? [];
    arr.push(doc);
    docsByItem.set(l.deal_item_id, arr);

    const lib = libraryById.get(d.id) ?? { ...doc, linkedItemIds: [] };
    lib.linkedItemIds.push(l.deal_item_id);
    libraryById.set(d.id, lib);
  }
  const library = Array.from(libraryById.values()).sort((a, b) =>
    (a.displayName ?? a.originalFilename).localeCompare(
      b.displayName ?? b.originalFilename
    )
  );

  // Part 2 — per-item document-requirement mode. Fetched separately and
  // best-effort so a deploy ahead of migration 0099 (no column yet) degrades
  // to the 'all' default instead of breaking the whole checklist query.
  const reqByItem = new Map<string, "all" | "any">();
  {
    const { data: reqRows, error: reqErr } = await sb
      .from("dm_diligence_deal_items")
      .select("id, document_requirement")
      .eq("deal_id", dealId);
    if (!reqErr) {
      for (const r of (reqRows ?? []) as Array<{
        id: string;
        document_requirement: string | null;
      }>) {
        reqByItem.set(r.id, r.document_requirement === "any" ? "any" : "all");
      }
    }
  }

  // Actual completed/met dates (migration 0101) — best-effort like above, so
  // a deploy ahead of the migration degrades to "no completed dates" instead
  // of breaking the whole checklist query.
  const completedByItem = new Map<string, string>();
  {
    const { data: compRows, error: compErr } = await sb
      .from("dm_diligence_deal_items")
      .select("id, completed_date")
      .eq("deal_id", dealId);
    if (!compErr) {
      for (const r of (compRows ?? []) as Array<{
        id: string;
        completed_date: string | null;
      }>) {
        if (r.completed_date) completedByItem.set(r.id, r.completed_date);
      }
    }
  }

  // Expected-document slots (migration 0100) — best-effort like above, so a
  // deploy ahead of the migration degrades to "no slots" (>=1-doc gate).
  const expectedByItem = new Map<string, ExpectedDoc[]>();
  {
    const { data: expRows, error: expErr } = await sb
      .from("dm_diligence_expected_docs")
      .select("id, deal_item_id, label, document_id, position")
      .eq("deal_id", dealId)
      .order("position", { ascending: true });
    if (!expErr) {
      for (const r of (expRows ?? []) as Array<{
        id: string;
        deal_item_id: string;
        label: string;
        document_id: string | null;
      }>) {
        const arr = expectedByItem.get(r.deal_item_id) ?? [];
        arr.push({ id: r.id, label: r.label, documentId: r.document_id });
        expectedByItem.set(r.deal_item_id, arr);
      }
    }
  }

  // Group sign-offs by deal-item.
  type SignoffRow = {
    deal_item_id: string;
    role: SignoffRole;
    decision: "approved" | "rejected";
    actor_user_id: string;
    comment: string | null;
    created_at: string;
  };
  const signoffsByItem = new Map<string, DiligenceSignoff[]>();
  for (const s of (signoffsRes.data ?? []) as SignoffRow[]) {
    const arr = signoffsByItem.get(s.deal_item_id) ?? [];
    arr.push({
      role: s.role,
      decision: s.decision,
      actorUserId: s.actor_user_id,
      actorName: nameByUser.get(s.actor_user_id) ?? null,
      comment: s.comment,
      createdAt: s.created_at,
    });
    signoffsByItem.set(s.deal_item_id, arr);
  }

  type ItemRow = {
    id: string;
    item_id: string;
    status: DiligenceStatus;
    is_required: boolean;
    assignee_user_id: string | null;
    due_date: string | null;
    notes: string | null;
    approved_at: string | null;
    waived_reason: string | null;
    nurock_diligence_items: {
      item_number: number | null;
      category: string;
      title: string;
      description: string | null;
    } | null;
  };

  const items: DiligenceItem[] = ((itemsRes.data ?? []) as ItemRow[]).map(
    (r) => {
      const meta = r.nurock_diligence_items;
      return {
        id: r.id,
        itemId: r.item_id,
        itemNumber: meta?.item_number ?? null,
        category: meta?.category ?? "uncategorized",
        title: meta?.title ?? "(item)",
        description: meta?.description ?? null,
        status: r.status,
        isRequired: r.is_required,
        assigneeUserId: r.assignee_user_id,
        assigneeName: r.assignee_user_id
          ? nameByUser.get(r.assignee_user_id) ?? null
          : null,
        dueDate: r.due_date,
        completedDate: completedByItem.get(r.id) ?? null,
        notes: r.notes,
        approvedAt: r.approved_at,
        waivedReason: r.waived_reason,
        docs: docsByItem.get(r.id) ?? [],
        signoffs: signoffsByItem.get(r.id) ?? [],
        documentRequirement: reqByItem.get(r.id) ?? "all",
        expectedDocs: expectedByItem.get(r.id) ?? [],
      };
    }
  );

  // Order by category (seed order) then item number.
  items.sort((a, b) => {
    const c = categoryOrder(a.category) - categoryOrder(b.category);
    if (c !== 0) return c;
    return (a.itemNumber ?? 0) - (b.itemNumber ?? 0);
  });

  const todayIso = new Date().toISOString().slice(0, 10);
  const rollup = computeDiligenceRollup(
    items.map((i) => ({
      status: i.status,
      isRequired: i.isRequired,
      dueDate: i.dueDate,
      assigneeUserId: i.assigneeUserId,
      assigneeName: i.assigneeName,
    })),
    todayIso
  );

  return { dealId, dealName, items, team, rollup, library };
}
