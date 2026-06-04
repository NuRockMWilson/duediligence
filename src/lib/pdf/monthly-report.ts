// =============================================================================
// Monthly Development Report — branded PDF (Phase 7 r2)
// =============================================================================
// The CFO / investor / lender monthly deliverable. One branded page (spilling
// to a second when the draw history is long) summarizing a deal's status:
// snapshot, key metrics, sources & uses, schedule + pace, contingency, and
// funded-draw history. Built on the shared letterhead helper.
//
// Server-side only (reads the letterhead PDF off disk via createBrandedPdf).
// Consumed by the dashboard's exportMonthlyReport server action.
// =============================================================================

import {
  createBrandedPdf,
  drawText,
  drawTextRight,
  drawSubheading,
  PDF_COLORS,
  LETTERHEAD,
  type BrandedPdf,
} from "./letterhead";
import type { DashboardData } from "@/lib/data/dashboard-rollup";
import type { PDFPage } from "pdf-lib";

export interface MonthlyReportDraw {
  drawNumber: number | null;
  periodLabel: string;
  status: string;
  amount: number;
  fundedOrSubmitted: string; // formatted date
}

export interface MonthlyReportRetainageVendor {
  name: string;
  withheld: number;
  released: number;
  outstanding: number;
}

export interface MonthlyReportRetainage {
  vendors: MonthlyReportRetainageVendor[];
  withheld: number;
  released: number;
  outstanding: number;
}

export interface MonthlyReportInput {
  data: DashboardData;
  draws: MonthlyReportDraw[];
  /** "As of" date for the report header (formatted). */
  asOf: string;
  /** Optional per-vendor retainage schedule (Retainage module). */
  retainage?: MonthlyReportRetainage;
}

const LEFT = LETTERHEAD.marginLeft;
const RIGHT = LETTERHEAD.pageWidth - LETTERHEAD.marginRight;
const WIDTH = LETTERHEAD.contentWidth;

