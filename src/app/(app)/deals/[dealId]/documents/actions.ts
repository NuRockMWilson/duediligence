"use server";

// =============================================================================
// Deal document library — writes (ASK 3)
// =============================================================================
// Upload a document to the DEAL rather than to a checklist item, then link it to
// items later (or never). Per-item upload in diligence/actions.ts is unchanged
// and stays the primary path — this adds the case it could not express.
//
// WHY IT WAS IMPOSSIBLE BEFORE. uploadDiligenceDocument requires a dealItemId:
//   if (!dealId || !dealItemId || !file) return { error: "... are required." }
// and it always inserts a dm_diligence_item_documents row. There was no way to
// put a file on a deal without choosing an item for it, which is backwards for
// how diligence actually arrives — a lender sends a zip of twelve files and
// somebody sorts them out afterwards.
//
// Every export here is a "use server" function, i.e. a public POST endpoint that
// does NOT pass through the (app) route gate, so each one calls
// assertDiligenceCan("edit") before touching anything.
// =============================================================================

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logDiligenceEvent } from "@/lib/diligence/audit";
import { assertDiligenceCan } from "@/lib/auth/access";
import {
  getStorageProvider,
  buildUnfiledDisplayName,
  UNFILED_SEGMENT,
} from "@/lib/diligence/storage";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySb = any;

function revalidateDocs(dealId: string) {
  revalidatePath(`/deals/${dealId}/documents`);
  // The checklist reads the same documents for its per-item lists.
  revalidatePath(`/deals/${dealId}/diligence`);
}

/** 100 MB — matches the per-item uploader's practical ceiling. */
const MAX_BYTES = 100 * 1024 * 1024;

