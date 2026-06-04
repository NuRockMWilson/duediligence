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
  notes: string | null;
  approvedAt: string | null;
  waivedReason: string | null;
  docs: DiligenceDoc[];
  signoffs: DiligenceSignoff[];
}

export interface TeamMember {
  userId: string;
  name: string;
  email: string;
}

export interface DiligenceChecklist {
  dealId: string;
  dealName: string;
  items: DiligenceItem[];
  team: TeamMember[];
  rollup: DiligenceRollup;
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

  if (missing.length === 0) return 0;

  const { error } = await supabase.from("dm_diligence_deal_items").insert(
    missing.map((m) => ({
      deal_id: dealId,
      item_id: m.id,
      is_required: m.default_required,
    }))
  );
  if (error) {
    console.error("[diligence] ensure insert failed:", error.message);
    return 0;
  }
  return missing.length;
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
  for (const l of (linksRes.data ?? []) as LinkRow[]) {
    const d = l.dm_diligence_documents;
    if (!d) continue;
    const arr = docsByItem.get(l.deal_item_id) ?? [];
    arr.push({
      id: d.id,
      displayName: d.display_name,
      originalFilename: d.original_filename,
      filePath: d.file_path,
      mimeType: d.mime_type,
      byteSize: d.byte_size,
    });
    docsByItem.set(l.deal_item_id, arr);
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
        notes: r.notes,
        approvedAt: r.approved_at,
        waivedReason: r.waived_reason,
        docs: docsByItem.get(r.id) ?? [],
        signoffs: signoffsByItem.get(r.id) ?? [],
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

  return { dealId, dealName, items, team, rollup };
}
