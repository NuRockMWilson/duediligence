"use client";

// ============================================================================
// Document Library (ASK 3 + ASK 4)
// ----------------------------------------------------------------------------
// Split pane, same shape the diligence page's inline library had: left is the
// file list, right is the preview. What is new here is the part the old one
// could not do —
//   * UPLOAD STRAIGHT TO THE DEAL, with no checklist item chosen (ASK 3);
//   * show documents that are attached to NOTHING, which previously did not
//     appear anywhere at all;
//   * search by name, and filter by attachment state and file type;
//   * link and unlink items from the document's own side.
//
// Display helpers come from lib/diligence/doc-display.ts — the same six
// functions the checklist drawer uses, extracted rather than copied so the two
// screens cannot disagree about what a file is called or how big it is.
// ============================================================================

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Upload,
  Search,
  Download,
  Trash2,
  Link2,
  X,
  Loader2,
  FileText,
} from "lucide-react";
import { Card, FileIcon } from "@/components/nurock-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { formatDate } from "@/lib/format";
import { categoryLabel } from "@/lib/diligence/categories";
import {
  docDisplayName,
  docIconType,
  docSizeLabel,
  isPdfDoc,
  isImageDoc,
  isPreviewable,
} from "@/lib/diligence/doc-display";
import type {
  DealDocument,
  DealDocumentLibrary,
} from "@/lib/data/diligence-documents";
import { getDiligenceDocSignedUrl } from "../../diligence/actions";
import {
  uploadDealDocument,
  linkDocumentToItem,
  unlinkDocumentFromItem,
  deleteDealDocument,
} from "../actions";

const ALL = "__all__";
const PICK = "__pick__";

type AttachFilter = "all" | "unfiled" | "linked";

