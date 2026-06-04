// =============================================================================
// Branded PDF letterhead helper (server-side only)
// =============================================================================
// Loads `public/brand/nurock-letterhead.pdf` once and embeds it as a page
// background. Consumers (draw cover letter, G702/G703, cost-cert workbook, etc.)
// call `createBrandedPdf()` to get a document with the letterhead applied, then
// draw their content within the SAFE_AREA bounds (well clear of the top swoosh
// + NR monogram and the bottom swoosh + address block).
//
// Letterhead artwork (Letter, 612 × 792 pt):
//   • Top band ~110pt: tan swoosh + navy NR monogram + NUROCK wordmark
//   • Bottom band ~110pt: tan swoosh + address block
//     800 North Point Parkway · Suite 125 · Alpharetta, GA 30005
//     (678) 297-3400 · www.nurock.com
//   • Faint centered NR watermark (does not interfere with body content)
//
// Fonts: we ship with `StandardFonts.Helvetica` (Inter-like) as the body face
// and `StandardFonts.HelveticaBold` for headings — these are built in to
// pdf-lib so the bundle stays slim. To upgrade to true Inter + Oswald later,
// drop the TTFs in `public/brand/fonts/` and swap the embedFont calls.
// =============================================================================

import fs from "node:fs";
import path from "node:path";
import {
  PDFDocument,
  PDFEmbeddedPage,
  PDFFont,
  PDFPage,
  StandardFonts,
  rgb,
} from "pdf-lib";

// -----------------------------------------------------------------------------
// Geometry — content-area safe bounds
// -----------------------------------------------------------------------------
export const LETTERHEAD = {
  pageWidth: 612,
  pageHeight: 792,
  marginLeft: 72,
  marginRight: 72,
  /** Top of the safe content area (below the NR monogram + horizontal rule). */
  contentTop: 660,
  /** Bottom of the safe content area (above the address block + tan swoosh). */
  contentBottom: 130,
  /** Usable width between L/R margins. */
  contentWidth: 612 - 72 - 72, // 468
} as const;

// -----------------------------------------------------------------------------
// Brand palette — pdf-lib rgb() form of the BRAND tokens in design-tokens.ts
// -----------------------------------------------------------------------------
export const PDF_COLORS = {
  navy: rgb(0.086, 0.272, 0.463), // #164576
  navyDark: rgb(0.059, 0.208, 0.337), // #0F3557
  navyLight: rgb(0.118, 0.353, 0.580), // #1E5A94
  tan: rgb(0.706, 0.682, 0.573), // #B4AE92
  tanDark: rgb(0.561, 0.541, 0.435), // #8F8A6F
  black: rgb(0.063, 0.094, 0.157), // #101828
  slate: rgb(0.279, 0.329, 0.404), // #475467
  slateLight: rgb(0.4, 0.439, 0.522), // #667085
  borderGray: rgb(0.894, 0.906, 0.925), // #E4E7EC
  white: rgb(1, 1, 1),
  // Status tones
  okSoft: rgb(0.82, 0.98, 0.9),
  warnSoft: rgb(0.996, 0.953, 0.78),
  badSoft: rgb(0.996, 0.894, 0.886),
} as const;

// -----------------------------------------------------------------------------
// Letterhead loader — cached for the process lifetime
// -----------------------------------------------------------------------------
let cachedLetterheadBytes: Uint8Array | null = null;

function loadLetterheadBytes(): Uint8Array {
  if (cachedLetterheadBytes) return cachedLetterheadBytes;
  // Resolve from the running process's cwd — Vercel server runtimes preserve
  // the `public/` tree at the project root.
  const filePath = path.join(
    process.cwd(),
    "public",
    "brand",
    "nurock-letterhead.pdf"
  );
  cachedLetterheadBytes = fs.readFileSync(filePath);
  return cachedLetterheadBytes;
}

// -----------------------------------------------------------------------------
// PDFDocument factory — returns an empty doc with the letterhead pre-embedded
// -----------------------------------------------------------------------------
export interface BrandedPdf {
  doc: PDFDocument;
  /** Embedded letterhead — draw on every new page as background. */
  letterhead: PDFEmbeddedPage;
  /** Body font (Helvetica). Sub for Inter once brand fonts are embedded. */
  font: PDFFont;
  /** Bold variant (HelveticaBold). Sub for Oswald once brand fonts are embedded. */
  fontBold: PDFFont;
  /** Add a new page with the letterhead background. */
  addPage: () => PDFPage;
}

/**
 * Create a new branded PDF. Returns the doc + helpers; consumers then draw
 * content with the bundled fonts and `PDF_COLORS`, staying within
 * `LETTERHEAD.contentTop` / `LETTERHEAD.contentBottom`.
 */
