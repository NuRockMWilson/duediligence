import ExcelJS from "exceljs";
import path from "path";
import { promises as fs } from "fs";

// =============================================================================
// FHFC FCC workbook populator
// =============================================================================
// Loads the blank FHFC HC Development Final Cost Certification template and
// fills in the cells that the app has data for. Everything else (lender info,
// syndication rate, adjuster factors, RFA details, etc.) stays blank for the
// user to fill in Excel after download.
//
// Populates Input Data sheet (deal-level cells + building rows) and Invoice
// Listing sheet (one row per dm_draw_lines record with GL classification +
// eligible/ineligible split). The template's downstream formulas in COSTS /
// APPLIC. FRACT. / QUAL. CALC / CREDIT CALC. / EXHIBIT A-C / CERTIFY then
// auto-calculate when the user opens the file in Excel.
//
// Cell map for Input Data (derived from the Foxcroft workbook structure):
//   C7   Property Name              ← deal.name
//   C8   State                       ← parsed from first building's address
//   C11  Basis Boost? (Yes/No)       ← dm_deal_lihtc_config.basis_boost_pct > 0
//   C20  Number of Buildings         ← dm_buildings count
//   C22  Development Address         ← first building's address
//   C23  Development City, State     ← parsed from first building's address
//   C24  Development Zip Code        ← parsed from first building's address
//   H6+  Building rows (BIN, Address, TCO Date, Final CO Date, LI Units,
//        LI Sq Ft, Market Units, Market Sq Ft) — one row per building
//
// Cell map for Invoice Listing (one row per draw line, starting at row 2):
//   A  Draw Number          ← dm_draws.draw_number
//   B  Line Item             ← dm_draw_schedule_lines.item_number
//   D  Vendor                ← dm_invoices.vendor_name
//   E  Invoice Date          ← dm_invoices.invoice_date
//   F  Invoice Number        ← dm_invoices.invoice_number
//   G  Description           ← dm_draw_lines.description
//   H  Amount (gross)        ← dm_draw_lines.gross_amount
//   R  Sage Account Number   ← dm_draw_lines.gl_account
//   S  Ineligible Basis      ← computed: gross × (1 - eligible_pct/100)
// (Columns C, I-P, T, U, W, X are workbook formulas — left intact via the
// template; we don't write to them.)
// =============================================================================

export interface Building {
  building_number: number;
  bin: string | null;
  building_name: string | null;
  address: string | null;
  unit_count: number;
  square_footage: number | null;
  placed_in_service_date: string | null;
}

export interface LihtcConfig {
  applicable_percentage_pct: number | null;
  basis_boost_pct: number;
  lihtc_unit_count: number | null;
  total_unit_count: number | null;
  state_credits_applicable: boolean;
}

// One row in the Invoice Listing sheet. Pre-computed by the API route from
// the dm_draw_lines / dm_invoices / dm_draws / dm_draw_schedule_lines chain
// plus the eligibility resolution against gl_to_format_line (NuRock Standard)
// + dm_eligible_basis_overrides.
export interface InvoiceListingRow {
  drawNumber: number | null;
  lineItem: number | null;
  vendor: string | null;
  invoiceDate: string | null; // ISO date
  invoiceNumber: string | null;
  description: string | null;
  grossAmount: number;
  glAccount: string;
  ineligibleAmount: number;
}

export interface FhfcMortgage {
  lender: string;
  amount: number;
}

export interface PopulateInput {
  dealName: string;
  config: LihtcConfig | null;
  buildings: Building[];
  invoiceRows: InvoiceListingRow[];
  // ---- Deal-level autofill (Ship — deepen FHFC) -----------------------------
  // All map to confirmed input cells (not formulas) per the template's defined
  // names. Optional so older callers still work.
  entityName?: string | null; // C6  PartnershipName
  /** Fallback location when buildings carry no address (C8/C22/C23/C24). */
  fallbackAddress?: string | null;
  fallbackCity?: string | null;
  fallbackState?: string | null;
  fallbackZip?: string | null;
  closingDate?: string | null; // C21 ClosingDate
  firstCreditYear?: number | null; // C31 FirstCreditYear
  /** Permanent debt stack, senior-first → First/Second/Third/Other mortgage. */
  mortgages?: FhfcMortgage[];
}

const TEMPLATE_PATH = path.join(
  process.cwd(),
  "public",
  "templates",
  "fhfc-fcc-template.xlsx"
);

