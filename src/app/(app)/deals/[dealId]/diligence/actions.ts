"use server";

// =============================================================================
// Due-diligence server actions (Increment 1)
// =============================================================================
// Status / assignee / due / notes / required edits on dm_diligence_deal_items,
// document upload + link (Supabase Storage via the storage provider), and
// assignment notifications. Mirrors the retainage/invoice action patterns:
// untyped accessor for the not-yet-typed dm_diligence_* tables, revalidate the
// diligence + dashboard routes after every mutation.
//
// Per-action permission throws are intentionally omitted to match the rest of
// the devmgmt actions (retainage, invoices) — access is gated at the module
// route + the UI hides write controls for non-editors; RLS rollout is a
// separate migration concern. The status/approval consistency CHECKs in 0081
// are the hard backstop against half-set data.
// =============================================================================

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { sendNotification } from "@/lib/notifications";
import {
  getStorageProvider,
  buildDisplayName,
} from "@/lib/diligence/storage";
import { getDiligenceChecklist } from "@/lib/data/diligence";
import { getDiligenceFinancierCoverage } from "@/lib/data/diligence-rollup";
import {
  buildDiligencePacketPdf,
  buildDiligencePacketZip,
  buildFinancierPacketPdf,
  type PacketDoc,
} from "@/lib/diligence/packet";
import { logDiligenceEvent } from "@/lib/diligence/audit";
import type { DiligenceStatus } from "@/lib/data/diligence-rollup";

export type SignoffRole = "preparer" | "reviewer" | "approver";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySb = any;

function revalidate(dealId: string) {
  revalidatePath(`/deals/${dealId}/diligence`);
  revalidatePath(`/deals/${dealId}/dashboard`);
  revalidatePath("/deals");
}

const WAIVE_STATES: DiligenceStatus[] = ["waived", "na"];

