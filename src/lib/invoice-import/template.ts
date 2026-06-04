// =============================================================================
// Invoice mass-import — template + column model
// =============================================================================
// Single source of truth for the import column set. Used both to GENERATE the
// downloadable .xlsx template and to PARSE an uploaded workbook (header → key
// matching is normalized so minor header edits still map). One row = one
// invoice; an optional GL Account column creates a single coded line.
//
// The template is built with ExcelJS (not SheetJS) so it can carry NuRock
// brand styling: an embedded logo, navy header band, brand fonts, and real
// date / number formats. House style (see memory/house_style.md):
//   • Dollar amounts → thousands separators, no decimals  (#,##0)
//   • Dates          → M/D/YYYY
//   • Navy #164576 / Tan #B4AE92 · Oswald (headings) / Inter (body)
//
// Because the branded sheet places a logo band ABOVE the header row, the
// uploaded-workbook parser (import/actions.ts) finds the header row by content
// rather than assuming row 1 — so this layout and re-import stay in sync.
// =============================================================================

import ExcelJS from "exceljs";
import { NUROCK_LOGO_PNG_BASE64, NUROCK_LOGO_PX } from "./logo";

export type ImportColumnKey =
  | "vendorName"
  | "invoiceNumber"
  | "invoiceDate"
  | "grossAmount"
  | "periodStart"
  | "periodEnd"
  | "dueDate"
  | "glAccount"
  | "eligibleAmount"
  | "notes";

export interface ImportColumn {
  key: ImportColumnKey;
  header: string;
  required: boolean;
  note: string;
}

export const IMPORT_COLUMNS: ImportColumn[] = [
  { key: "vendorName", header: "Vendor", required: true, note: "Vendor / payee name. Matched to an existing vendor by name; created automatically if new." },
  { key: "invoiceNumber", header: "Invoice #", required: true, note: "Vendor's invoice number. Vendor + Invoice # must be unique on the deal (duplicates are skipped)." },
  { key: "invoiceDate", header: "Invoice Date", required: true, note: "Invoice date. Any Excel date or YYYY-MM-DD / M/D/YYYY text." },
  { key: "grossAmount", header: "Gross Amount", required: true, note: "Total invoice amount. Numbers only ($ and commas are fine). Use a negative for credit memos." },
  { key: "periodStart", header: "Period Start", required: false, note: "Work/service period start (optional)." },
  { key: "periodEnd", header: "Period End", required: false, note: "Work/service period end (optional)." },
  { key: "dueDate", header: "Due Date", required: false, note: "Payment due date (optional)." },
  { key: "glAccount", header: "GL Account", required: false, note: "Optional GL/cost account. If provided it must exist in the Chart of Accounts and creates one coded line; leave blank to code later." },
  { key: "eligibleAmount", header: "Eligible Amount", required: false, note: "Optional LIHTC-eligible portion of the line (only used when a GL Account is set)." },
  { key: "notes", header: "Notes", required: false, note: "Optional free-text note." },
];