/**
 * Loads the blank FHFC FCC template, populates Input Data with the supplied
 * deal info + buildings, and returns the resulting workbook buffer. The
 * template's formulas (COSTS / APPLIC. FRACT. / QUAL. CALC / CREDIT CALC. /
 * EXHIBIT A-C / CERTIFY) recalculate from these inputs automatically when
 * the user opens the file in Excel.
 *
 * Returns a plain ArrayBuffer so the API route can pass it directly to `new
 * Response(...)`. Buffer/Uint8Array carry an `<ArrayBufferLike>` generic in
 * TypeScript 5.7+ which doesn't satisfy the BodyInit type — ArrayBuffer is
 * unambiguously accepted.
 */
export async function populateFhfcWorkbook(
  input: PopulateInput
): Promise<ArrayBuffer> {
  const templateBuffer = await fs.readFile(TEMPLATE_PATH);

  const workbook = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await workbook.xlsx.load(templateBuffer as any);

  const inputData = workbook.getWorksheet("Input Data");
  if (!inputData) {
    throw new Error("Template missing 'Input Data' sheet");
  }

  // ---- Deal-level cells -----------------------------------------------------
  inputData.getCell("C7").value = input.dealName; // PropertyName
  if (input.entityName) inputData.getCell("C6").value = input.entityName; // PartnershipName

  // State / city / zip parsed from the first building's address (if present),
  // else fall back to the UW model's location fields.
  const primaryBuilding = input.buildings[0];
  if (primaryBuilding?.address) {
    inputData.getCell("C22").value = primaryBuilding.address;
    const parsed = parseAddress(primaryBuilding.address);
    if (parsed.state) inputData.getCell("C8").value = parsed.state;
    if (parsed.cityStateZip) inputData.getCell("C23").value = parsed.cityStateZip;
    if (parsed.zip) inputData.getCell("C24").value = parsed.zip;
  } else {
    if (input.fallbackAddress) inputData.getCell("C22").value = input.fallbackAddress;
    if (input.fallbackState) inputData.getCell("C8").value = input.fallbackState;
    const cityState = [input.fallbackCity, input.fallbackState]
      .filter(Boolean)
      .join(", ");
    if (cityState) inputData.getCell("C23").value = cityState;
    if (input.fallbackZip) inputData.getCell("C24").value = input.fallbackZip;
  }

  inputData.getCell("C11").value =
    (input.config?.basis_boost_pct ?? 0) > 0 ? "Yes" : "No"; // QCT/DDA basis boost
  inputData.getCell("C20").value = input.buildings.length; // TotalBuildings

  // Closing date (C21) + first credit year (C31).
  if (input.closingDate) {
    const d = new Date(input.closingDate);
    if (!Number.isNaN(d.getTime())) inputData.getCell("C21").value = d;
  }
  if (input.firstCreditYear) inputData.getCell("C31").value = input.firstCreditYear;

  // Permanent debt stack → First / Second / Third / Other mortgage.
  // Lender + amount only (rate/term/DS stay blank for the user). Cells are
  // confirmed input (non-formula) per the template's defined names:
  //   First:  F26 lender, F30 amount   Second: F37 lender, F41 amount
  //   Third:  F48 lender, F52 amount   Other:  F59 lender, F63 amount
  const mortgageCells: { lender: string; amount: string }[] = [
    { lender: "F26", amount: "F30" },
    { lender: "F37", amount: "F41" },
    { lender: "F48", amount: "F52" },
    { lender: "F59", amount: "F63" },
  ];
  (input.mortgages ?? []).slice(0, 4).forEach((m, i) => {
    const cell = mortgageCells[i];
    if (!cell) return;
    if (m.lender) inputData.getCell(cell.lender).value = m.lender;
    if (m.amount) inputData.getCell(cell.amount).value = m.amount;
  });

  // ---- Building rows (H6:O105) ----------------------------------------------
  // H = BIN, I = Address, J = TCO Date, K = Final CO Date, L = LI Units,
  // M = LI Sq Ft, N = Market Units, O = Market Sq Ft. (P and Q are sum
  // formulas — leave alone.)
  const totalUnits = input.config?.total_unit_count ?? 0;
  const lihtcUnits = input.config?.lihtc_unit_count ?? totalUnits;
  const lihtcFraction =
    totalUnits > 0 ? Math.min(1, lihtcUnits / totalUnits) : 1;

  input.buildings.forEach((b, i) => {
    const row = 6 + i;
    if (row > 105) return; // template caps at 100 building rows

    inputData.getCell(`H${row}`).value = b.bin ?? "";
    inputData.getCell(`I${row}`).value = b.address ?? "";
    if (b.placed_in_service_date) {
      inputData.getCell(`J${row}`).value = new Date(
        b.placed_in_service_date
      );
    }
    // K (Final CO Date) — not tracked in the app yet; left blank.

    // Split units / sqft by the deal's LIHTC fraction. For 100% LIHTC deals
    // (Foxcroft), fraction = 1 → all units land in LI columns.
    const liUnits = Math.round((b.unit_count ?? 0) * lihtcFraction);
    const marketUnits = (b.unit_count ?? 0) - liUnits;
    const sqft = b.square_footage ?? 0;
    const liSqft = Math.round(sqft * lihtcFraction);
    const marketSqft = sqft - liSqft;

    inputData.getCell(`L${row}`).value = liUnits;
    if (sqft > 0) inputData.getCell(`M${row}`).value = liSqft;
    inputData.getCell(`N${row}`).value = marketUnits;
    if (sqft > 0) inputData.getCell(`O${row}`).value = marketSqft;
  });

  // ---- Invoice Listing -------------------------------------------------------
  const invoiceListing = workbook.getWorksheet("Invoice Listing");
  if (invoiceListing) {
    populateInvoiceListing(invoiceListing, input.invoiceRows);
  }

  // ---- Write workbook -------------------------------------------------------
  const buf = await workbook.xlsx.writeBuffer();
  // ExcelJS returns ArrayBuffer (browser) or Buffer (Node). Normalize to a
  // plain ArrayBuffer; .slice() on an ArrayBuffer always returns ArrayBuffer
  // (concrete, not ArrayBufferLike), which satisfies BodyInit.
  if (buf instanceof ArrayBuffer) return buf;
  const u8 = buf as Uint8Array;
  return (u8.buffer as ArrayBuffer).slice(
    u8.byteOffset,
    u8.byteOffset + u8.byteLength
  );
}

