// =============================================================================
// Invoice mass-import — pure parse + validation (r1)
// =============================================================================
// No I/O, no SheetJS — the server action reads the workbook into plain row
// objects (keyed by our ImportColumnKey) and a validation context, then this
// module produces a per-row verdict. Pure ⇒ deterministic + unit-testable.
// =============================================================================

import type { ImportColumnKey } from "./template";

export type RawImportRow = Partial<Record<ImportColumnKey, unknown>>;

export interface ImportValidationContext {
  /** Lowercased vendor name → existing vendor id. */
  existingVendorIdByLowerName: Map<string, string>;
  /** Valid GL accounts (exact strings from cost_account_map). */
  validGlAccounts: Set<string>;
  /** Lowercased account description → GL account, for description-based GL
   *  matching when the cell isn't an exact code. */
  glAccountByDescription: Map<string, string>;
  /** Existing "vendorLower|invoiceLower" keys already on the deal. */
  existingInvoiceKeys: Set<string>;
}

export interface RowIssue {
  level: "error" | "warning" | "info";
  message: string;
}

export interface ValidatedImportRow {
  /** 1-based spreadsheet row number (header is row 1, first data row is 2). */
  rowNumber: number;
  vendorName: string;
  invoiceNumber: string;
  invoiceDateIso: string | null;
  grossAmount: number | null;
  periodStartIso: string | null;
  periodEndIso: string | null;
  dueDateIso: string | null;
  glAccount: string | null;
  eligibleAmount: number | null;
  notes: string | null;
  /** Whether the vendor will be matched to an existing record or created. */
  vendorDisposition: "matched" | "new" | null;
  issues: RowIssue[];
  /** Imports only when there are no errors and it isn't a duplicate. */
  willImport: boolean;
}

// ----- value parsers --------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, "0");

/** Excel serial date → ISO yyyy-mm-dd (UTC-based, deterministic). 25569 =
 *  Excel serial for 1970-01-01. Valid for all post-1900-03-01 dates. */
function serialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial <= 0) return null;
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Coerce a cell into ISO yyyy-mm-dd. Handles Excel serials, Date objects, and
 *  the common text forms (yyyy-mm-dd, m/d/yyyy). Returns null if unparseable. */
export function toIsoDate(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  if (typeof value === "number") return serialToIso(value);
  const s = String(value).trim();
  if (!s) return null;
  // yyyy-mm-dd (allow a trailing time component)
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) {
    const y = +m[1], mo = +m[2], d = +m[3];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${y}-${pad(mo)}-${pad(d)}`;
    return null;
  }
  // m/d/yyyy or m/d/yy
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
  if (m) {
    const mo = +m[1], d = +m[2];
    let y = +m[3];
    if (y < 100) y += 2000;
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${y}-${pad(mo)}-${pad(d)}`;
    return null;
  }
  return null;
}