/** Normalize a header cell for tolerant matching (case/punctuation-insensitive). */
export function normalizeHeader(h: string): string {
  return String(h ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Map of normalized header → column key, for parsing uploaded sheets. */
export function buildHeaderKeyMap(): Map<string, ImportColumnKey> {
  const m = new Map<string, ImportColumnKey>();
  for (const c of IMPORT_COLUMNS) m.set(normalizeHeader(c.header), c.key);
  // A few friendly aliases.
  m.set("invoicenumber", "invoiceNumber");
  m.set("invoiceno", "invoiceNumber");
  m.set("amount", "grossAmount");
  m.set("gross", "grossAmount");
  m.set("glaccountcode", "glAccount");
  m.set("costcode", "glAccount");
  m.set("eligible", "eligibleAmount");
  return m;
}

// ----- brand tokens ---------------------------------------------------------
// ARGB (alpha-first) form of the brand palette in lib/design-tokens.ts.
const BRAND = {
  navy: "FF164576",
  navyDark: "FF0F3557",
  tan: "FFB4AE92",
  slate: "FF475467",
  slateLight: "FF667085",
  grayBg: "FFF7F8FA",
  border: "FFE4E7EC",
  white: "FFFFFFFF",
  black: "FF101828",
} as const;
// Calibri for everything: it ships with Office on every recipient's machine, so
// the workbook renders identically rather than substituting when the brand
// faces (Oswald/Inter) aren't installed. Hierarchy comes from weight/size/color.
const HEAD_FONT = "Calibri"; // headings (bold)
const BODY_FONT = "Calibri"; // body

// Column number formats keyed by spreadsheet column letter. Dates → M/D/YYYY;
// money → thousands/millions separators, no decimals (house style).
const DATE_FMT = "m/d/yyyy";
const MONEY_FMT = "#,##0";
// 1-based column indices: C=3 Invoice Date, E=5 Period Start, F=6 Period End,
// G=7 Due Date | D=4 Gross Amount, I=9 Eligible Amount.
const DATE_COLS = [3, 5, 6, 7];
const MONEY_COLS = [4, 9];

function utcDate(y: number, m: number, d: number): Date {
  // Noon-free, midnight-UTC date so the M/D/YYYY format shows the intended
  // calendar day regardless of the server's timezone.
  return new Date(Date.UTC(y, m - 1, d));
}

/** 1→A … 26→Z (only need up to column J here). */
function colLetter(n: number): string {
  return String.fromCharCode(64 + n);
}

/**
 * Draw the shared NuRock letterhead band on rows 1–4: a navy ground (matching
 * the app header) carrying the white logo + wordmark, capped by a thin tan
 * accent rule. The brand mark asset is a *reversed* (white) logo, so it needs
 * the navy ground to be visible — on a white sheet it would disappear.
 */
function drawBanner(
  ws: ExcelJS.Worksheet,
  logoId: number,
  subtitle: string,
  lastColNum: number
): void {
  const last = colLetter(lastColNum);
  ws.getRow(1).height = 30;
  ws.getRow(2).height = 26;
  ws.getRow(3).height = 6; // tan rule
  ws.getRow(4).height = 8; // spacer

  // Navy band across the full width on rows 1–2.
  for (let r = 1; r <= 2; r++) {
    for (let c = 1; c <= lastColNum; c++) {
      ws.getCell(r, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND.navy } };
    }
  }

  // White logo over the navy band, top-left. Sized from the asset's aspect
  // ratio (256×208) to ~52px tall.
  const h = 52;
  const w = Math.round((h * NUROCK_LOGO_PX.width) / NUROCK_LOGO_PX.height);
  ws.addImage(logoId, {
    tl: { col: 0.18, row: 0.22 },
    ext: { width: w, height: h },
    editAs: "oneCell",
  });

  // Wordmark + subtitle, white on navy, to the right of the logo. numFmt is
  // pinned to General so the date/money column formats can't bleed onto the
  // banner text.
  ws.mergeCells(`C1:${last}1`);
  ws.mergeCells(`C2:${last}2`);
  const title = ws.getCell("C1");
  title.value = "NUROCK";
  title.font = { name: HEAD_FONT, size: 16, bold: true, color: { argb: BRAND.white } };
  title.alignment = { vertical: "bottom", horizontal: "left" };
  title.numFmt = "General";
  const sub = ws.getCell("C2");
  sub.value = subtitle;
  sub.font = { name: BODY_FONT, size: 10, color: { argb: BRAND.tan } };
  sub.alignment = { vertical: "top", horizontal: "left" };
  sub.numFmt = "General";

  // Thin tan accent rule under the band.
  for (let c = 1; c <= lastColNum; c++) {
    ws.getCell(3, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND.tan } };
  }
}

function thin(color: string): Partial<ExcelJS.Borders> {
  return {
    top: { style: "thin", color: { argb: color } },
    left: { style: "thin", color: { argb: color } },
    bottom: { style: "thin", color: { argb: color } },
    right: { style: "thin", color: { argb: color } },
  };
}

/**
 * Build the downloadable .xlsx template as a base64 string (ready for the
 * { base64, filename, mime } envelope). Two branded sheets: "Invoices" (logo
 * band + styled header + one example) and "Instructions" (column guidance +
 * the import rules). Async because ExcelJS serializes to a buffer.
 */
