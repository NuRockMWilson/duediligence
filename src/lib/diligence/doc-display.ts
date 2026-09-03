// =============================================================================
// Document display helpers — ONE implementation, two surfaces.
// =============================================================================
// EXTRACTED FROM diligence-shell.tsx 2026-09-03, when the Document Library got
// its own route (ASK 4). These six functions decide what a file is CALLED, what
// ICON it gets, whether it can be PREVIEWED inline, and how its SIZE reads.
// Copying them into the new route would have created two implementations of one
// concept — the defect family this program keeps paying for — and they would
// have drifted at the first "why does the library say 4 KB and the drawer say
// <1 KB" bug.
//
// Typed on a MINIMAL STRUCTURAL SHAPE rather than on LibraryDoc, so both
// LibraryDoc (checklist) and DealDocument (library route) satisfy it without
// either importing the other's type.
// =============================================================================

import type { FileType } from "@/components/nurock-ui";

/** The least a caller must supply. Both document types are supersets of this. */
export interface DisplayableDoc {
  displayName: string | null;
  originalFilename: string;
  mimeType: string | null;
}

// mimeType is nullable and often "application/octet-stream", so every check
// branches on the filename extension too.
const DOC_IMAGE_EXTS = [
  "png", "jpg", "jpeg", "gif", "webp", "heic", "avif", "bmp", "svg",
];

export function docDisplayName(d: DisplayableDoc): string {
  return d.displayName ?? d.originalFilename;
}

export function docExt(d: DisplayableDoc): string {
  const n = d.originalFilename || d.displayName || "";
  const i = n.lastIndexOf(".");
  return i >= 0 && i < n.length - 1 ? n.slice(i + 1).toLowerCase() : "";
}

export function isPdfDoc(d: DisplayableDoc): boolean {
  return d.mimeType === "application/pdf" || docExt(d) === "pdf";
}

export function isImageDoc(d: DisplayableDoc): boolean {
  return (
    (d.mimeType?.startsWith("image/") ?? false) ||
    DOC_IMAGE_EXTS.includes(docExt(d))
  );
}

/** Inline-previewable (PDF via iframe, image via img); everything else gets a
 *  styled placeholder plus download. */
export function isPreviewable(d: DisplayableDoc): boolean {
  return isPdfDoc(d) || isImageDoc(d);
}

export function docIconType(d: DisplayableDoc): FileType {
  const ext = docExt(d);
  const m = d.mimeType ?? "";
  if (isPdfDoc(d)) return "pdf";
  if (isImageDoc(d)) return "img";
  if (ext === "csv" || m.includes("csv")) return "csv";
  if (
    ["xls", "xlsx"].includes(ext) ||
    m.includes("spreadsheet") ||
    m.includes("excel")
  )
    return "xls";
  return "doc";
}

/**
 * Preserves the shipped convention (Dil #10): sub-1KB files show "<1 KB".
 *
 * KEPT AS-IS rather than "improved" to MB for large files. The live session
 * measures against these exact strings, and a 6.4 MB packet already reports in
 * KB elsewhere; changing the unit here alone would make two numbers for one file
 * disagree across screens. If it should read MB, it should read MB everywhere,
 * as one change.
 */
export function docSizeLabel(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return "<1 KB";
  return `${(bytes / 1024).toFixed(0)} KB`;
}
