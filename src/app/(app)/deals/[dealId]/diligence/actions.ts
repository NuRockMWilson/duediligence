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
