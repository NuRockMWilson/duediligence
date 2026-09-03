import { notFound } from "next/navigation";
import { getDealDocumentLibrary } from "@/lib/data/diligence-documents";
import { canDiligence } from "@/lib/auth/access";
import { DocumentsShell } from "./_components/documents-shell";

// ============================================================================
// /deals/[dealId]/documents — the Document Library on its own route (ASK 4)
// ----------------------------------------------------------------------------
// It used to live as a section at the BOTTOM of the diligence page, below the
// checklist, the deadlines and the financier packets — reachable only by
// scrolling past everything else, and impossible to link to. Worse, it could
// only ever show documents that were already attached to a checklist item,
// because the checklist assembled it from the LINK table (see the note in
// lib/data/diligence-documents.ts).
//
// On its own route it gets a real URL, its own search and filters, and — the
// point of ASK 3 — it can hold a document that is not attached to anything yet.
//
// force-dynamic for the same reason the templates page uses it: signed URLs and
// per-user access make a cached render actively wrong.
// ============================================================================

export const dynamic = "force-dynamic";

export default async function DealDocumentsPage({
  params,
}: {
  params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await params;

  const [library, canEdit] = await Promise.all([
    getDealDocumentLibrary(dealId),
    canDiligence("edit"),
  ]);
  if (!library) notFound();

  return (
    <div className="px-8 py-6 space-y-6">
      <DocumentsShell library={library} canEdit={canEdit} />
    </div>
  );
}