export function DocumentsShell({
  library,
  canEdit,
}: {
  library: DealDocumentLibrary;
  canEdit: boolean;
}) {
  const router = useRouter();
  const { dealId, dealName, documents, items, counts } = library;

  const [query, setQuery] = React.useState("");
  const [attachFilter, setAttachFilter] = React.useState<AttachFilter>("all");
  const [typeFilter, setTypeFilter] = React.useState<string>(ALL);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const [uploading, setUploading] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [downloadingId, setDownloadingId] = React.useState<string | null>(null);
  const [toDelete, setToDelete] = React.useState<DealDocument | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = React.useState(false);
  const [previewError, setPreviewError] = React.useState<string | null>(null);
  // Guards against a stale signed URL resolving after a newer selection — the
  // same race the inline library had to handle.
  const previewReqRef = React.useRef(0);

  const selected = React.useMemo(
    () => documents.find((d) => d.id === selectedId) ?? null,
    [documents, selectedId]
  );

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return documents.filter((d) => {
      if (q) {
        // Search the display name, the ORIGINAL filename, and the titles of the
        // items it is attached to. The original filename matters: a lender's
        // "Ex_C3_final_v2.pdf" is what the user remembers receiving, and it is
        // not visible once the display name is applied.
        const haystack = [
          docDisplayName(d),
          d.originalFilename,
          ...d.linkedItems.map((i) => i.title),
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (attachFilter === "unfiled" && d.linkedItems.length > 0) return false;
      if (attachFilter === "linked" && d.linkedItems.length === 0) return false;
      if (typeFilter !== ALL && docIconType(d) !== typeFilter) return false;
      return true;
    });
  }, [documents, query, attachFilter, typeFilter]);

  // ---------------------------------------------------------------------------
  // Preview
  // ---------------------------------------------------------------------------
  async function selectDoc(d: DealDocument) {
    setSelectedId(d.id);
    setPreviewUrl(null);
    setPreviewError(null);
    if (!isPreviewable(d)) return;
    const req = ++previewReqRef.current;
    setPreviewLoading(true);
    const res = await getDiligenceDocSignedUrl({ filePath: d.filePath });
    if (req !== previewReqRef.current) return; // superseded
    setPreviewLoading(false);
    if (res.error || !res.signedUrl) {
      setPreviewError(res.error ?? "Could not open that file.");
      return;
    }
    setPreviewUrl(res.signedUrl);
  }

  // Fetch-to-blob rather than navigating to the signed URL, matching the
  // checklist's downloadDoc: a plain anchor to a Supabase signed URL opens the
  // file in a tab instead of saving it, and loses the display name entirely.
  // triggerDownload() is not usable here — it takes a base64 ExportPayload, and
  // this is a URL.
  async function download(d: DealDocument) {
    setDownloadingId(d.id);
    try {
      const res = await getDiligenceDocSignedUrl({ filePath: d.filePath });
      if (res.error || !res.signedUrl) {
        toast.error(res.error ?? "Could not download that file.");
        return;
      }
      const resp = await fetch(res.signedUrl);
      if (!resp.ok) throw new Error(`Download failed (${resp.status})`);
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = docDisplayName(d);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDownloadingId(null);
    }
  }

  // ---------------------------------------------------------------------------
  // Upload — no checklist item required. This is ASK 3.
  // ---------------------------------------------------------------------------
  async function onFilesChosen(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    let okCount = 0;
    const failures: string[] = [];
    // Sequential, not Promise.all: each upload is a storage write plus a row
    // insert, and a parallel burst of ten makes a partial failure much harder
    // to report accurately than it is worth.
    for (const file of Array.from(files)) {
      const fd = new FormData();
      fd.set("dealId", dealId);
      fd.set("dealName", dealName);
      fd.set("file", file);
      const res = await uploadDealDocument(fd);
      if (res.error) failures.push(`${file.name}: ${res.error}`);
      else okCount++;
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (okCount > 0) {
      toast.success(
        `${okCount} document${okCount === 1 ? "" : "s"} added to the library.`
      );
    }
    // EVERY failure is named, not just a count. "3 of 5 uploaded" leaves the
    // user with no idea which two to retry.
    for (const f of failures) toast.error(f);
    router.refresh();
  }

  // ---------------------------------------------------------------------------
  // Link / unlink from the document's side
  // ---------------------------------------------------------------------------
  async function link(d: DealDocument, dealItemId: string) {
    setBusyId(d.id);
    const res = await linkDocumentToItem({
      dealId,
      documentId: d.id,
      dealItemId,
    });
    setBusyId(null);
    if (res.error) toast.error(res.error);
    else {
      toast.success("Linked to the checklist item.");
      router.refresh();
    }
  }

  async function unlink(d: DealDocument, dealItemId: string) {
    setBusyId(d.id);
    const res = await unlinkDocumentFromItem({
      dealId,
      documentId: d.id,
      dealItemId,
    });
    setBusyId(null);
    if (res.error) toast.error(res.error);
    else {
      // Say where it went, because it does NOT disappear — an unlinked document
      // stays in the library as unfiled, which is the whole point of ASK 3.
      toast.success("Unlinked. The document stays in the library.");
      router.refresh();
    }
  }

  async function confirmDelete() {
    const d = toDelete;
    if (!d) return;
    setToDelete(null);
    setBusyId(d.id);
    const res = await deleteDealDocument({ dealId, documentId: d.id });
    setBusyId(null);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    if (selectedId === d.id) setSelectedId(null);
    toast.success("Document deleted.");
    router.refresh();
  }

  const unlinkedItems = React.useMemo(() => {
    if (!selected) return items;
    const linked = new Set(selected.linkedItems.map((i) => i.dealItemId));
    return items.filter((i) => !linked.has(i.dealItemId));
  }, [items, selected]);

  return (
    <>
      {/* ---- Header ---------------------------------------------------- */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h1 className="font-display text-lg text-nurock-black">
            Document Library
          </h1>
          <p className="text-[12px] text-nurock-slate-light mt-0.5">
            {counts.total} document{counts.total === 1 ? "" : "s"} ·{" "}
            {counts.linked} linked · {counts.unfiled} unfiled ·{" "}
            {docSizeLabel(counts.totalBytes)} total
          </p>
        </div>
        {canEdit && (
          <div>
            {/* Multiple, because diligence arrives as a batch from a lender. */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => onFilesChosen(e.target.files)}
            />
            <Button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="h-9"
            >
              {uploading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Upload className="w-4 h-4" />
              )}
              Upload to library
            </Button>
          </div>
        )}
      </div>

      {/* ---- Filters --------------------------------------------------- */}
      <Card className="p-3">
        <div className="flex flex-col md:flex-row gap-2 md:items-center">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-nurock-slate-light" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by file name or linked item…"
              className="h-9 pl-8 text-[13px]"
            />
          </div>
          <Select
            value={attachFilter}
            onValueChange={(v) => setAttachFilter(v as AttachFilter)}
          >
            <SelectTrigger className="h-9 text-[12px] w-full md:w-[190px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All documents</SelectItem>
              <SelectItem value="unfiled">
                Unfiled ({counts.unfiled})
              </SelectItem>
              <SelectItem value="linked">Linked ({counts.linked})</SelectItem>
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="h-9 text-[12px] w-full md:w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Any file type</SelectItem>
              <SelectItem value="pdf">PDF</SelectItem>
              <SelectItem value="img">Image</SelectItem>
              <SelectItem value="xls">Spreadsheet</SelectItem>
              <SelectItem value="csv">CSV</SelectItem>
              <SelectItem value="doc">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      {/* ---- Empty states. Two of them, because "no documents at all" and
             "your filters match nothing" are different problems and a single
             message for both sends the user looking in the wrong place. ---- */}
      {counts.total === 0 ? (
        <Card className="p-8 text-center">
          <FileText className="w-9 h-9 mx-auto text-nurock-slate-light opacity-50" />
          <div className="mt-3 text-sm font-medium text-nurock-slate">
            No documents on this deal yet
          </div>
          <div className="mt-1 text-[12px] text-nurock-slate-light">
            Upload straight to the library — you can attach files to checklist
            items now or later.
          </div>
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="p-6 text-center text-[12.5px] text-nurock-slate-light">
          No documents match those filters.{" "}
          <button
            onClick={() => {
              setQuery("");
              setAttachFilter("all");
              setTypeFilter(ALL);
            }}
            className="text-nurock-navy underline"
          >
            Clear filters
          </button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-19rem)]">
          {/* ---- Left: the list ---------------------------------------- */}
          <Card className="p-0 overflow-hidden lg:col-span-1 flex flex-col">
            <div className="px-4 py-2 border-b border-nurock-border text-[10.5px] uppercase tracking-wider text-nurock-slate-light font-medium">
              {filtered.length} of {counts.total} shown
            </div>
            <ul className="flex-1 overflow-y-auto divide-y divide-nurock-border/60">
              {filtered.map((d) => {
                const active = d.id === selectedId;
                return (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() => selectDoc(d)}
                      aria-current={active ? "true" : undefined}
                      className={`w-full text-left px-4 py-2.5 flex items-start gap-2.5 border-l-2 transition-colors ${
                        active
                          ? "bg-nurock-tan/10 border-nurock-tan"
                          : "border-transparent hover:bg-nurock-offwhite"
                      }`}
                    >
                      <FileIcon type={docIconType(d)} />
                      <span className="min-w-0 flex-1">
                        <span
                          className="block truncate text-[12.5px] text-nurock-black"
                          title={docDisplayName(d)}
                        >
                          {docDisplayName(d)}
                        </span>
                        <span className="block text-[11px] text-nurock-slate-light">
                          {docSizeLabel(d.byteSize)}
                          {" · "}
                          {d.linkedItems.length === 0 ? (
                            <span className="text-nurock-tan-dark">
                              unfiled
                            </span>
                          ) : (
                            `${d.linkedItems.length} item${
                              d.linkedItems.length === 1 ? "" : "s"
                            }`
                          )}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>

          {/* ---- Right: preview + attachments -------------------------- */}
          <Card className="p-0 overflow-hidden lg:col-span-2 flex flex-col">
            {!selected ? (
              <div className="flex-1 p-6">
                <div className="h-full min-h-[240px] rounded-lg border-2 border-dashed border-nurock-border flex flex-col items-center justify-center gap-3 text-center">
                  <FileText className="w-10 h-10 text-nurock-slate-light opacity-50" />
                  <div className="text-sm font-medium text-nurock-slate">
                    Select a document to preview
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="px-4 py-3 border-b border-nurock-border flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div
                      className="font-display text-[13.5px] text-nurock-black truncate"
                      title={docDisplayName(selected)}
                    >
                      {docDisplayName(selected)}
                    </div>
                    <div className="text-[11px] text-nurock-slate-light mt-0.5">
                      {docSizeLabel(selected.byteSize)}
                      {selected.uploadedByName
                        ? ` · ${selected.uploadedByName}`
                        : ""}
                      {` · ${formatDate(selected.createdAt)}`}
                    </div>
                    {/* The uploader's own filename, when the display name has
                        replaced it — it is what they remember receiving. */}
                    {selected.displayName &&
                      selected.displayName !== selected.originalFilename && (
                        <div
                          className="text-[10.5px] text-nurock-slate-light truncate mt-0.5"
                          title={selected.originalFilename}
                        >
                          original: {selected.originalFilename}
                        </div>
                      )}
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-[12px]"
                      onClick={() => download(selected)}
                      disabled={downloadingId === selected.id}
                    >
                      {downloadingId === selected.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Download className="w-3.5 h-3.5" />
                      )}
                      Download
                    </Button>
                    {canEdit && (
                      <button
                        onClick={() => setToDelete(selected)}
                        disabled={busyId === selected.id}
                        className="p-1.5 text-nurock-slate-light hover:text-red-600 disabled:opacity-40"
                        title={
                          selected.linkedItems.length > 0
                            ? "Unlink from every item before deleting"
                            : "Delete this document"
                        }
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Attachments */}
                <div className="px-4 py-3 border-b border-nurock-border">
                  <div className="text-[10.5px] uppercase tracking-wider text-nurock-slate-light font-medium mb-2">
                    Linked checklist items
                  </div>
                  {selected.linkedItems.length === 0 ? (
                    <div className="text-[12px] text-nurock-slate-light mb-2">
                      Not linked to anything yet — it lives in the library until
                      you attach it.
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {selected.linkedItems.map((i) => (
                        <span
                          key={i.dealItemId}
                          className="inline-flex items-center gap-1 rounded-full bg-nurock-navy/[0.06] border border-nurock-navy/15 px-2 py-0.5 text-[11px] text-nurock-navy"
                          title={categoryLabel(i.category)}
                        >
                          <Link2 className="w-3 h-3" />
                          {i.itemNumber != null ? `${i.itemNumber} · ` : ""}
                          {i.title}
                          {canEdit && (
                            <button
                              onClick={() => unlink(selected, i.dealItemId)}
                              disabled={busyId === selected.id}
                              className="text-nurock-slate-light hover:text-red-600 disabled:opacity-40"
                              title="Unlink from this item"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                  {canEdit && unlinkedItems.length > 0 && (
                    <Select
                      value={PICK}
                      onValueChange={(v) => {
                        if (v !== PICK) link(selected, v);
                      }}
                    >
                      <SelectTrigger className="h-8 text-[12px] w-full">
                        <SelectValue placeholder="+ Link to a checklist item…">
                          + Link to a checklist item…
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {unlinkedItems.map((i) => (
                          <SelectItem key={i.dealItemId} value={i.dealItemId}>
                            {i.itemNumber != null ? `${i.itemNumber} · ` : ""}
                            {i.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                {/* Preview */}
                <div className="flex-1 overflow-hidden bg-nurock-offwhite">
                  {previewLoading ? (
                    <div className="h-full flex items-center justify-center text-[12px] text-nurock-slate-light">
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      Opening…
                    </div>
                  ) : previewError ? (
                    <div className="h-full flex items-center justify-center p-6 text-center text-[12px] text-red-600">
                      {previewError}
                    </div>
                  ) : !isPreviewable(selected) ? (
                    <div className="h-full flex flex-col items-center justify-center gap-2 p-6 text-center">
                      <FileIcon type={docIconType(selected)} />
                      <div className="text-[12.5px] text-nurock-slate">
                        No inline preview for this file type
                      </div>
                      <div className="text-[11.5px] text-nurock-slate-light">
                        Download it to open in its own application.
                      </div>
                    </div>
                  ) : previewUrl && isPdfDoc(selected) ? (
                    <iframe
                      src={previewUrl}
                      title={docDisplayName(selected)}
                      className="w-full h-full border-0"
                    />
                  ) : previewUrl && isImageDoc(selected) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={previewUrl}
                      alt={docDisplayName(selected)}
                      className="w-full h-full object-contain"
                    />
                  ) : null}
                </div>
              </>
            )}
          </Card>
        </div>
      )}

      {/* Delete confirmation. The copy states the refusal condition rather than
          hiding the button, so a user who cannot delete learns why. */}
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Delete this document?"
        description={
          toDelete
            ? toDelete.linkedItems.length > 0
              ? `"${docDisplayName(toDelete)}" is linked to ${
                  toDelete.linkedItems.length
                } checklist item${
                  toDelete.linkedItems.length === 1 ? "" : "s"
                }. Unlink it from each one first — deleting it would remove evidence those items depend on.`
              : `"${docDisplayName(
                  toDelete
                )}" and its stored file will be permanently deleted. This cannot be undone.`
            : ""
        }
        confirmLabel="Delete document"
        destructive
        onConfirm={confirmDelete}
      />
    </>
  );
}