export async function uploadDealDocument(
  formData: FormData
): Promise<{ documentId?: string; error?: string }> {
  await assertDiligenceCan("edit");

  const dealId = formData.get("dealId") as string;
  const dealName = (formData.get("dealName") as string) || "Deal";
  const file = formData.get("file") as File | null;

  if (!dealId || !file || !(file instanceof File)) {
    return { error: "A deal and a file are required." };
  }
  if (file.size === 0) {
    return { error: "That file is empty." };
  }
  if (file.size > MAX_BYTES) {
    return {
      error: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is 100 MB.`,
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const sb = supabase as AnySb;

  let upload;
  try {
    // UNFILED_SEGMENT keeps the key at three segments so the storage policy's
    // `(storage.foldername(name))[1]` still resolves to the deal id.
    upload = await getStorageProvider().upload({
      dealId,
      dealItemId: UNFILED_SEGMENT,
      file,
    });
  } catch (e) {
    return { error: `Upload failed: ${(e as Error).message}` };
  }

  const { data: doc, error: docErr } = await sb
    .from("dm_diligence_documents")
    .insert({
      deal_id: dealId,
      file_path: upload.filePath,
      original_filename: file.name,
      display_name: buildUnfiledDisplayName({
        dealName,
        originalFilename: file.name,
        dateIso: new Date().toISOString().slice(0, 10),
      }),
      mime_type: upload.mimeType,
      byte_size: upload.byteSize,
      uploaded_by: user?.id ?? null,
    })
    .select("id")
    .single();

  if (docErr) {
    // ORPHAN CLEANUP. The bytes are already in storage; without this a failed
    // row insert leaves a file nothing references and nothing can reach — it
    // would not appear in any list, including the new library, because the
    // library reads rows, not the bucket. Best-effort, and the row error is
    // what gets reported either way.
    try {
      await getStorageProvider().remove(upload.filePath);
    } catch {
      /* ignore — reporting the insert failure matters more */
    }
    return { error: docErr.message };
  }

  const documentId = (doc as { id: string }).id;

  await logDiligenceEvent(sb, {
    dealId,
    actorUserId: user?.id ?? null,
    eventType: "document_uploaded_unfiled",
    summary: `Uploaded "${file.name}" to the document library (not yet linked)`,
    detail: { documentId, originalFilename: file.name, byteSize: upload.byteSize },
  });

  revalidateDocs(dealId);
  return { documentId };
}

/**
 * Link an existing library document to a checklist item, from the LIBRARY side.
 *
 * linkDiligenceDocument in diligence/actions.ts does the same join from the
 * ITEM side and additionally nudges a not_started item to in_progress. This
 * keeps that behaviour — attaching evidence to an untouched item means work has
 * started on it, and which screen the user happened to be on must not change
 * whether the checklist reflects that.
 */
export async function linkDocumentToItem(input: {
  dealId: string;
  documentId: string;
  dealItemId: string;
}): Promise<{ error?: string }> {
  await assertDiligenceCan("edit");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const sb = supabase as AnySb;

  // The item must be on THIS deal. Without this check a caller could POST any
  // dealItemId and attach a document across deals.
  const { data: item } = await sb
    .from("dm_diligence_deal_items")
    .select("id, item_id, deal_id")
    .eq("id", input.dealItemId)
    .eq("deal_id", input.dealId)
    .maybeSingle();
  if (!item) return { error: "That checklist item is not on this deal." };

  const { data: docRow } = await sb
    .from("dm_diligence_documents")
    .select("id, display_name, original_filename")
    .eq("id", input.documentId)
    .eq("deal_id", input.dealId)
    .maybeSingle();
  if (!docRow) return { error: "That document is not on this deal." };

  const { error } = await sb.from("dm_diligence_item_documents").insert({
    deal_item_id: input.dealItemId,
    document_id: input.documentId,
    deal_id: input.dealId,
    linked_by: user?.id ?? null,
  });
  if (error) {
    if (/duplicate key|unique/i.test(error.message)) {
      return { error: "That document is already linked to this item." };
    }
    return { error: error.message };
  }

  await sb
    .from("dm_diligence_deal_items")
    .update({ status: "in_progress", updated_at: new Date().toISOString() })
    .eq("id", input.dealItemId)
    .eq("deal_id", input.dealId)
    .eq("status", "not_started");

  const label =
    (docRow as { display_name: string | null; original_filename: string })
      .display_name ??
    (docRow as { original_filename: string }).original_filename;

  await logDiligenceEvent(sb, {
    dealId: input.dealId,
    dealItemId: input.dealItemId,
    actorUserId: user?.id ?? null,
    eventType: "document_linked",
    summary: `Linked "${label}" from the document library`,
    detail: { documentId: input.documentId, via: "library" },
  });

  revalidateDocs(input.dealId);
  return {};
}

export async function unlinkDocumentFromItem(input: {
  dealId: string;
  documentId: string;
  dealItemId: string;
}): Promise<{ error?: string }> {
  await assertDiligenceCan("edit");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const sb = supabase as AnySb;

  const { error } = await sb
    .from("dm_diligence_item_documents")
    .delete()
    .eq("deal_id", input.dealId)
    .eq("deal_item_id", input.dealItemId)
    .eq("document_id", input.documentId);
  if (error) return { error: error.message };

  await logDiligenceEvent(sb, {
    dealId: input.dealId,
    dealItemId: input.dealItemId,
    actorUserId: user?.id ?? null,
    eventType: "document_unlinked",
    summary: "Unlinked a document from the item, from the document library",
    detail: { documentId: input.documentId, via: "library" },
  });

  // UNLINKING NEVER DELETES THE FILE. The document stays in the library as an
  // unfiled row, which is now a legitimate state (ASK 3) rather than the
  // invisible one it used to be. Deleting bytes because the last reference went
  // away would make an undo impossible.
  revalidateDocs(input.dealId);
  return {};
}

/**
 * Remove a document from the deal entirely — the row AND the stored file.
 *
 * REFUSES WHILE ANY ITEM STILL LINKS IT, rather than cascading. A document
 * attached to three checklist items is evidence three sign-off chains may
 * already depend on; making it disappear from all three because someone tidied
 * the library is not a tidy-up, it is data loss with a friendly button. Unlink
 * first, deliberately, one item at a time.
 */
export async function deleteDealDocument(input: {
  dealId: string;
  documentId: string;
}): Promise<{ error?: string }> {
  await assertDiligenceCan("edit");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const sb = supabase as AnySb;

  const { count } = await sb
    .from("dm_diligence_item_documents")
    .select("document_id", { count: "exact", head: true })
    .eq("deal_id", input.dealId)
    .eq("document_id", input.documentId);
  if ((count ?? 0) > 0) {
    return {
      error: `This document is linked to ${count} checklist item${
        count === 1 ? "" : "s"
      }. Unlink it there first.`,
    };
  }

  const { data: docRow } = await sb
    .from("dm_diligence_documents")
    .select("id, file_path, display_name, original_filename")
    .eq("id", input.documentId)
    .eq("deal_id", input.dealId)
    .maybeSingle();
  if (!docRow) return { error: "That document is not on this deal." };
  const d = docRow as {
    file_path: string;
    display_name: string | null;
    original_filename: string;
  };

  // ROW FIRST, THEN BYTES. If the row delete fails the file is still there and
  // nothing is lost; the reverse order can leave a row pointing at a file that
  // no longer exists, which presents to the user as a document that lists fine
  // and fails on every download.
  const { error: rowErr } = await sb
    .from("dm_diligence_documents")
    .delete()
    .eq("id", input.documentId)
    .eq("deal_id", input.dealId);
  if (rowErr) return { error: rowErr.message };

  let storageWarning: string | null = null;
  try {
    await getStorageProvider().remove(d.file_path);
  } catch (e) {
    storageWarning = (e as Error).message;
  }

  await logDiligenceEvent(sb, {
    dealId: input.dealId,
    actorUserId: user?.id ?? null,
    eventType: "document_deleted",
    summary: `Deleted "${d.display_name ?? d.original_filename}" from the document library`,
    detail: {
      documentId: input.documentId,
      filePath: d.file_path,
      storageRemoveFailed: storageWarning,
    },
  });

  revalidateDocs(input.dealId);
  // The row is gone either way, so the user's list is correct. Say so if the
  // bytes were left behind rather than reporting a clean success.
  return storageWarning
    ? { error: `Removed from the library, but the stored file could not be deleted: ${storageWarning}` }
    : {};
}
