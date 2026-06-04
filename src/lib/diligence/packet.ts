// =============================================================================
// Diligence packet builder (Increment 3)
// =============================================================================
// Produces a branded PDF summary of a deal's due-diligence checklist and,
// optionally, a ZIP bundling that PDF with every linked document (renamed to
// its display name). Reuses the shared letterhead PDF toolkit and jszip.
//
// Pure builders: the action gathers data + document bytes and calls these.
// =============================================================================

import JSZip from "jszip";
import {
  createBrandedPdf,
  drawHeading,
  drawSubheading,
  drawText,
  drawTextRight,
  PDF_COLORS,
  LETTERHEAD,
  ascii,
  type BrandedPdf,
} from "@/lib/pdf/letterhead";
import type { PDFFont } from "pdf-lib";
import { categoryLabel, categoryOrder } from "@/lib/diligence/categories";
import { STATUS_LABEL } from "@/lib/diligence/status-labels";
import type { DiligenceItem } from "@/lib/data/diligence";
import type {
  DiligenceRollup,
  FinancierCoverage,
} from "@/lib/data/diligence-rollup";

export interface PacketPdfInput {
  dealName: string;
  generatedOn: string; // human date
  rollup: DiligenceRollup;
  items: DiligenceItem[];
  financiers: FinancierCoverage[];
}

function truncateToWidth(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number
): string {
  const t = ascii(text);
  if (font.widthOfTextAtSize(t, size) <= maxWidth) return t;
  let s = t;
  while (s.length > 1 && font.widthOfTextAtSize(s + "…", size) > maxWidth) {
    s = s.slice(0, -1);
  }
  return s + "…";
}

export async function buildDiligencePacketPdf(
  input: PacketPdfInput
): Promise<Uint8Array> {
  const brand = await createBrandedPdf();
  const left = LETTERHEAD.marginLeft;
  const right = LETTERHEAD.pageWidth - LETTERHEAD.marginRight;

  let page = brand.addPage();
  let y: number = LETTERHEAD.contentTop;

  // --- Cover ---
  y = drawHeading(page, "Due Diligence Package", brand, { x: left, y });
  drawText(page, input.dealName, brand, {
    x: left,
    y,
    size: 12,
    font: brand.fontBold,
    color: PDF_COLORS.black,
  });
  drawTextRight(page, input.generatedOn, brand, {
    rightX: right,
    y,
    size: 9,
    color: PDF_COLORS.slate,
  });
  y -= 22;

  const r = input.rollup;
  drawText(
    page,
    `Readiness ${r.coveragePct}%  -  ${r.approved}/${r.applicable} required items approved  -  ${r.outstandingCount} outstanding  -  ${r.overdueCount} overdue`,
    brand,
    { x: left, y, size: 10, color: PDF_COLORS.slate }
  );
  y -= 24;

  // --- Financier packets summary ---
  if (input.financiers.length > 0) {
    y = drawSubheading(page, "Investor & Lender Packets", brand, { x: left, y });
    for (const f of input.financiers) {
      drawText(page, truncateToWidth(f.financierName ?? f.name, brand.font, 10, 300), brand, {
        x: left,
        y,
        size: 10,
        color: PDF_COLORS.black,
      });
      drawTextRight(
        page,
        `${f.coveragePct}%  (${f.satisfied}/${f.total}${f.unmappedCount ? `, ${f.unmappedCount} unmapped` : ""})`,
        brand,
        { rightX: right, y, size: 9, color: PDF_COLORS.slate }
      );
      y -= 14;
    }
    y -= 12;
  }

  // --- Checklist, grouped by category ---
  const groups = new Map<string, DiligenceItem[]>();
  for (const i of input.items) {
    const arr = groups.get(i.category) ?? [];
    arr.push(i);
    groups.set(i.category, arr);
  }
  const orderedCats = Array.from(groups.keys()).sort(
    (a, b) => categoryOrder(a) - categoryOrder(b)
  );

  const ensureRoom = (needed: number) => {
    if (y - needed < LETTERHEAD.contentBottom) {
      page = brand.addPage();
      y = LETTERHEAD.contentTop;
    }
  };

  // Column x-positions.
  const xStatus = 360;
  const xAssignee = 430;

  for (const cat of orderedCats) {
    ensureRoom(28);
    y = drawSubheading(page, categoryLabel(cat), brand, { x: left, y });
    // Column header row
    drawText(page, "ITEM", brand, { x: left, y, size: 7.5, font: brand.fontBold, color: PDF_COLORS.slateLight });
    drawText(page, "STATUS", brand, { x: xStatus, y, size: 7.5, font: brand.fontBold, color: PDF_COLORS.slateLight });
    drawText(page, "OWNER", brand, { x: xAssignee, y, size: 7.5, font: brand.fontBold, color: PDF_COLORS.slateLight });
    drawTextRight(page, "DUE", brand, { rightX: right, y, size: 7.5, font: brand.fontBold, color: PDF_COLORS.slateLight });
    y -= 13;

    for (const item of groups.get(cat)!) {
      ensureRoom(14);
      const label = `${item.itemNumber ?? ""} ${item.title}`.trim();
      drawText(page, truncateToWidth(label, brand.font, 9, xStatus - left - 6), brand, {
        x: left,
        y,
        size: 9,
        color: PDF_COLORS.black,
      });
      drawText(page, STATUS_LABEL[item.status], brand, {
        x: xStatus,
        y,
        size: 8.5,
        color:
          item.status === "approved"
            ? PDF_COLORS.navy
            : item.status === "waived" || item.status === "na"
              ? PDF_COLORS.slateLight
              : PDF_COLORS.slate,
      });
      drawText(
        page,
        truncateToWidth(item.assigneeName ?? "—", brand.font, 8.5, right - xAssignee - 50),
        brand,
        { x: xAssignee, y, size: 8.5, color: PDF_COLORS.slate }
      );
      drawTextRight(page, item.dueDate ?? "—", brand, {
        rightX: right,
        y,
        size: 8.5,
        color: PDF_COLORS.slate,
      });
      // Doc count marker under the item label.
      if (item.docs.length > 0) {
        y -= 10;
        drawText(page, `${item.docs.length} document${item.docs.length === 1 ? "" : "s"} attached`, brand, {
          x: left + 12,
          y,
          size: 7.5,
          color: PDF_COLORS.slateLight,
        });
      }
      y -= 14;
    }
    y -= 6;
  }

  return brand.doc.save();
}

export interface PacketDoc {
  name: string; // display name (renamed)
  bytes: Uint8Array;
}

/** Bundle the summary PDF + linked documents into a ZIP. */
export async function buildDiligencePacketZip(
  summaryPdf: Uint8Array,
  docs: PacketDoc[]
): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("Due Diligence Summary.pdf", summaryPdf);
  const folder = zip.folder("documents");
  const usedNames = new Set<string>();
  for (const d of docs) {
    // De-dupe identical display names within the zip.
    let name = d.name;
    let n = 2;
    while (usedNames.has(name)) {
      const dot = d.name.lastIndexOf(".");
      name =
        dot > 0
          ? `${d.name.slice(0, dot)} (${n})${d.name.slice(dot)}`
          : `${d.name} (${n})`;
      n++;
    }
    usedNames.add(name);
    folder!.file(name, d.bytes);
  }
  return zip.generateAsync({ type: "uint8array" });
}