export async function buildInvoiceTemplateBase64(): Promise<string> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "NuRock Development Platform";
  wb.created = utcDate(2026, 1, 1);

  const logoId = wb.addImage({
    base64: `data:image/png;base64,${NUROCK_LOGO_PNG_BASE64}`,
    extension: "png",
  });

  // ---------------------------------------------------------------- Invoices
  const HEADER_ROW = 5;
  const ws = wb.addWorksheet("Invoices", {
    views: [{ state: "frozen", ySplit: HEADER_ROW }],
  });

  const widths = [26, 13, 13, 15, 13, 13, 12, 16, 16, 30];
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  for (const c of DATE_COLS) ws.getColumn(c).numFmt = DATE_FMT;
  for (const c of MONEY_COLS) ws.getColumn(c).numFmt = MONEY_FMT;

  drawBanner(ws, logoId, "Invoice Import Template", 10);

  // Header row — navy band, white Oswald, wrapped + centered. numFmt pinned to
  // General so the date/money column defaults don't render on the header text.
  const header = ws.getRow(HEADER_ROW);
  header.height = 30;
  IMPORT_COLUMNS.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.header;
    cell.numFmt = "General";
    cell.font = { name: HEAD_FONT, size: 10, bold: true, color: { argb: BRAND.white } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND.navy } };
    cell.border = thin(BRAND.navyDark);
    cell.note = `${c.required ? "Required" : "Optional"} — ${c.note}`;
  });

  // Example row — italic/slate on a light fill to signal "sample, delete me".
  const example: (string | number | Date | null)[] = [
    "ABC Framing LLC", // A Vendor
    "1042", // B Invoice #
    utcDate(2026, 8, 15), // C Invoice Date
    125000, // D Gross Amount
    utcDate(2026, 7, 1), // E Period Start
    utcDate(2026, 7, 31), // F Period End
    utcDate(2026, 9, 15), // G Due Date
    null, // H GL Account (optional)
    null, // I Eligible Amount (optional)
    "Framing — building 3", // J Notes
  ];
  const exRow = ws.getRow(HEADER_ROW + 1);
  exRow.height = 18;
  example.forEach((v, i) => {
    const cell = exRow.getCell(i + 1);
    cell.value = v;
    cell.font = { name: BODY_FONT, size: 10, italic: true, color: { argb: BRAND.slateLight } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND.grayBg } };
    cell.border = { bottom: { style: "thin", color: { argb: BRAND.border } } };
    const horizontal =
      i === 3 || i === 8 ? "right" : i >= 2 && i <= 6 ? "center" : "left";
    cell.alignment = { vertical: "middle", horizontal };
  });
  ws.getCell(`A${HEADER_ROW + 1}`).note =
    "Example row — delete before importing.";

  // --------------------------------------------------------------- Instructions
  const wsi = wb.addWorksheet("Instructions");
  wsi.getColumn(1).width = 22;
  wsi.getColumn(2).width = 12;
  wsi.getColumn(3).width = 92;
  drawBanner(wsi, logoId, "Invoice Import — Instructions", 3);

  const body = (
    row: number,
    text: string,
    opts: { bold?: boolean; navy?: boolean; size?: number } = {}
  ) => {
    wsi.mergeCells(`A${row}:C${row}`);
    const cell = wsi.getCell(`A${row}`);
    cell.value = text;
    cell.font = {
      name: BODY_FONT,
      size: opts.size ?? 10,
      bold: opts.bold ?? false,
      color: { argb: opts.navy ? BRAND.navy : BRAND.slate },
    };
    cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
  };

  let r = 5;
  body(r++, "Fill in the Invoices tab — one row per invoice. Delete the example row before importing.");
  body(r++, "Required columns: Vendor, Invoice #, Invoice Date, Gross Amount.", { bold: true });
  r++; // spacer

  // Column reference table.
  const tableHeader = wsi.getRow(r++);
  ["Column", "Required", "Notes"].forEach((label, i) => {
    const cell = tableHeader.getCell(i + 1);
    cell.value = label;
    cell.font = { name: HEAD_FONT, size: 10, bold: true, color: { argb: BRAND.white } };
    cell.alignment = { vertical: "middle", horizontal: i === 2 ? "left" : "center" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND.navy } };
    cell.border = thin(BRAND.navyDark);
  });
  IMPORT_COLUMNS.forEach((c, idx) => {
    const row = wsi.getRow(r++);
    row.height = 26;
    const zebra = idx % 2 === 1 ? BRAND.grayBg : BRAND.white;
    const nameCell = row.getCell(1);
    nameCell.value = c.header;
    nameCell.font = { name: BODY_FONT, size: 10, bold: true, color: { argb: BRAND.black } };
    const reqCell = row.getCell(2);
    reqCell.value = c.required ? "Required" : "Optional";
    reqCell.font = {
      name: BODY_FONT,
      size: 10,
      bold: c.required,
      color: { argb: c.required ? BRAND.navy : BRAND.slateLight },
    };
    reqCell.alignment = { horizontal: "center" };
    const noteCell = row.getCell(3);
    noteCell.value = c.note;
    noteCell.font = { name: BODY_FONT, size: 10, color: { argb: BRAND.slate } };
    noteCell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    for (const ci of [1, 2, 3]) {
      const cell = row.getCell(ci);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: zebra } };
      cell.border = { bottom: { style: "thin", color: { argb: BRAND.border } } };
    }
  });

  r++; // spacer
  body(r++, "Important", { bold: true, navy: true, size: 12 });
  body(r++, "•  Imported invoices are created as DRAFTS (Pending Review).");
  body(r++, "•  A PDF must be attached to each invoice before it can be approved or added to a draw.");
  body(r++, "•  Vendor + Invoice # must be unique per deal — duplicates already on file are skipped.");
  body(r++, "•  Dollars use thousands separators with no decimals; dates use M/D/YYYY.");

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer).toString("base64");
}