/**
 * Best-effort parser for a free-form address string. Handles common formats:
 *   "123 Main St, Miramar, FL 33023"
 *   "123 Main St, Miramar, FL"
 *   "Miramar, FL 33023"
 * Returns whichever components it could pull out.
 */
function parseAddress(addr: string): {
  state: string | null;
  cityStateZip: string | null;
  zip: string | null;
} {
  const parts = addr.split(",").map((p) => p.trim()).filter(Boolean);
  // Last segment usually contains "STATE ZIP" or "STATE"
  const last = parts[parts.length - 1] ?? "";
  const stateZipMatch = last.match(/^([A-Z]{2})\s*(\d{5}(?:-\d{4})?)?$/i);

  let state: string | null = null;
  let zip: string | null = null;
  if (stateZipMatch) {
    state = stateZipMatch[1].toUpperCase();
    zip = stateZipMatch[2] ?? null;
  }

  // Build "City, State Zip" from segments 1+
  const cityStateZip =
    parts.length >= 2 ? parts.slice(1).join(", ") : null;

  return { state, cityStateZip, zip };
}

/**
 * Writes invoice rows into the Invoice Listing sheet starting at row 2.
 * The blank template has row 1 as the header and no data rows below — we
 * populate sequentially. Columns C, I-P, T, U, W, X are workbook formulas
 * (line description VLOOKUP, funding source distribution, eligible-basis
 * subtraction, DFCC/10% test mapping lookups) — we don't write to them.
 */
function populateInvoiceListing(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sheet: any,
  rows: InvoiceListingRow[]
): void {
  rows.forEach((r, i) => {
    const row = 2 + i;
    if (r.drawNumber !== null) sheet.getCell(`A${row}`).value = r.drawNumber;
    if (r.lineItem !== null) sheet.getCell(`B${row}`).value = r.lineItem;
    if (r.vendor) sheet.getCell(`D${row}`).value = r.vendor;
    if (r.invoiceDate) {
      sheet.getCell(`E${row}`).value = new Date(r.invoiceDate);
      sheet.getCell(`E${row}`).numFmt = "m/d/yyyy";
    }
    if (r.invoiceNumber) sheet.getCell(`F${row}`).value = r.invoiceNumber;
    if (r.description) sheet.getCell(`G${row}`).value = r.description;
    sheet.getCell(`H${row}`).value = r.grossAmount;
    sheet.getCell(`H${row}`).numFmt = "#,##0.00";
    sheet.getCell(`R${row}`).value = r.glAccount;
    if (r.ineligibleAmount > 0) {
      sheet.getCell(`S${row}`).value = r.ineligibleAmount;
      sheet.getCell(`S${row}`).numFmt = "#,##0.00";
    }
  });
}
