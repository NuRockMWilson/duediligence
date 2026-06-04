"use server";

// =============================================================================
// Portfolio export actions (Phase 7 r3)
// =============================================================================
// Cross-deal CSV + branded PDF of the portfolio rollup, for the deals page.
// Both return the standard { base64, filename, mime } envelope.
// =============================================================================

import { getPortfolioRollup } from "@/lib/data/portfolio-rollup";
import { buildCsvBase64, type CsvCell } from "@/lib/export/csv";
import { MIME } from "@/lib/export/download";
import {
  createBrandedPdf,
  drawText,
  drawTextRight,
  drawSubheading,
  PDF_COLORS,
  LETTERHEAD,
} from "@/lib/pdf/letterhead";

function usd(n: number): string {
  const neg = n < 0;
  const s = `$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
  return neg ? `(${s})` : s;
}
function pct(n: number): string {
  return `${n.toFixed(1)}%`;
}
function fmtMonthYear(iso: string | null): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[parseInt(m[2], 10) - 1] ?? m[2]} ${m[1]}`;
}

// ----- CSV -----
export async function exportPortfolioCsv(): Promise<
  { base64: string; filename: string; mime: string } | { error: string }
> {
  try {
    const { deals, totals } = await getPortfolioRollup();
    const headers = [
      "Deal",
      "Stage",
      "Schedule Type",
      "Total Dev Cost",
      "Drawn to Date",
      "% Drawn",
      "Draws",
      "Net Sources",
      "Net Uses",
      "Sources − Uses",
      "Next Milestone",
      "Milestone Date",
    ];
    const rows: CsvCell[][] = deals.map((d) => [
      d.name,
      d.stage,
      d.isCustomSchedule ? "Custom" : "NuRock Standard",
      d.tdc,
      d.drawn,
      Number(d.drawnPct.toFixed(1)),
      d.drawCount,
      d.netSources,
      d.netUses,
      Number(d.sourcesBalance.toFixed(2)),
      d.nextMilestoneLabel ?? "",
      d.nextMilestoneDate ?? "",
    ]);
    // Totals row.
    rows.push([
      "TOTAL",
      "",
      "",
      totals.tdc,
      totals.drawn,
      Number((totals.tdc > 0 ? (totals.drawn / totals.tdc) * 100 : 0).toFixed(1)),
      "",
      totals.netSources,
      totals.netUses,
      Number((totals.netSources - totals.netUses).toFixed(2)),
      "",
      "",
    ]);
    const stamp = new Date().toISOString().slice(0, 10);
    return {
      base64: buildCsvBase64(headers, rows),
      filename: `portfolio-summary-${stamp}.csv`,
      mime: MIME.csv,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Export failed" };
  }
}

// ----- Branded PDF -----
export async function exportPortfolioPdf(): Promise<
  { base64: string; filename: string; mime: string } | { error: string }
> {
  try {
    const { deals, totals } = await getPortfolioRollup();
    const brand = await createBrandedPdf();
    const LEFT = LETTERHEAD.marginLeft;
    const RIGHT = LETTERHEAD.pageWidth - LETTERHEAD.marginRight;

    let page = brand.addPage();
    let y: number = LETTERHEAD.contentTop;

    drawText(page, "PORTFOLIO SUMMARY", brand, {
      x: LEFT,
      y,
      size: 9,
      font: brand.fontBold,
      color: PDF_COLORS.tanDark,
    });
    const asOf = new Date().toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    drawTextRight(page, `As of ${asOf}`, brand, { rightX: RIGHT, y, size: 9, color: PDF_COLORS.slate });
    y -= 20;
    drawText(page, `${totals.dealCount} active deal${totals.dealCount === 1 ? "" : "s"}`, brand, {
      x: LEFT,
      y,
      size: 16,
      font: brand.fontBold,
      color: PDF_COLORS.navy,
    });
    y -= 28;

    // Column layout: Deal | TDC | Drawn (%) | Next milestone
    // Each deal = a compact 2-line block (name + stage on line 1; metrics on
    // line 2), which fits long deal names without a cramped single row.
    const drawHeaderRow = () => {
      drawText(page, "Deal", brand, { x: LEFT, y, size: 8, font: brand.fontBold, color: PDF_COLORS.slateLight });
      drawTextRight(page, "Total Dev Cost", brand, { rightX: LEFT + 300, y, size: 8, font: brand.fontBold, color: PDF_COLORS.slateLight });
      drawTextRight(page, "Drawn", brand, { rightX: LEFT + 390, y, size: 8, font: brand.fontBold, color: PDF_COLORS.slateLight });
      drawTextRight(page, "Next Milestone", brand, { rightX: RIGHT, y, size: 8, font: brand.fontBold, color: PDF_COLORS.slateLight });
      y -= 6;
      page.drawLine({ start: { x: LEFT, y }, end: { x: RIGHT, y }, thickness: 0.75, color: PDF_COLORS.borderGray });
      y -= 14;
    };
    drawHeaderRow();

    for (const d of deals) {
      if (y < LETTERHEAD.contentBottom + 30) {
        page = brand.addPage();
        y = LETTERHEAD.contentTop;
        drawHeaderRow();
      }
      // Line 1: deal name + stage chip
      drawText(page, d.name, brand, { x: LEFT, y, size: 10, font: brand.fontBold, color: PDF_COLORS.black });
      drawTextRight(page, usd(d.tdc), brand, { rightX: LEFT + 300, y, size: 10, font: brand.fontBold });
      drawTextRight(page, `${usd(d.drawn)} (${pct(d.drawnPct)})`, brand, { rightX: LEFT + 390, y, size: 9, color: PDF_COLORS.slate });
      const ms = d.nextMilestoneLabel
        ? `${d.nextMilestoneLabel} ${fmtMonthYear(d.nextMilestoneDate)}`
        : "—";
      drawTextRight(page, ms, brand, { rightX: RIGHT, y, size: 9, color: PDF_COLORS.slate });
      y -= 13;
      // Line 2: stage + schedule type + sources/uses balance
      const balLabel =
        Math.abs(d.sourcesBalance) < 1
          ? "Sources balanced"
          : `Sources ${d.sourcesBalance > 0 ? "over" : "short"} ${usd(Math.abs(d.sourcesBalance))}`;
      drawText(
        page,
        `${d.stage}  ·  ${d.isCustomSchedule ? "Custom schedule" : "NuRock Standard"}  ·  ${balLabel}`,
        brand,
        { x: LEFT, y, size: 8, color: PDF_COLORS.slateLight }
      );
      y -= 18;
    }

    // Totals
    if (y < LETTERHEAD.contentBottom + 30) {
      page = brand.addPage();
      y = LETTERHEAD.contentTop;
    }
    page.drawLine({ start: { x: LEFT, y: y + 6 }, end: { x: RIGHT, y: y + 6 }, thickness: 1, color: PDF_COLORS.navy });
    y -= 6;
    drawText(page, "Portfolio total", brand, { x: LEFT, y, size: 10, font: brand.fontBold, color: PDF_COLORS.navy });
    drawTextRight(page, usd(totals.tdc), brand, { rightX: LEFT + 300, y, size: 10, font: brand.fontBold, color: PDF_COLORS.navy });
    drawTextRight(
      page,
      `${usd(totals.drawn)} (${pct(totals.tdc > 0 ? (totals.drawn / totals.tdc) * 100 : 0)})`,
      brand,
      { rightX: LEFT + 390, y, size: 9, color: PDF_COLORS.navy }
    );

    drawText(
      page,
      "Generated by the NuRock Development Platform. Figures reflect live deal state as of the date above.",
      brand,
      { x: LEFT, y: LETTERHEAD.contentBottom + 6, size: 7.5, color: PDF_COLORS.slateLight }
    );

    const bytes = await brand.doc.save();
    const stamp = new Date().toISOString().slice(0, 10);
    return {
      base64: Buffer.from(bytes).toString("base64"),
      filename: `portfolio-summary-${stamp}.pdf`,
      mime: MIME.pdf,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Report failed" };
  }
}