export async function createBrandedPdf(): Promise<BrandedPdf> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const letterheadBytes = loadLetterheadBytes();
  const letterheadDoc = await PDFDocument.load(letterheadBytes);
  const [letterhead] = await doc.embedPages([letterheadDoc.getPage(0)]);

  doc.setProducer("NuRock Development Platform");
  doc.setCreator("NuRock Development Platform");
  doc.setCreationDate(new Date());

  const addPage = (): PDFPage => {
    const page = doc.addPage([LETTERHEAD.pageWidth, LETTERHEAD.pageHeight]);
    page.drawPage(letterhead, {
      x: 0,
      y: 0,
      width: LETTERHEAD.pageWidth,
      height: LETTERHEAD.pageHeight,
    });
    return page;
  };

  return { doc, letterhead, font, fontBold, addPage };
}

// -----------------------------------------------------------------------------
// Text helpers — small, opinionated wrappers around page.drawText so consumers
// don't reinvent ascii sanitization, wrapping, or alignment math.
// -----------------------------------------------------------------------------

/**
 * Strip non-ASCII glyphs — StandardFonts (WinAnsi) can't render em/en dashes,
 * smart quotes, etc. Convert the common ones; drop the rest.
 */
export function ascii(s: string): string {
  return s
    .replace(/[—–]/g, "-") // em dash, en dash
    .replace(/[‘’]/g, "'") // smart quotes
    .replace(/[“”]/g, '"') // smart double quotes
    .replace(/•/g, "*") // bullet
    .replace(/ /g, " ") // nbsp
    .replace(/[^\x20-\x7E\n]/g, "");
}

export interface TextOptions {
  x: number;
  y: number;
  size?: number;
  font?: PDFFont;
  color?: ReturnType<typeof rgb>;
}

/** Plain single-line text. Returns the width drawn (for chaining). */
export function drawText(
  page: PDFPage,
  text: string,
  brand: BrandedPdf,
  opts: TextOptions
): number {
  const size = opts.size ?? 10;
  const font = opts.font ?? brand.font;
  const t = ascii(text);
  page.drawText(t, {
    x: opts.x,
    y: opts.y,
    size,
    font,
    color: opts.color ?? PDF_COLORS.black,
  });
  return font.widthOfTextAtSize(t, size);
}

/** H1 — navy 18pt bold, returns next-y (10pt below baseline). */
export function drawHeading(
  page: PDFPage,
  text: string,
  brand: BrandedPdf,
  opts: { x: number; y: number; color?: ReturnType<typeof rgb> }
): number {
  page.drawText(ascii(text), {
    x: opts.x,
    y: opts.y,
    size: 18,
    font: brand.fontBold,
    color: opts.color ?? PDF_COLORS.navy,
  });
  return opts.y - 22;
}

/** H2 — navy 12pt bold, returns next-y. */
export function drawSubheading(
  page: PDFPage,
  text: string,
  brand: BrandedPdf,
  opts: { x: number; y: number; color?: ReturnType<typeof rgb> }
): number {
  page.drawText(ascii(text), {
    x: opts.x,
    y: opts.y,
    size: 12,
    font: brand.fontBold,
    color: opts.color ?? PDF_COLORS.navy,
  });
  return opts.y - 16;
}

/**
 * Right-aligned text — useful for currency cells and the upper-right "date"
 * stamp on letters.
 */
export function drawTextRight(
  page: PDFPage,
  text: string,
  brand: BrandedPdf,
  opts: { rightX: number; y: number; size?: number; font?: PDFFont; color?: ReturnType<typeof rgb> }
): void {
  const size = opts.size ?? 10;
  const font = opts.font ?? brand.font;
  const t = ascii(text);
  const w = font.widthOfTextAtSize(t, size);
  page.drawText(t, {
    x: opts.rightX - w,
    y: opts.y,
    size,
    font,
    color: opts.color ?? PDF_COLORS.black,
  });
}

/**
 * Wrap `text` to fit inside `width` and draw line-by-line at `(x, y)`.
 * Returns the next-available y (below the last drawn line). Honors `\n`
 * as a hard break.
 */
export function drawWrappedText(
  page: PDFPage,
  text: string,
  brand: BrandedPdf,
  opts: {
    x: number;
    y: number;
    width: number;
    size?: number;
    lineHeight?: number;
    font?: PDFFont;
    color?: ReturnType<typeof rgb>;
  }
): number {
  const size = opts.size ?? 10;
  const lineHeight = opts.lineHeight ?? size * 1.45;
  const font = opts.font ?? brand.font;
  const color = opts.color ?? PDF_COLORS.black;
  const paragraphs = ascii(text).split(/\n/);

  let y = opts.y;
  for (const para of paragraphs) {
    if (para.trim() === "") {
      y -= lineHeight;
      continue;
    }
    const words = para.split(/\s+/);
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      const w = font.widthOfTextAtSize(candidate, size);
      if (w > opts.width && line) {
        page.drawText(line, { x: opts.x, y, size, font, color });
        y -= lineHeight;
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) {
      page.drawText(line, { x: opts.x, y, size, font, color });
      y -= lineHeight;
    }
  }
  return y;
}