/** Parse a currency/number cell. Strips $, commas, spaces; (x) ⇒ negative. */
export function parseAmount(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  let s = String(value).trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[$,\s]/g, "");
  if (s.startsWith("-")) {
    neg = true;
    s = s.slice(1);
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

const str = (v: unknown): string => (v == null ? "" : String(v).trim());
const isBlankRow = (r: RawImportRow): boolean =>
  Object.values(r).every((v) => v == null || String(v).trim() === "");

// ----- row validation -------------------------------------------------------

export function validateImportRows(
  rawRows: RawImportRow[],
  ctx: ImportValidationContext,
  /** 1-based spreadsheet row of the FIRST data row, for accurate messaging.
   *  Defaults to 2 (header on row 1, data starts row 2). The importer passes
   *  the real value so a branded template with a logo band above the headers
   *  still reports the correct row numbers. */
  firstDataRow = 2,
  /** Keep fully-empty rows in the output (validated as errors) instead of
   *  dropping them. The in-screen editor uses this so the returned rows stay
   *  index-aligned with the editable rows it submitted. */
  keepEmptyRows = false
): ValidatedImportRow[] {
  const out: ValidatedImportRow[] = [];
  const seenInFile = new Set<string>();

  rawRows.forEach((raw, i) => {
    if (!keepEmptyRows && isBlankRow(raw)) return; // drop fully-empty rows silently
    const rowNumber = firstDataRow + i;
    const issues: RowIssue[] = [];

    const vendorName = str(raw.vendorName);
    const invoiceNumber = str(raw.invoiceNumber);
    const invoiceDateIso = toIsoDate(raw.invoiceDate);
    const grossAmount = parseAmount(raw.grossAmount);
    const periodStartIso = toIsoDate(raw.periodStart);
    const periodEndIso = toIsoDate(raw.periodEnd);
    const dueDateIso = toIsoDate(raw.dueDate);
    const glInput = str(raw.glAccount);
    const eligibleAmount = parseAmount(raw.eligibleAmount);
    const notes = str(raw.notes) || null;

    // ---- required fields ----
    if (!vendorName) issues.push({ level: "error", message: "Vendor is required" });
    if (!invoiceNumber) issues.push({ level: "error", message: "Invoice # is required" });
    if (!raw.invoiceDate) {
      issues.push({ level: "error", message: "Invoice Date is required" });
    } else if (!invoiceDateIso) {
      issues.push({ level: "error", message: `Invoice Date "${str(raw.invoiceDate)}" isn't a valid date` });
    }
    if (raw.grossAmount == null || String(raw.grossAmount).trim() === "") {
      issues.push({ level: "error", message: "Gross Amount is required" });
    } else if (grossAmount == null) {
      issues.push({ level: "error", message: `Gross Amount "${str(raw.grossAmount)}" isn't a number` });
    } else if (grossAmount === 0) {
      issues.push({ level: "error", message: "Gross Amount can't be zero" });
    } else if (grossAmount < 0) {
      issues.push({ level: "info", message: "Credit memo — negative amount" });
    }

    // ---- optional dates ----
    if (raw.periodStart && !periodStartIso) issues.push({ level: "warning", message: "Period Start isn't a valid date — ignored" });
    if (raw.periodEnd && !periodEndIso) issues.push({ level: "warning", message: "Period End isn't a valid date — ignored" });
    if (raw.dueDate && !dueDateIso) issues.push({ level: "warning", message: "Due Date isn't a valid date — ignored" });

    // ---- GL account (forgiving: resolve by code, then by description; an
    //      unrecognized code is a warning, not an error — the invoice still
    //      imports, just without a coded line) ----
    let glAccount: string | null = glInput || null;
    if (glInput) {
      if (ctx.validGlAccounts.has(glInput)) {
        // exact code — keep as-is
      } else {
        const byDesc = ctx.glAccountByDescription.get(glInput.toLowerCase());
        if (byDesc) {
          glAccount = byDesc;
          issues.push({ level: "info", message: `Matched GL by description → ${byDesc}` });
        } else {
          glAccount = null;
          issues.push({
            level: "warning",
            message: `GL Account "${glInput}" not found — imported without a coded line`,
          });
        }
      }
    }
    if (eligibleAmount != null && !glAccount) {
      issues.push({ level: "warning", message: "Eligible Amount ignored — no GL Account on this row" });
    }
    if (eligibleAmount != null && grossAmount != null && eligibleAmount > grossAmount) {
      issues.push({ level: "warning", message: "Eligible Amount exceeds Gross Amount" });
    }

    // ---- vendor disposition ----
    let vendorDisposition: "matched" | "new" | null = null;
    if (vendorName) {
      vendorDisposition = ctx.existingVendorIdByLowerName.has(vendorName.toLowerCase())
        ? "matched"
        : "new";
    }

    // ---- duplicate detection ----
    let isDuplicate = false;
    if (vendorName && invoiceNumber) {
      const key = `${vendorName.toLowerCase()}|${invoiceNumber.toLowerCase()}`;
      if (ctx.existingInvoiceKeys.has(key)) {
        issues.push({ level: "warning", message: "Already on file for this deal — skipped" });
        isDuplicate = true;
      } else if (seenInFile.has(key)) {
        issues.push({ level: "warning", message: "Duplicate of an earlier row in this file — skipped" });
        isDuplicate = true;
      } else {
        seenInFile.add(key);
      }
    }

    const hasError = issues.some((x) => x.level === "error");
    out.push({
      rowNumber,
      vendorName,
      invoiceNumber,
      invoiceDateIso,
      grossAmount,
      periodStartIso,
      periodEndIso,
      dueDateIso,
      glAccount,
      eligibleAmount,
      notes,
      vendorDisposition,
      issues,
      willImport: !hasError && !isDuplicate,
    });
  });

  return out;
}

export interface ImportSummary {
  total: number;
  willImport: number;
  errors: number;
  duplicates: number;
  newVendors: number;
  /** Rows that import but without a coded line (GL blank or unrecognized). */
  importedWithoutLine: number;
}

export function summarize(rows: ValidatedImportRow[]): ImportSummary {
  let willImport = 0;
  let errors = 0;
  let duplicates = 0;
  let importedWithoutLine = 0;
  const newVendorNames = new Set<string>();
  for (const r of rows) {
    if (r.willImport) willImport++;
    if (r.issues.some((x) => x.level === "error")) errors++;
    if (r.issues.some((x) => x.message.includes("skipped"))) duplicates++;
    if (r.willImport && !r.glAccount) importedWithoutLine++;
    if (r.willImport && r.vendorDisposition === "new") {
      newVendorNames.add(r.vendorName.toLowerCase());
    }
  }
  return {
    total: rows.length,
    willImport,
    errors,
    duplicates,
    newVendors: newVendorNames.size,
    importedWithoutLine,
  };
}

// ----- in-screen editing ----------------------------------------------------
// A serializable, all-strings view of one import row. The import UI seeds these
// from the uploaded workbook so a row that failed validation can be corrected
// in place (no re-upload) and re-checked / committed from the edited values.

export interface EditableImportRow {
  /** Stable key for React + matching validation results back to the editor. */
  clientId: string;
  /** Original spreadsheet row number, preserved for display through edits. */
  sourceRow: number;
  vendorName: string;
  invoiceNumber: string;
  invoiceDate: string;
  grossAmount: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  glAccount: string;
  eligibleAmount: string;
  notes: string;
}

/** Date cell → editable text: normalize anything parseable to ISO (clean for a
 *  <input type="date">); keep the raw text otherwise so the user sees what was
 *  wrong. */
function dateToEditable(v: unknown): string {
  return toIsoDate(v) ?? (v == null ? "" : String(v).trim());
}

/** Amount cell → editable text. */
function amountToEditable(v: unknown): string {
  if (v == null || v === "") return "";
  return typeof v === "number" ? String(v) : String(v).trim();
}

const cellToText = (v: unknown): string => (v == null ? "" : String(v).trim());

/** Build an editable row from a parsed raw row + its spreadsheet row number. */
export function rawToEditable(
  raw: RawImportRow,
  sourceRow: number,
  clientId: string
): EditableImportRow {
  return {
    clientId,
    sourceRow,
    vendorName: cellToText(raw.vendorName),
    invoiceNumber: cellToText(raw.invoiceNumber),
    invoiceDate: dateToEditable(raw.invoiceDate),
    grossAmount: amountToEditable(raw.grossAmount),
    periodStart: dateToEditable(raw.periodStart),
    periodEnd: dateToEditable(raw.periodEnd),
    dueDate: dateToEditable(raw.dueDate),
    glAccount: cellToText(raw.glAccount),
    eligibleAmount: amountToEditable(raw.eligibleAmount),
    notes: cellToText(raw.notes),
  };
}

/** Editable row → raw row for re-validation/commit (validators accept strings). */
export function editableToRaw(e: EditableImportRow): RawImportRow {
  return {
    vendorName: e.vendorName,
    invoiceNumber: e.invoiceNumber,
    invoiceDate: e.invoiceDate,
    grossAmount: e.grossAmount,
    periodStart: e.periodStart,
    periodEnd: e.periodEnd,
    dueDate: e.dueDate,
    glAccount: e.glAccount,
    eligibleAmount: e.eligibleAmount,
    notes: e.notes,
  };
}