function usd(n: number): string {
  const neg = n < 0;
  const s = `$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
  return neg ? `(${s})` : s;
}

function pct(n: number): string {
  return `${n.toFixed(1)}%`;
}

// A drawing cursor that auto-paginates: when y drops below the safe bottom,
// it starts a fresh branded page and resets to the top of the content area.
class Cursor {
  page: PDFPage;
  y: number;
  constructor(private brand: BrandedPdf) {
    this.page = brand.addPage();
    this.y = LETTERHEAD.contentTop;
  }
  ensure(space: number) {
    if (this.y - space < LETTERHEAD.contentBottom) {
      this.page = this.brand.addPage();
      this.y = LETTERHEAD.contentTop;
    }
  }
  gap(n: number) {
    this.y -= n;
  }
}

/** Section header with a hairline rule under it. */
function section(cur: Cursor, brand: BrandedPdf, title: string) {
  cur.ensure(40);
  cur.y = drawSubheading(cur.page, title, brand, { x: LEFT, y: cur.y });
  cur.page.drawLine({
    start: { x: LEFT, y: cur.y + 4 },
    end: { x: RIGHT, y: cur.y + 4 },
    thickness: 0.75,
    color: PDF_COLORS.borderGray,
  });
  cur.gap(12);
}

/** A two-column metric: label left (slate), value right (bold black). */
function metric(
  cur: Cursor,
  brand: BrandedPdf,
  label: string,
  value: string,
  valueColor = PDF_COLORS.black
) {
  cur.ensure(16);
  drawText(cur.page, label, brand, {
    x: LEFT,
    y: cur.y,
    size: 10,
    color: PDF_COLORS.slate,
  });
  drawTextRight(cur.page, value, brand, {
    rightX: RIGHT,
    y: cur.y,
    size: 10,
    font: brand.fontBold,
    color: valueColor,
  });
  cur.gap(16);
}

export async function generateMonthlyReportPdf(
  input: MonthlyReportInput
): Promise<Uint8Array> {
  const { data, draws, asOf } = input;
  const brand = await createBrandedPdf();
  const cur = new Cursor(brand);

  // ----- Title block -----
  drawText(cur.page, "MONTHLY DEVELOPMENT REPORT", brand, {
    x: LEFT,
    y: cur.y,
    size: 9,
    font: brand.fontBold,
    color: PDF_COLORS.tanDark,
  });
  cur.gap(18);
  drawText(cur.page, data.deal.name, brand, {
    x: LEFT,
    y: cur.y,
    size: 17,
    font: brand.fontBold,
    color: PDF_COLORS.navy,
  });
  drawTextRight(cur.page, `As of ${asOf}`, brand, {
    rightX: RIGHT,
    y: cur.y + 2,
    size: 9,
    color: PDF_COLORS.slate,
  });
  cur.gap(16);
  const loc = [data.deal.city, data.deal.county].filter((s) => s && s !== "—").join(", ");
  const sub = [
    loc,
    data.deal.units ? `${data.deal.units} units` : "",
    data.deal.structure && data.deal.structure !== "—" ? data.deal.structure : "",
  ]
    .filter(Boolean)
    .join("  ·  ");
  if (sub) {
    drawText(cur.page, sub, brand, { x: LEFT, y: cur.y, size: 10, color: PDF_COLORS.slate });
    cur.gap(14);
  }
  drawText(
    cur.page,
    `Construction month ${data.deal.constructionMonth} of ${data.deal.constructionTotalMonths}  ·  Active draw ${data.activeDrawNumber != null ? `#${data.activeDrawNumber}` : "none"}`,
    brand,
    { x: LEFT, y: cur.y, size: 9, color: PDF_COLORS.slateLight }
  );
  cur.gap(26);

  // ----- Key metrics -----
  section(cur, brand, "Key Metrics");
  const k = data.kpis;
  metric(cur, brand, "Total Development Cost", usd(k.totalProjectCost));
  metric(
    cur,
    brand,
    "Drawn to Date",
    `${usd(k.drawnToDate)}  (${pct(k.totalProjectCost > 0 ? (k.drawnToDate / k.totalProjectCost) * 100 : 0)} of TDC, ${k.drawCount} draw${k.drawCount === 1 ? "" : "s"})`
  );
  metric(cur, brand, "Hard Cost % Complete", pct(k.hardCostPctComplete));
  metric(
    cur,
    brand,
    "Retainage Held",
    `${usd(k.retainageHeld)}  (${pct(k.retainagePctOfHardCosts)} of hard costs drawn)`
  );
  metric(
    cur,
    brand,
    "Open Invoices",
    `${k.openInvoices}  (${usd(k.openInvoiceAmount)} pending)`
  );
  cur.gap(10);

  // ----- Sources & Uses -----
  section(cur, brand, "Sources & Uses");
  const grossSources = data.fundingSources.reduce((s, x) => s + x.total, 0);
  const totalUses = data.categoryVariance.reduce((s, x) => s + x.budget, 0);
  const gap = grossSources - totalUses;
  metric(cur, brand, "Committed Sources", usd(grossSources));
  metric(cur, brand, "Budgeted Uses", usd(totalUses));
  metric(
    cur,
    brand,
    "Balance",
    Math.abs(gap) < 1 ? "Balanced" : usd(gap),
    Math.abs(gap) < 1
      ? PDF_COLORS.navy
      : gap < 0
        ? PDF_COLORS.navyDark
        : PDF_COLORS.tanDark
  );
  cur.gap(10);

  // ----- Schedule -----
  section(cur, brand, "Schedule");
  metric(cur, brand, "Construction Complete", pct(data.scheduleProgress));
  if (data.scheduleVarianceLabel) {
    metric(
      cur,
      brand,
      "Draw Pace",
      data.scheduleVarianceLabel,
      data.scheduleVarianceTone === "warn" ? PDF_COLORS.tanDark : PDF_COLORS.navy
    );
  }
  // Next upcoming milestone (status === "active").
  const nextMs = data.scheduleMilestones.find((m) => m.status === "active");
  if (nextMs) {
    metric(cur, brand, `Next: ${nextMs.label}`, fmtMonthYear(nextMs.date));
  }
  cur.gap(10);

  // ----- Contingency -----
  if (data.contingencyLines.length > 0) {
    section(cur, brand, "Contingency");
    const cBudget = data.contingencyLines.reduce((s, c) => s + c.originalBudget, 0);
    const cUsed = data.contingencyLines.reduce((s, c) => s + c.totalConsumed, 0);
    const cRemain = data.contingencyLines.reduce((s, c) => s + c.remaining, 0);
    metric(cur, brand, "Budgeted", usd(cBudget));
    metric(
      cur,
      brand,
      "Consumed",
      `${usd(cUsed)}  (${pct(cBudget > 0 ? (cUsed / cBudget) * 100 : 0)})`
    );
    metric(cur, brand, "Remaining", usd(cRemain));
    cur.gap(10);
  }

  // ----- Retainage -----
  const ret = input.retainage;
  if (ret && ret.withheld > 0) {
    section(cur, brand, "Retainage");
    metric(cur, brand, "Withheld to Date", usd(ret.withheld));
    metric(cur, brand, "Released", usd(ret.released), PDF_COLORS.navy);
    metric(cur, brand, "Outstanding", usd(ret.outstanding), PDF_COLORS.tanDark);
    if (ret.vendors.length > 0) {
      cur.gap(4);
      const C_WITHHELD = LEFT + 264;
      const C_RELEASED = LEFT + 360;
      const C_OUT = RIGHT;
      cur.ensure(18);
      drawText(cur.page, "Vendor", brand, { x: LEFT, y: cur.y, size: 8, font: brand.fontBold, color: PDF_COLORS.slateLight });
      drawTextRight(cur.page, "Withheld", brand, { rightX: C_WITHHELD, y: cur.y, size: 8, font: brand.fontBold, color: PDF_COLORS.slateLight });
      drawTextRight(cur.page, "Released", brand, { rightX: C_RELEASED, y: cur.y, size: 8, font: brand.fontBold, color: PDF_COLORS.slateLight });
      drawTextRight(cur.page, "Outstanding", brand, { rightX: C_OUT, y: cur.y, size: 8, font: brand.fontBold, color: PDF_COLORS.slateLight });
      cur.gap(13);
      for (const v of ret.vendors) {
        cur.ensure(14);
        const name = v.name.length > 40 ? `${v.name.slice(0, 39)}…` : v.name;
        drawText(cur.page, name, brand, { x: LEFT, y: cur.y, size: 9 });
        drawTextRight(cur.page, usd(v.withheld), brand, { rightX: C_WITHHELD, y: cur.y, size: 9, color: PDF_COLORS.slate });
        drawTextRight(cur.page, v.released ? usd(v.released) : "—", brand, { rightX: C_RELEASED, y: cur.y, size: 9, color: PDF_COLORS.slate });
        drawTextRight(cur.page, usd(v.outstanding), brand, { rightX: C_OUT, y: cur.y, size: 9, font: brand.fontBold, color: PDF_COLORS.tanDark });
        cur.gap(14);
      }
    }
    cur.gap(10);
  }

  // ----- Draw history -----
  if (draws.length > 0) {
    section(cur, brand, "Draw History");
    // Column header row
    cur.ensure(18);
    drawText(cur.page, "Draw", brand, { x: LEFT, y: cur.y, size: 8, font: brand.fontBold, color: PDF_COLORS.slateLight });
    drawText(cur.page, "Period", brand, { x: LEFT + 60, y: cur.y, size: 8, font: brand.fontBold, color: PDF_COLORS.slateLight });
    drawText(cur.page, "Status", brand, { x: LEFT + 200, y: cur.y, size: 8, font: brand.fontBold, color: PDF_COLORS.slateLight });
    drawTextRight(cur.page, "Net Amount", brand, { rightX: RIGHT, y: cur.y, size: 8, font: brand.fontBold, color: PDF_COLORS.slateLight });
    cur.gap(13);
    let drawTotal = 0;
    for (const d of draws) {
      cur.ensure(14);
      drawText(cur.page, d.drawNumber != null ? `#${d.drawNumber}` : "—", brand, { x: LEFT, y: cur.y, size: 9 });
      drawText(cur.page, d.periodLabel, brand, { x: LEFT + 60, y: cur.y, size: 9, color: PDF_COLORS.slate });
      drawText(cur.page, d.status, brand, { x: LEFT + 200, y: cur.y, size: 9, color: PDF_COLORS.slate });
      drawTextRight(cur.page, usd(d.amount), brand, { rightX: RIGHT, y: cur.y, size: 9, font: brand.fontBold });
      drawTotal += d.amount;
      cur.gap(14);
    }
    // Total rule + row
    cur.page.drawLine({
      start: { x: LEFT, y: cur.y + 4 },
      end: { x: RIGHT, y: cur.y + 4 },
      thickness: 0.75,
      color: PDF_COLORS.borderGray,
    });
    cur.gap(6);
    drawText(cur.page, "Total drawn", brand, { x: LEFT, y: cur.y, size: 9, font: brand.fontBold, color: PDF_COLORS.navy });
    drawTextRight(cur.page, usd(drawTotal), brand, { rightX: RIGHT, y: cur.y, size: 9, font: brand.fontBold, color: PDF_COLORS.navy });
    cur.gap(16);
  }

  // Footer note on the last page.
  drawText(
    cur.page,
    "Generated by the NuRock Development Platform. Figures reflect the live deal state as of the date above.",
    brand,
    { x: LEFT, y: LETTERHEAD.contentBottom + 6, size: 7.5, color: PDF_COLORS.slateLight }
  );

  return brand.doc.save();
}

// Local "Month Year" for milestone dates (TZ-safe — parse components).
function fmtMonthYear(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const mi = parseInt(m[2], 10) - 1;
  return `${months[mi] ?? m[2]} ${m[1]}`;
}