// -----------------------------------------------------------------------------
// Cover-letter convenience builder
// -----------------------------------------------------------------------------
// The user's draw-submission cover letter has these deal-linked fields:
//   • Date
//   • Recipient block (lender contact, org, address)
//   • Re: line — "[Deal Name] – Draw #N (Period: <start> – <end>)"
//   • Salutation
//   • Body paragraphs (boilerplate + amount + sources summary)
//   • Signature block (sender name + title + contact)
// We expose a small data-shape so Phase 3's draw-package generator can drop in
// a fully branded cover page without hand-rolling all the layout math.
// -----------------------------------------------------------------------------

export interface CoverLetterRecipient {
  /** Contact name, e.g. "Jane Doe, VP" */
  name: string;
  /** Org / lender, e.g. "Bank of the South" */
  organization?: string;
  /** Multi-line address — split with `\n`. */
  address?: string;
}

export interface CoverLetterSignature {
  /** Sender name, e.g. "Michael Wilson" */
  name: string;
  /** Title, e.g. "Chief Financial Officer" */
  title?: string;
  /** Optional contact line, e.g. "michael@nurock.com · (678) 297-3400" */
  contact?: string;
}

export interface CoverLetterInput {
  /** ISO or human-formatted date. Defaults to today. */
  date?: string;
  recipient: CoverLetterRecipient;
  /** Re-line subject. Typically `"<Deal Name> — Draw #N"`. */
  subject: string;
  /** Salutation (excluding comma). Defaults to "Dear <recipient.name>". */
  salutation?: string;
  /** Body paragraphs (rendered with blank-line separation). */
  body: string[];
  signature: CoverLetterSignature;
}

/**
 * Render a fully branded cover letter onto a new branded page. Designed to be
 * page 1 of a multi-page packet (Phase 3 draw package, etc.). Returns the
 * page for further drawing if needed; the caller typically just discards.
 */
export function drawCoverLetter(brand: BrandedPdf, input: CoverLetterInput): PDFPage {
  const page = brand.addPage();
  const leftX = LETTERHEAD.marginLeft;
  const rightX = LETTERHEAD.pageWidth - LETTERHEAD.marginRight;
  // Explicit `: number` so `as const` literal types don't propagate through y.
  let y: number = LETTERHEAD.contentTop;

  // Date — right-aligned
  const dateStr =
    input.date ??
    new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  drawTextRight(page, dateStr, brand, {
    rightX,
    y,
    size: 10,
    color: PDF_COLORS.slate,
  });
  y -= 32;

  // Recipient block
  drawText(page, input.recipient.name, brand, {
    x: leftX,
    y,
    size: 10,
    font: brand.fontBold,
    color: PDF_COLORS.black,
  });
  y -= 14;
  if (input.recipient.organization) {
    drawText(page, input.recipient.organization, brand, {
      x: leftX,
      y,
      size: 10,
      color: PDF_COLORS.black,
    });
    y -= 14;
  }
  if (input.recipient.address) {
    y = drawWrappedText(page, input.recipient.address, brand, {
      x: leftX,
      y,
      width: LETTERHEAD.contentWidth,
      size: 10,
      color: PDF_COLORS.black,
    });
  }
  y -= 10;

  // Re: subject — small caps prefix + bold subject
  drawText(page, "RE:", brand, {
    x: leftX,
    y,
    size: 9,
    font: brand.fontBold,
    color: PDF_COLORS.slate,
  });
  drawText(page, input.subject, brand, {
    x: leftX + 26,
    y,
    size: 10,
    font: brand.fontBold,
    color: PDF_COLORS.navy,
  });
  y -= 22;

  // Salutation
  const salutation = input.salutation ?? `Dear ${input.recipient.name}`;
  drawText(page, `${salutation},`, brand, {
    x: leftX,
    y,
    size: 10,
    color: PDF_COLORS.black,
  });
  y -= 18;

  // Body paragraphs
  for (const para of input.body) {
    y = drawWrappedText(page, para, brand, {
      x: leftX,
      y,
      width: LETTERHEAD.contentWidth,
      size: 10,
      color: PDF_COLORS.black,
    });
    y -= 8; // paragraph gap
    if (y < LETTERHEAD.contentBottom + 90) break; // out of room; signature block needs ~80pt
  }

  // Signature block — close at least 60pt above the address swoosh
  y = Math.max(y, LETTERHEAD.contentBottom + 80);
  drawText(page, "Sincerely,", brand, {
    x: leftX,
    y,
    size: 10,
    color: PDF_COLORS.black,
  });
  y -= 44; // visible signature line gap
  drawText(page, input.signature.name, brand, {
    x: leftX,
    y,
    size: 10,
    font: brand.fontBold,
    color: PDF_COLORS.black,
  });
  y -= 13;
  if (input.signature.title) {
    drawText(page, input.signature.title, brand, {
      x: leftX,
      y,
      size: 9,
      color: PDF_COLORS.slate,
    });
    y -= 12;
  }
  if (input.signature.contact) {
    drawText(page, input.signature.contact, brand, {
      x: leftX,
      y,
      size: 9,
      color: PDF_COLORS.slate,
    });
  }

  return page;
}
