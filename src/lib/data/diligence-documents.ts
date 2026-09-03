// =============================================================================
// Deal document library — reads (ASK 3 + ASK 4)
// =============================================================================
// THE DEFECT THIS FILE EXISTS TO FIX.
//
// getDiligenceChecklist() builds its `library` by iterating
// dm_diligence_item_documents — the LINK table — and collecting the joined
// document rows:
//
//     for (const l of linksRes.data) { ... libraryById.set(d.id, lib) }
//
// So a document is in the library IF AND ONLY IF at least one link row points at
// it. That is fine while the only way to upload is from an item's drawer, which
// links as it uploads. It is fatal for ASK 3: a document uploaded to the deal
// WITHOUT being attached to an item has no link row, so it would be stored,
// charged against the deal's storage, and INVISIBLE — no list would show it and
// nothing could ever link it.
//
// This module sources from dm_diligence_documents (deal-scoped) OUTWARD and
// treats links as an attribute of a document rather than the reason it exists.
// Unlinked documents are first-class, and `linkedItems` is simply empty.
//
// It does NOT replace the checklist's per-item document lists — those are a
// different question ("what is attached to THIS item") and are still answered
// where they are asked.
// =============================================================================

import { createClient } from "@/lib/supabase/server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySb = any;

/** A checklist item a document is attached to. */
export interface DocLinkedItem {
  dealItemId: string;
  itemNumber: number | null;
  title: string;
  category: string;
}

export interface DealDocument {
  id: string;
  displayName: string | null;
  originalFilename: string;
  filePath: string;
  mimeType: string | null;
  byteSize: number | null;
  uploadedBy: string | null;
  /** Resolved display name / email of the uploader, when known. */
  uploadedByName: string | null;
  createdAt: string;
  syncStatus: string;
  sharepointPath: string | null;
  /** Empty for a library-only (unfiled) document. */
  linkedItems: DocLinkedItem[];
}

export interface DealDocumentLibrary {
  dealId: string;
  dealName: string;
  documents: DealDocument[];
  /** Every checklist item on the deal, for the "link to item" picker. */
  items: DocLinkedItem[];
  counts: {
    total: number;
    unfiled: number;
    linked: number;
    totalBytes: number;
  };
}

/**
 * Every document on a deal, linked or not, with the items each is attached to.
 *
 * FOUR QUERIES, NOT A NESTED SELECT. The link table joins documents to
 * dm_diligence_deal_items, and the item TITLE lives one hop further on in
 * nurock_diligence_items — a two-level embed through an untyped table is where
 * this codebase's PostgREST selects tend to silently return null children. Doing
 * it in the app keeps the failure modes visible and lets an item whose catalog
 * row was retired still resolve a title.
 */
export async function getDealDocumentLibrary(
  dealId: string
): Promise<DealDocumentLibrary | null> {
  const supabase = (await createClient()) as AnySb;

  const { data: deal } = await supabase
    .from("deals")
    .select("id, name")
    .eq("id", dealId)
    .maybeSingle();
  if (!deal) return null;
  const dealName = (deal as { name: string }).name;

  const [docsRes, linksRes, itemsRes] = await Promise.all([
    supabase
      .from("dm_diligence_documents")
      .select(
        "id, display_name, original_filename, file_path, mime_type, byte_size, uploaded_by, created_at, sync_status, sharepoint_path"
      )
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false }),
    supabase
      .from("dm_diligence_item_documents")
      .select("deal_item_id, document_id")
      .eq("deal_id", dealId),
    // The deal's items plus their catalog title/number, for both the linked-item
    // labels and the picker.
    supabase
      .from("dm_diligence_deal_items")
      .select(
        "id, item_id, nurock_diligence_items ( item_number, title, category )"
      )
      .eq("deal_id", dealId),
  ]);

  type ItemRow = {
    id: string;
    item_id: string;
    nurock_diligence_items: {
      item_number: number | null;
      title: string;
      category: string;
    } | null;
  };

  const itemById = new Map<string, DocLinkedItem>();
  for (const r of (itemsRes.data ?? []) as ItemRow[]) {
    const cat = r.nurock_diligence_items;
    itemById.set(r.id, {
      dealItemId: r.id,
      itemNumber: cat?.item_number ?? null,
      // A retired catalog row still resolves through the FK, but guard anyway:
      // a missing title must read as unknown, never as an empty label.
      title: cat?.title ?? "(item no longer in the checklist)",
      category: cat?.category ?? "",
    });
  }

  const linksByDoc = new Map<string, DocLinkedItem[]>();
  for (const l of (linksRes.data ?? []) as Array<{
    deal_item_id: string;
    document_id: string;
  }>) {
    const item = itemById.get(l.deal_item_id);
    if (!item) continue; // link to an item no longer on the deal
    const arr = linksByDoc.get(l.document_id) ?? [];
    arr.push(item);
    linksByDoc.set(l.document_id, arr);
  }

  type DocRow = {
    id: string;
    display_name: string | null;
    original_filename: string;
    file_path: string;
    mime_type: string | null;
    byte_size: number | null;
    uploaded_by: string | null;
    created_at: string;
    sync_status: string;
    sharepoint_path: string | null;
  };
  const rows = (docsRes.data ?? []) as DocRow[];

  // Resolve uploader names in one fetch rather than per row.
  const uploaderIds = Array.from(
    new Set(rows.map((r) => r.uploaded_by).filter((v): v is string => !!v))
  );
  const nameByUser = new Map<string, string>();
  if (uploaderIds.length > 0) {
    const { data: users } = await supabase
      .from("app_users")
      .select("user_id, display_name, email")
      .in("user_id", uploaderIds);
    for (const u of (users ?? []) as Array<{
      user_id: string;
      display_name: string | null;
      email: string | null;
    }>) {
      nameByUser.set(u.user_id, u.display_name ?? u.email ?? "Team member");
    }
  }

  const documents: DealDocument[] = rows.map((r) => {
    const linked = (linksByDoc.get(r.id) ?? []).sort(
      (a, b) => (a.itemNumber ?? 0) - (b.itemNumber ?? 0)
    );
    return {
      id: r.id,
      displayName: r.display_name,
      originalFilename: r.original_filename,
      filePath: r.file_path,
      mimeType: r.mime_type,
      byteSize: r.byte_size,
      uploadedBy: r.uploaded_by,
      uploadedByName: r.uploaded_by
        ? nameByUser.get(r.uploaded_by) ?? null
        : null,
      createdAt: r.created_at,
      syncStatus: r.sync_status,
      sharepointPath: r.sharepoint_path,
      linkedItems: linked,
    };
  });

  const unfiled = documents.filter((d) => d.linkedItems.length === 0).length;

  return {
    dealId,
    dealName,
    documents,
    items: Array.from(itemById.values()).sort(
      (a, b) => (a.itemNumber ?? 0) - (b.itemNumber ?? 0)
    ),
    counts: {
      total: documents.length,
      unfiled,
      linked: documents.length - unfiled,
      totalBytes: documents.reduce((s, d) => s + (d.byteSize ?? 0), 0),
    },
  };
}