// -----------------------------------------------------------------------------
// Status
// -----------------------------------------------------------------------------
// Item 3 integrity rules:
//  - "approved" is NEVER set directly — it is granted exclusively by the
//    Approver's sign-off (recordDiligenceSignoff), so the headline status and
//    the chain can't desync.
//  - Waived / N/A are individual decisions (they carry a reason and skip the
//    chain deliberately) — bulk writes are limited to the non-terminal
//    statuses (not started / in progress / submitted).
export async function setDiligenceStatus(input: {
  dealId: string;
  dealItemIds: string[]; // one or many (bulk)
  status: DiligenceStatus;
  waivedReason?: string | null;
}): Promise<{ error?: string }> {
  if (input.dealItemIds.length === 0) return {};
  if (input.status === "approved") {
    return {
      error:
        "Approved is granted by the Approver's sign-off — open the item and complete the sign-off chain.",
    };
  }
  if (WAIVE_STATES.includes(input.status)) {
    if (input.dealItemIds.length > 1) {
      return {
        error:
          "Waived / N/A are per-item decisions — open each item to record it with its reason.",
      };
    }
    if (!input.waivedReason?.trim()) {
      return { error: "A reason is required to mark an item waived or N/A." };
    }
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const sb = supabase as AnySb;

  const patch: Record<string, unknown> = {
    status: input.status,
    updated_at: new Date().toISOString(),
    // Non-approved writes always clear the approval stamp (consistency CHECK).
    approved_at: null,
    approved_by: null,
    waived_reason: WAIVE_STATES.includes(input.status)
      ? input.waivedReason!.trim()
      : null,
  };

  const { error } = await sb
    .from("dm_diligence_deal_items")
    .update(patch)
    .in("id", input.dealItemIds)
    .eq("deal_id", input.dealId);
  if (error) return { error: error.message };

  await logDiligenceEvent(sb, {
    dealId: input.dealId,
    dealItemId: input.dealItemIds.length === 1 ? input.dealItemIds[0] : null,
    actorUserId: user?.id ?? null,
    eventType: "status_changed",
    summary: `Status → ${input.status}${
      input.dealItemIds.length > 1 ? ` (${input.dealItemIds.length} items)` : ""
    }${input.waivedReason ? ` — ${input.waivedReason.trim()}` : ""}`,
    detail: {
      status: input.status,
      itemIds: input.dealItemIds,
      waivedReason: input.waivedReason ?? null,
    },
  });

  revalidate(input.dealId);
  return {};
}

// -----------------------------------------------------------------------------
// Assignee (single or bulk) — notifies each new assignee.
// -----------------------------------------------------------------------------
export async function setDiligenceAssignee(input: {
  dealId: string;
  dealItemIds: string[];
  assigneeUserId: string | null;
  /** For the notification body — title of the (first) item assigned. */
  itemLabel?: string;
  notify?: boolean;
}): Promise<{ error?: string }> {
  if (input.dealItemIds.length === 0) return {};
  const supabase = await createClient();
  const sb = supabase as AnySb;

  const { error } = await sb
    .from("dm_diligence_deal_items")
    .update({
      assignee_user_id: input.assigneeUserId,
      updated_at: new Date().toISOString(),
    })
    .in("id", input.dealItemIds)
    .eq("deal_id", input.dealId);
  if (error) return { error: error.message };

  if (input.assigneeUserId && input.notify !== false) {
    const count = input.dealItemIds.length;
    const subject =
      count === 1
        ? `Due-diligence item assigned: ${input.itemLabel ?? "1 item"}`
        : `${count} due-diligence items assigned to you`;
    await sendNotification({
      recipientUserId: input.assigneeUserId,
      dealId: input.dealId,
      kind: "diligence_assigned",
      subject,
      body:
        count === 1
          ? `You've been assigned "${input.itemLabel ?? "a diligence item"}". Open the checklist to upload documents and update its status.`
          : `You've been assigned ${count} diligence items. Open the checklist to work through them.`,
      href: `/deals/${input.dealId}/diligence`,
    });
  }

  revalidate(input.dealId);
  return {};
}

// -----------------------------------------------------------------------------
// Due date / notes / required toggle
// -----------------------------------------------------------------------------
export async function setDiligenceDueDate(input: {
  dealId: string;
  dealItemId: string;
  dueDate: string | null; // ISO yyyy-mm-dd
}): Promise<{ error?: string }> {
  const supabase = await createClient();
  const sb = supabase as AnySb;
  const { error } = await sb
    .from("dm_diligence_deal_items")
    .update({ due_date: input.dueDate, updated_at: new Date().toISOString() })
    .eq("id", input.dealItemId)
    .eq("deal_id", input.dealId);
  if (error) return { error: error.message };
  revalidate(input.dealId);
  return {};
}

/**
 * Actual completed/met date (migration 0101). Independent of due_date —
 * setting/clearing it NEVER touches the due date or status. The sign-off
 * chain defaults it to today on approval (see deriveStatusFromChain); this
 * action is the manual edit path (back-date, correct, or clear — the UI
 * confirms before clearing a manually-entered date).
 */
export async function setDiligenceCompletedDate(input: {
  dealId: string;
  dealItemId: string;
  completedDate: string | null; // ISO yyyy-mm-dd
}): Promise<{ error?: string }> {
  const supabase = await createClient();
  const sb = supabase as AnySb;
  const { error } = await sb
    .from("dm_diligence_deal_items")
    .update({
      completed_date: input.completedDate,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.dealItemId)
    .eq("deal_id", input.dealId);
  if (error) return { error: error.message };
  revalidate(input.dealId);
  return {};
}

export async function setDiligenceNotes(input: {
  dealId: string;
  dealItemId: string;
  notes: string | null;
}): Promise<{ error?: string }> {
  const supabase = await createClient();
  const sb = supabase as AnySb;
  const { error } = await sb
    .from("dm_diligence_deal_items")
    .update({
      notes: input.notes?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.dealItemId)
    .eq("deal_id", input.dealId);
  if (error) return { error: error.message };
  revalidate(input.dealId);
  return {};
}

export async function setDiligenceRequired(input: {
  dealId: string;
  dealItemIds: string[];
  isRequired: boolean;
}): Promise<{ error?: string }> {
  if (input.dealItemIds.length === 0) return {};
  const supabase = await createClient();
  const sb = supabase as AnySb;
  const { error } = await sb
    .from("dm_diligence_deal_items")
    .update({ is_required: input.isRequired, updated_at: new Date().toISOString() })
    .in("id", input.dealItemIds)
    .eq("deal_id", input.dealId);
  if (error) return { error: error.message };
  revalidate(input.dealId);
  return {};
}

// -----------------------------------------------------------------------------
// Documents
// -----------------------------------------------------------------------------
export async function uploadDiligenceDocument(
  formData: FormData
): Promise<{ error?: string }> {
  const dealId = formData.get("dealId") as string;
  const dealItemId = formData.get("dealItemId") as string;
  const dealName = (formData.get("dealName") as string) || "Deal";
  const itemTitle = (formData.get("itemTitle") as string) || "Document";
  const itemNumberRaw = formData.get("itemNumber") as string | null;
  const itemNumber = itemNumberRaw ? Number(itemNumberRaw) : null;
  const file = formData.get("file") as File | null;

  if (!dealId || !dealItemId || !file || !(file instanceof File)) {
    return { error: "dealId, dealItemId and a file are required." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const sb = supabase as AnySb;

  let upload;
  try {
    upload = await getStorageProvider().upload({ dealId, dealItemId, file });
  } catch (e) {
    return { error: `Upload failed: ${(e as Error).message}` };
  }

  const dateIso = new Date().toISOString().slice(0, 10);
  const displayName = buildDisplayName({
    dealName,
    itemNumber,
    itemTitle,
    originalFilename: file.name,
    dateIso,
  });

  // Insert the document row.
  const { data: doc, error: docErr } = await sb
    .from("dm_diligence_documents")
    .insert({
      deal_id: dealId,
      file_path: upload.filePath,
      original_filename: file.name,
      display_name: displayName,
      mime_type: upload.mimeType,
      byte_size: upload.byteSize,
      uploaded_by: user?.id ?? null,
    })
    .select("id")
    .single();
  if (docErr) {
    // Best-effort orphan cleanup.
    try {
      await getStorageProvider().remove(upload.filePath);
    } catch {
      /* ignore */
    }
    return { error: docErr.message };
  }

  // Link to the item.
  const { error: linkErr } = await sb.from("dm_diligence_item_documents").insert({
    deal_item_id: dealItemId,
    document_id: (doc as { id: string }).id,
    deal_id: dealId,
    linked_by: user?.id ?? null,
  });
  if (linkErr) return { error: linkErr.message };

  // Nudge a not-started item into progress on first upload.
  await sb
    .from("dm_diligence_deal_items")
    .update({ status: "in_progress", updated_at: new Date().toISOString() })
    .eq("id", dealItemId)
    .eq("deal_id", dealId)
    .eq("status", "not_started");

  await logDiligenceEvent(sb, {
    dealId,
    dealItemId,
    actorUserId: user?.id ?? null,
    eventType: "document_linked",
    summary: `Uploaded & linked "${displayName}" to "${itemTitle}"`,
    detail: {
      documentId: (doc as { id: string }).id,
      displayName,
      originalFilename: file.name,
      via: "upload",
    },
  });

  revalidate(dealId);
  return {};
}

/** Link an already-uploaded document to another item (crosswalk-lite reuse). */
export async function linkDiligenceDocument(input: {
  dealId: string;
  dealItemId: string;
  documentId: string;
}): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const sb = supabase as AnySb;
  const { error } = await sb
    .from("dm_diligence_item_documents")
    .upsert(
      {
        deal_item_id: input.dealItemId,
        document_id: input.documentId,
        deal_id: input.dealId,
        linked_by: user?.id ?? null,
      },
      { onConflict: "deal_item_id,document_id", ignoreDuplicates: true }
    );
  if (error) return { error: error.message };

  await logDiligenceEvent(sb, {
    dealId: input.dealId,
    dealItemId: input.dealItemId,
    actorUserId: user?.id ?? null,
    eventType: "document_linked",
    summary: "Linked an existing library document to the item",
    detail: { documentId: input.documentId, via: "library_link" },
  });

  revalidate(input.dealId);
  return {};
}

export async function unlinkDiligenceDocument(input: {
  dealId: string;
  dealItemId: string;
  documentId: string;
}): Promise<{ error?: string }> {
  const supabase = await createClient();
  const sb = supabase as AnySb;

  const { error } = await sb
    .from("dm_diligence_item_documents")
    .delete()
    .eq("deal_item_id", input.dealItemId)
    .eq("document_id", input.documentId);
  if (error) return { error: error.message };

  // A slot assignment is only valid while the document stays linked — clear
  // any expected-doc slot on this item that pointed at it (best-effort; the
  // table ships with migration 0100).
  try {
    await sb
      .from("dm_diligence_expected_docs")
      .update({ document_id: null })
      .eq("deal_item_id", input.dealItemId)
      .eq("document_id", input.documentId);
  } catch {
    /* pre-migration deploy */
  }

  // If no item still links this document, delete the document + storage object.
  const { data: remaining } = await sb
    .from("dm_diligence_item_documents")
    .select("deal_item_id")
    .eq("document_id", input.documentId)
    .limit(1);
  if (!remaining || remaining.length === 0) {
    const { data: docRow } = await sb
      .from("dm_diligence_documents")
      .select("file_path")
      .eq("id", input.documentId)
      .maybeSingle();
    const filePath = (docRow as { file_path: string } | null)?.file_path;
    if (filePath) {
      try {
        await getStorageProvider().remove(filePath);
      } catch (e) {
        console.error("[diligence] storage remove failed:", (e as Error).message);
      }
    }
    await sb.from("dm_diligence_documents").delete().eq("id", input.documentId);
  }

  {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await logDiligenceEvent(sb, {
      dealId: input.dealId,
      dealItemId: input.dealItemId,
      actorUserId: user?.id ?? null,
      eventType: "document_unlinked",
      summary: "Document unlinked from the item",
      detail: { documentId: input.documentId },
    });
  }

  revalidate(input.dealId);
  return {};
}

/** Part 2: per-item document requirement mode ('all' | 'any'). Requires
 *  migration 0099 (column document_requirement); errors surface plainly so a
 *  pre-migration save says what to run. */
export async function setDiligenceDocumentRequirement(input: {
  dealId: string;
  dealItemId: string;
  mode: "all" | "any";
}): Promise<{ error?: string }> {
  const supabase = await createClient();
  const sb = supabase as AnySb;
  const { error } = await sb
    .from("dm_diligence_deal_items")
    .update({
      document_requirement: input.mode,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.dealItemId)
    .eq("deal_id", input.dealId);
  if (error) {
    return {
      error: error.message.includes("document_requirement")
        ? "Document-requirement mode needs migration 0099_diligence_document_requirement.sql — run it in the Supabase SQL editor first."
        : error.message,
    };
  }
  revalidate(input.dealId);
  return {};
}

// -----------------------------------------------------------------------------
// Expected-document slots (migration 0100) — give require-all real semantics:
// an item lists the documents it expects; each slot is filled by assigning one
// of the item's linked documents.
// -----------------------------------------------------------------------------
const EXPECTED_DOCS_HINT =
  "Expected-document slots need migration 0100_diligence_expected_docs.sql — run it in the Supabase SQL editor first.";

function expectedDocsError(message: string): string {
  return message.includes("dm_diligence_expected_docs")
    ? EXPECTED_DOCS_HINT
    : message;
}

export async function addDiligenceExpectedDoc(input: {
  dealId: string;
  dealItemId: string;
  label: string;
}): Promise<{ error?: string }> {
  const label = input.label.trim();
  if (!label) return { error: "Give the expected document a name." };
  const supabase = await createClient();
  const sb = supabase as AnySb;

  const { data: existing } = await sb
    .from("dm_diligence_expected_docs")
    .select("position")
    .eq("deal_item_id", input.dealItemId)
    .order("position", { ascending: false })
    .limit(1);
  const nextPos =
    ((existing as { position: number }[] | null)?.[0]?.position ?? -1) + 1;

  const { error } = await sb.from("dm_diligence_expected_docs").insert({
    deal_id: input.dealId,
    deal_item_id: input.dealItemId,
    label,
    position: nextPos,
  });
  if (error) return { error: expectedDocsError(error.message) };
  revalidate(input.dealId);
  return {};
}

export async function removeDiligenceExpectedDoc(input: {
  dealId: string;
  expectedDocId: string;
}): Promise<{ error?: string }> {
  const supabase = await createClient();
  const sb = supabase as AnySb;
  const { error } = await sb
    .from("dm_diligence_expected_docs")
    .delete()
    .eq("id", input.expectedDocId);
  if (error) return { error: expectedDocsError(error.message) };
  revalidate(input.dealId);
  return {};
}

/** Fill (or clear, with documentId null) an expected-document slot with one of
 *  the item's linked documents. */
export async function assignDiligenceExpectedDoc(input: {
  dealId: string;
  dealItemId: string;
  expectedDocId: string;
  documentId: string | null;
}): Promise<{ error?: string }> {
  const supabase = await createClient();
  const sb = supabase as AnySb;

  if (input.documentId) {
    // The assignment must reference a document actually linked to the item.
    const { data: link } = await sb
      .from("dm_diligence_item_documents")
      .select("document_id")
      .eq("deal_item_id", input.dealItemId)
      .eq("document_id", input.documentId)
      .maybeSingle();
    if (!link) {
      return {
        error:
          "That document isn't linked to this item — link it first, then assign it to the slot.",
      };
    }
  }

  const { error } = await sb
    .from("dm_diligence_expected_docs")
    .update({ document_id: input.documentId })
    .eq("id", input.expectedDocId)
    .eq("deal_item_id", input.dealItemId);
  if (error) return { error: expectedDocsError(error.message) };
  revalidate(input.dealId);
  return {};
}

export async function getDiligenceDocSignedUrl(input: {
  filePath: string;
  expiresInSeconds?: number;
}): Promise<{ signedUrl?: string; error?: string }> {
  try {
    const signedUrl = await getStorageProvider().signedUrl(
      input.filePath,
      input.expiresInSeconds ?? 3600
    );
    return { signedUrl };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// -----------------------------------------------------------------------------
// Multi-approver sign-off (Increment 3; item-3 integrity hardening)
// -----------------------------------------------------------------------------
// Chain order is Preparer → Reviewer → Approver:
//  - a role can only act once every UPSTREAM role has an "approved" decision;
//  - deciding (or re-deciding) an upstream role invalidates all DOWNSTREAM
//    decisions (they are deleted and must be redone);
//  - the item's headline status is DERIVED from the chain after every change,
//    in both directions (approve → approved; undo-all → back to not started /
//    in progress).

const SIGNOFF_ORDER: SignoffRole[] = ["preparer", "reviewer", "approver"];

type SignoffRow = { role: SignoffRole; decision: "approved" | "rejected" };

/** Re-derive the item's headline status from its chain + linked documents.
 *  Never touches waived / na items (those deliberately sit outside the chain). */
async function deriveStatusFromChain(
  sb: AnySb,
  dealId: string,
  dealItemId: string,
  approverUserId?: string | null
): Promise<void> {
  const [{ data: signoffs }, { data: itemRow }, { count: docCount }] =
    await Promise.all([
      sb
        .from("dm_diligence_signoffs")
        .select("role, decision")
        .eq("deal_item_id", dealItemId),
      sb
        .from("dm_diligence_deal_items")
        .select("status")
        .eq("id", dealItemId)
        .maybeSingle(),
      sb
        .from("dm_diligence_item_documents")
        .select("document_id", { count: "exact", head: true })
        .eq("deal_item_id", dealItemId),
    ]);
  const current = (itemRow as { status?: string } | null)?.status ?? null;
  if (current === "waived" || current === "na") return;

  const rows = (signoffs ?? []) as SignoffRow[];
  const byRole = new Map(rows.map((r) => [r.role, r.decision]));

  let next: DiligenceStatus;
  if (byRole.get("approver") === "approved") next = "approved";
  else if (rows.some((r) => r.decision === "rejected")) next = "in_progress";
  else if (rows.length > 0) next = "submitted";
  else next = (docCount ?? 0) > 0 ? "in_progress" : "not_started";

  const patch: Record<string, unknown> = {
    status: next,
    updated_at: new Date().toISOString(),
    approved_at: next === "approved" ? new Date().toISOString() : null,
    approved_by: next === "approved" ? approverUserId ?? null : null,
  };
  await sb
    .from("dm_diligence_deal_items")
    .update(patch)
    .eq("id", dealItemId)
    .eq("deal_id", dealId);

  // Completed/met date (migration 0101): approval defaults it to today IF
  // NULL — a manually back-dated value is never overwritten by re-derivation.
  // Separate best-effort write (not folded into `patch`) so a deploy ahead of
  // the migration doesn't break the sign-off chain itself. Un-approving does
  // NOT silently wipe the date — clearing is an explicit, confirmed action in
  // the drawer (setDiligenceCompletedDate).
  if (next === "approved") {
    const { data: compRow, error: compReadErr } = await sb
      .from("dm_diligence_deal_items")
      .select("completed_date")
      .eq("id", dealItemId)
      .maybeSingle();
    const existing =
      (compRow as { completed_date?: string | null } | null)?.completed_date ??
      null;
    if (!compReadErr && !existing) {
      const today = new Date().toISOString().slice(0, 10);
      await sb
        .from("dm_diligence_deal_items")
        .update({ completed_date: today })
        .eq("id", dealItemId)
        .eq("deal_id", dealId);
    }
  }
}

export async function recordDiligenceSignoff(input: {
  dealId: string;
  dealItemId: string;
  role: SignoffRole;
  decision: "approved" | "rejected";
  comment?: string | null;
}): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const sb = supabase as AnySb;

  // Sequencing gate — every upstream role must already be "approved".
  const roleIdx = SIGNOFF_ORDER.indexOf(input.role);
  if (roleIdx > 0) {
    const { data: existing } = await sb
      .from("dm_diligence_signoffs")
      .select("role, decision")
      .eq("deal_item_id", input.dealItemId);
    const byRole = new Map(
      ((existing ?? []) as SignoffRow[]).map((r) => [r.role, r.decision])
    );
    for (const upstream of SIGNOFF_ORDER.slice(0, roleIdx)) {
      if (byRole.get(upstream) !== "approved") {
        const label = upstream.charAt(0).toUpperCase() + upstream.slice(1);
        return {
          error:
            byRole.get(upstream) === "rejected"
              ? `The ${label} rejected this item — it must be re-prepared and re-approved upstream before the ${input.role} can act.`
              : `The ${label} hasn't signed off yet — the chain runs Preparer → Reviewer → Approver.`,
        };
      }
    }
  }

  // Document gate (Part 2): the Approver cannot approve until the item's
  // required documents are present.
  //   'all'  — every expected-document slot must be filled by a linked doc
  //            (items with no slots fall back to ">=1 linked document");
  //   'any'  — any one linked document suffices (slots are advisory).
  // Waived/na items never reach this path (they sit outside the chain).
  if (input.role === "approver" && input.decision === "approved") {
    const [{ data: linkRows }, { data: itemRow }] = await Promise.all([
      sb
        .from("dm_diligence_item_documents")
        .select("document_id")
        .eq("deal_item_id", input.dealItemId),
      sb
        .from("dm_diligence_deal_items")
        .select("document_requirement")
        .eq("id", input.dealItemId)
        .maybeSingle(),
    ]);
    const linkedIds = new Set(
      ((linkRows ?? []) as { document_id: string }[]).map((r) => r.document_id)
    );
    if (linkedIds.size === 0) {
      return {
        error:
          "No documents are linked to this item — the Approver can't approve until the required documents are present. Upload or link a document first (or waive the item with a reason).",
      };
    }

    const mode =
      (itemRow as { document_requirement?: string } | null)
        ?.document_requirement === "any"
        ? "any"
        : "all";
    if (mode === "all") {
      // Best-effort: pre-migration-0100 deploys have no slots table, which
      // degrades to the ">=1 linked document" gate above.
      const { data: slots, error: slotsErr } = await sb
        .from("dm_diligence_expected_docs")
        .select("label, document_id")
        .eq("deal_item_id", input.dealItemId);
      if (!slotsErr && slots && (slots as unknown[]).length > 0) {
        const unfilled = (
          slots as { label: string; document_id: string | null }[]
        ).filter((s) => !s.document_id || !linkedIds.has(s.document_id));
        if (unfilled.length > 0) {
          return {
            error: `This item requires all expected documents, but ${
              unfilled.length
            } slot${unfilled.length === 1 ? " is" : "s are"} unfilled: ${unfilled
              .map((s) => `“${s.label}”`)
              .join(
                ", "
              )}. Assign a linked document to each (or switch the item to “any one suffices”).`,
          };
        }
      }
    }
  }

  const { error } = await sb.from("dm_diligence_signoffs").upsert(
    {
      deal_id: input.dealId,
      deal_item_id: input.dealItemId,
      role: input.role,
      decision: input.decision,
      actor_user_id: user.id,
      comment: input.comment?.trim() || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "deal_item_id,role" }
  );
  if (error) return { error: error.message };

  // An upstream (re-)decision invalidates everything downstream — those roles
  // must re-review the changed state.
  const downstream = SIGNOFF_ORDER.slice(roleIdx + 1);
  if (downstream.length > 0) {
    await sb
      .from("dm_diligence_signoffs")
      .delete()
      .eq("deal_item_id", input.dealItemId)
      .in("role", downstream);
  }

  await deriveStatusFromChain(sb, input.dealId, input.dealItemId, user.id);

  await logDiligenceEvent(sb, {
    dealId: input.dealId,
    dealItemId: input.dealItemId,
    actorUserId: user.id,
    eventType: "signoff_recorded",
    summary: `${input.role} ${input.decision}`,
    detail: {
      role: input.role,
      decision: input.decision,
      comment: input.comment?.trim() || null,
    },
  });

  revalidate(input.dealId);
  return {};
}

export async function clearDiligenceSignoff(input: {
  dealId: string;
  dealItemId: string;
  role: SignoffRole;
}): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const sb = supabase as AnySb;

  // Clearing a role also clears everything downstream of it (a chain can't
  // hold an Approver decision above a vacated Reviewer slot).
  const roleIdx = SIGNOFF_ORDER.indexOf(input.role);
  const rolesToClear = SIGNOFF_ORDER.slice(roleIdx);
  const { error } = await sb
    .from("dm_diligence_signoffs")
    .delete()
    .eq("deal_item_id", input.dealItemId)
    .in("role", rolesToClear);
  if (error) return { error: error.message };

  // Derive the headline status back DOWN as well — undoing every decision
  // returns the item to not started (or in progress when documents exist).
  await deriveStatusFromChain(sb, input.dealId, input.dealItemId);

  await logDiligenceEvent(sb, {
    dealId: input.dealId,
    dealItemId: input.dealItemId,
    actorUserId: user?.id ?? null,
    eventType: "signoff_cleared",
    summary: `Sign-off undone (${rolesToClear.join(", ")})`,
    detail: { rolesCleared: rolesToClear },
  });

  revalidate(input.dealId);
  return {};
}

// -----------------------------------------------------------------------------
// Packet export — branded PDF (+ optional ZIP of linked documents).
// -----------------------------------------------------------------------------
export async function exportDiligencePacket(input: {
  dealId: string;
  includeDocs: boolean;
}): Promise<{ base64?: string; filename?: string; mime?: string; error?: string }> {
  try {
    const [checklist, financiers] = await Promise.all([
      getDiligenceChecklist(input.dealId),
      getDiligenceFinancierCoverage(input.dealId),
    ]);

    const generatedOn = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const pdf = await buildDiligencePacketPdf({
      dealName: checklist.dealName,
      generatedOn,
      rollup: checklist.rollup,
      items: checklist.items,
      financiers,
    });

    const stamp = new Date().toISOString().slice(0, 10);
    const base = checklist.dealName.replace(/[^a-z0-9]+/gi, "-").toLowerCase();

    if (!input.includeDocs) {
      return {
        base64: Buffer.from(pdf).toString("base64"),
        filename: `${base}-due-diligence-${stamp}.pdf`,
        mime: "application/pdf",
      };
    }

    // Bundle the PDF + unique linked documents (fetched server-side).
    const provider = getStorageProvider();
    const seen = new Set<string>();
    const docs: PacketDoc[] = [];
    for (const item of checklist.items) {
      for (const d of item.docs) {
        if (seen.has(d.id)) continue;
        seen.add(d.id);
        try {
          const url = await provider.signedUrl(d.filePath, 600);
          const res = await fetch(url);
          docs.push({
            name: d.displayName ?? d.originalFilename,
            bytes: new Uint8Array(await res.arrayBuffer()),
          });
        } catch (e) {
          console.error("[packet] doc fetch failed:", d.filePath, (e as Error).message);
        }
      }
    }
    const zip = await buildDiligencePacketZip(pdf, docs);
    return {
      base64: Buffer.from(zip).toString("base64"),
      filename: `${base}-due-diligence-${stamp}.zip`,
      mime: "application/zip",
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// -----------------------------------------------------------------------------
// Per-financier packet export — the lender's OWN required-item list with each
// item's satisfied state (vs. exportDiligencePacket's NuRock-canonical
// checklist). Read-only; no schema change (sources the crosswalk coverage).
// -----------------------------------------------------------------------------
export async function exportFinancierPacket(input: {
  dealId: string;
  templateId: string;
}): Promise<{ base64?: string; filename?: string; mime?: string; error?: string }> {
  try {
    const [checklist, financiers] = await Promise.all([
      getDiligenceChecklist(input.dealId),
      getDiligenceFinancierCoverage(input.dealId),
    ]);
    const financier = financiers.find((f) => f.templateId === input.templateId);
    if (!financier) return { error: "This packet is no longer on the deal." };

    const generatedOn = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const pdf = await buildFinancierPacketPdf({
      dealName: checklist.dealName,
      generatedOn,
      financier,
    });

    const stamp = new Date().toISOString().slice(0, 10);
    const dealBase = checklist.dealName.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    const finBase = (financier.financierName ?? financier.name)
      .replace(/[^a-z0-9]+/gi, "-")
      .toLowerCase();
    return {
      base64: Buffer.from(pdf).toString("base64"),
      filename: `${dealBase}-${finBase}-packet-${stamp}.pdf`,
      mime: "application/pdf",
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// -----------------------------------------------------------------------------
// Nudge an assignee about their outstanding items (manual "remind" action).
// -----------------------------------------------------------------------------
export async function nudgeDiligenceAssignee(input: {
  dealId: string;
  assigneeUserId: string;
  outstandingCount: number;
}): Promise<{ error?: string }> {
  await sendNotification({
    recipientUserId: input.assigneeUserId,
    dealId: input.dealId,
    kind: "diligence_outstanding",
    subject: `${input.outstandingCount} outstanding due-diligence item${
      input.outstandingCount === 1 ? "" : "s"
    }`,
    body: `You have ${input.outstandingCount} open diligence item${
      input.outstandingCount === 1 ? "" : "s"
    } on this deal. Please upload the documents and update their status.`,
    href: `/deals/${input.dealId}/diligence`,
  });
  return {};
}
