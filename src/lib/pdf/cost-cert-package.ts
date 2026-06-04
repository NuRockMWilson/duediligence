// =============================================================================
// Cost Certification package — branded PDF (cost cert r3)
// =============================================================================
// The consolidated cost-cert deliverable: readiness summary, federal credit
// calc, final actual Sources & Uses, eligible-basis schedule, and the
// building/BIN schedule — on NuRock letterhead. Built from the same data the
// cert-prep tab renders (passed in by the export action) so the PDF matches
// the screen. Server-side only.
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
import type { PDFPage } from "pdf-lib";
import type { CreditCalc } from "@/lib/cost-cert/credit-calc";
import type { FinalSourcesUses } from "@/lib/cost-cert/final-sources-uses";

const LEFT = LETTERHEAD.marginLeft;
const RIGHT = LETTERHEAD.pageWidth - LETTERHEAD.marginRight;

function usd(n: number): string {
  const neg = n < 0;
  const s = `$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
  return neg ? `(${s})` : s;
}
function pctStr(frac: number, dp = 2): string {
  return `${(frac * 100).toFixed(dp)}%`;
}
function monthYear(iso: string | null): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[parseInt(m[2], 10) - 1] ?? m[2]} ${m[1]}`;
}
function trunc(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

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

function metric(
  cur: Cursor,
  brand: BrandedPdf,
  label: string,
  value: string,
  valueColor = PDF_COLORS.black
) {
  cur.ensure(16);
  drawText(cur.page, label, brand, { x: LEFT, y: cur.y, size: 10, color: PDF_COLORS.slate });
  drawTextRight(cur.page, value, brand, {
    rightX: RIGHT,
    y: cur.y,
    size: 10,
    font: brand.fontBold,
    color: valueColor,
  });
  cur.gap(16);
}

export interface CostCertPackageInput {
  dealName: string;
  asOf: string;
  readiness: {
    overall: "ready" | "almost" | "not_ready";
    okCount: number;
    total: number;
    checks: { label: string; status: "ok" | "warn" | "blocker"; detail: string }[];
  };
  creditCalc: CreditCalc;
  finalSourcesUses: FinalSourcesUses;
  lines: {
    lineNumber: number;
    description: string;
    actualCost: number;
    eligiblePct: number;
  }[];
  buildings: {
    building_number: number | null;
    bin: string | null;
    building_name: string | null;
    address: string | null;
    unit_count: number | null;
    square_footage: number | null;
    placed_in_service_date: string | null;
  }[];
}

export async function generateCostCertPackagePdf(
  input: CostCertPackageInput
): Promise<Uint8Array> {
  const brand = await createBrandedPdf();
  const cur = new Cursor(brand);
  const cc = input.creditCalc;

  // ----- Title -----
  drawText(cur.page, "COST CERTIFICATION", brand, {
    x: LEFT,
    y: cur.y,
    size: 9,
    font: brand.fontBold,
    color: PDF_COLORS.tanDark,
  });
  cur.gap(18);
  drawText(cur.page, input.dealName, brand, {
    x: LEFT,
    y: cur.y,
    size: 17,
    font: brand.fontBold,
    color: PDF_COLORS.navy,
  });
  drawTextRight(cur.page, `As of ${input.asOf}`, brand, {
    rightX: RIGHT,
    y: cur.y + 2,
    size: 9,
    color: PDF_COLORS.slate,
  });
  cur.gap(16);
  const readyLabel =
    input.readiness.overall === "ready"
      ? "Ready to certify"
      : input.readiness.overall === "almost"
        ? "Almost ready"
        : "Not ready";
  drawText(
    cur.page,
    `Readiness: ${readyLabel} (${input.readiness.okCount}/${input.readiness.total} checks pass)`,
    brand,
    {
      x: LEFT,
      y: cur.y,
      size: 9,
      color:
        input.readiness.overall === "ready" ? PDF_COLORS.navy : PDF_COLORS.tanDark,
    }
  );
  cur.gap(24);

  // ----- Readiness detail -----
  section(cur, brand, "Readiness");
  for (const c of input.readiness.checks) {
    cur.ensure(14);
    const mark = c.status === "ok" ? "[OK]" : c.status === "warn" ? "[!]" : "[X]";
    drawText(cur.page, `${mark} ${c.label}`, brand, {
      x: LEFT,
      y: cur.y,
      size: 9,
      font: brand.fontBold,
      color:
        c.status === "ok"
          ? PDF_COLORS.navy
          : c.status === "warn"
            ? PDF_COLORS.tanDark
            : PDF_COLORS.navyDark,
    });
    drawTextRight(cur.page, trunc(c.detail, 70), brand, {
      rightX: RIGHT,
      y: cur.y,
      size: 8.5,
      color: PDF_COLORS.slate,
    });
    cur.gap(13);
  }
  cur.gap(8);

  // ----- Federal Credit Calc -----
  section(cur, brand, "Federal Credit Calculation");
  metric(cur, brand, "Total Development Cost", usd(cc.totalDevelopmentCost));
  metric(cur, brand, "Total Eligible Basis", usd(cc.totalEligibleBasis));
  metric(
    cur,
    brand,
    `Adjusted Eligible Basis (${cc.basisBoostPct > 0 ? "130% boost" : "no boost"})`,
    usd(cc.adjustedEligibleBasis)
  );
  if (cc.applicableFraction !== null && cc.qualifiedBasis !== null) {
    metric(
      cur,
      brand,
      `Qualified Basis (applic. fraction ${cc.lihtcUnits}/${cc.totalUnits} = ${pctStr(cc.applicableFraction)})`,
      usd(cc.qualifiedBasis)
    );
  }
  if (cc.applicablePct !== null && cc.annualCredit !== null) {
    metric(
      cur,
      brand,
      `Annual Credit (applic. % ${pctStr(cc.applicablePct, 4)})`,
      usd(cc.annualCredit)
    );
  }
  if (cc.totalCredit !== null) {
    metric(cur, brand, "Total Credit (10 years)", usd(cc.totalCredit), PDF_COLORS.navy);
  }
  cur.gap(8);

  // ----- Final Sources & Uses -----
  const su = input.finalSourcesUses;
  section(cur, brand, "Final Sources & Uses");
  // Uses
  cur.ensure(16);
  drawText(cur.page, "Uses", brand, { x: LEFT, y: cur.y, size: 8, font: brand.fontBold, color: PDF_COLORS.slateLight });
  drawTextRight(cur.page, "Budget", brand, { rightX: LEFT + 300, y: cur.y, size: 8, font: brand.fontBold, color: PDF_COLORS.slateLight });
  drawTextRight(cur.page, "Actual", brand, { rightX: LEFT + 390, y: cur.y, size: 8, font: brand.fontBold, color: PDF_COLORS.slateLight });
  drawTextRight(cur.page, "Variance", brand, { rightX: RIGHT, y: cur.y, size: 8, font: brand.fontBold, color: PDF_COLORS.slateLight });
  cur.gap(13);
  for (const u of su.uses) {
    cur.ensure(13);
    drawText(cur.page, trunc(u.section, 32), brand, { x: LEFT, y: cur.y, size: 9 });
    drawTextRight(cur.page, usd(u.budget), brand, { rightX: LEFT + 300, y: cur.y, size: 9, color: PDF_COLORS.slate });
    drawTextRight(cur.page, usd(u.actual), brand, { rightX: LEFT + 390, y: cur.y, size: 9 });
    drawTextRight(cur.page, usd(u.variance), brand, { rightX: RIGHT, y: cur.y, size: 9, color: PDF_COLORS.slate });
    cur.gap(13);
  }
  cur.page.drawLine({ start: { x: LEFT, y: cur.y + 4 }, end: { x: RIGHT, y: cur.y + 4 }, thickness: 0.75, color: PDF_COLORS.borderGray });
  cur.gap(6);
  drawText(cur.page, "Total Uses", brand, { x: LEFT, y: cur.y, size: 9, font: brand.fontBold, color: PDF_COLORS.navy });
  drawTextRight(cur.page, usd(su.usesTotal.budget), brand, { rightX: LEFT + 300, y: cur.y, size: 9, font: brand.fontBold, color: PDF_COLORS.navy });
  drawTextRight(cur.page, usd(su.usesTotal.actual), brand, { rightX: LEFT + 390, y: cur.y, size: 9, font: brand.fontBold, color: PDF_COLORS.navy });
  drawTextRight(cur.page, usd(su.usesTotal.variance), brand, { rightX: RIGHT, y: cur.y, size: 9, font: brand.fontBold, color: PDF_COLORS.navy });
  cur.gap(16);
  // Sources
  cur.ensure(16);
  drawText(cur.page, "Sources", brand, { x: LEFT, y: cur.y, size: 8, font: brand.fontBold, color: PDF_COLORS.slateLight });
  drawTextRight(cur.page, "Committed", brand, { rightX: LEFT + 345, y: cur.y, size: 8, font: brand.fontBold, color: PDF_COLORS.slateLight });
  drawTextRight(cur.page, "Funded", brand, { rightX: RIGHT, y: cur.y, size: 8, font: brand.fontBold, color: PDF_COLORS.slateLight });
  cur.gap(13);
  for (const s of su.sources) {
    cur.ensure(13);
    drawText(cur.page, `${trunc(s.name, 40)}${s.isBridge ? " (bridge)" : ""}`, brand, { x: LEFT, y: cur.y, size: 9, color: s.isBridge ? PDF_COLORS.slateLight : PDF_COLORS.black });
    drawTextRight(cur.page, usd(s.committed), brand, { rightX: LEFT + 345, y: cur.y, size: 9, color: PDF_COLORS.slate });
    drawTextRight(cur.page, s.funded ? usd(s.funded) : "—", brand, { rightX: RIGHT, y: cur.y, size: 9 });
    cur.gap(13);
  }
  cur.page.drawLine({ start: { x: LEFT, y: cur.y + 4 }, end: { x: RIGHT, y: cur.y + 4 }, thickness: 0.75, color: PDF_COLORS.borderGray });
  cur.gap(6);
  drawText(cur.page, "Permanent Sources", brand, { x: LEFT, y: cur.y, size: 9, font: brand.fontBold, color: PDF_COLORS.navy });
  drawTextRight(cur.page, usd(su.sourcesTotal.committed), brand, { rightX: LEFT + 345, y: cur.y, size: 9, font: brand.fontBold, color: PDF_COLORS.navy });
  drawTextRight(cur.page, usd(su.sourcesTotal.funded), brand, { rightX: RIGHT, y: cur.y, size: 9, font: brand.fontBold, color: PDF_COLORS.navy });
  cur.gap(16);

  // ----- Eligible Basis schedule (lines with actual cost) -----
  const basisLines = input.lines
    .filter((l) => l.actualCost > 0)
    .sort((a, b) => a.lineNumber - b.lineNumber);
  if (basisLines.length > 0) {
    section(cur, brand, "Eligible Basis Schedule");
    cur.ensure(16);
    drawText(cur.page, "Line", brand, { x: LEFT, y: cur.y, size: 8, font: brand.fontBold, color: PDF_COLORS.slateLight });
    drawTextRight(cur.page, "Actual Cost", brand, { rightX: LEFT + 320, y: cur.y, size: 8, font: brand.fontBold, color: PDF_COLORS.slateLight });
    drawTextRight(cur.page, "Elig %", brand, { rightX: LEFT + 385, y: cur.y, size: 8, font: brand.fontBold, color: PDF_COLORS.slateLight });
    drawTextRight(cur.page, "Eligible Basis", brand, { rightX: RIGHT, y: cur.y, size: 8, font: brand.fontBold, color: PDF_COLORS.slateLight });
    cur.gap(13);
    for (const l of basisLines) {
      cur.ensure(13);
      const elig = l.actualCost * (l.eligiblePct / 100);
      drawText(cur.page, trunc(`${l.lineNumber}. ${l.description}`, 42), brand, { x: LEFT, y: cur.y, size: 8.5 });
      drawTextRight(cur.page, usd(l.actualCost), brand, { rightX: LEFT + 320, y: cur.y, size: 8.5, color: PDF_COLORS.slate });
      drawTextRight(cur.page, `${l.eligiblePct.toFixed(0)}%`, brand, { rightX: LEFT + 385, y: cur.y, size: 8.5, color: PDF_COLORS.slate });
      drawTextRight(cur.page, usd(elig), brand, { rightX: RIGHT, y: cur.y, size: 8.5 });
      cur.gap(13);
    }
    cur.page.drawLine({ start: { x: LEFT, y: cur.y + 4 }, end: { x: RIGHT, y: cur.y + 4 }, thickness: 0.75, color: PDF_COLORS.borderGray });
    cur.gap(6);
    drawText(cur.page, "Total Eligible Basis", brand, { x: LEFT, y: cur.y, size: 9, font: brand.fontBold, color: PDF_COLORS.navy });
    drawTextRight(cur.page, usd(cc.totalEligibleBasis), brand, { rightX: RIGHT, y: cur.y, size: 9, font: brand.fontBold, color: PDF_COLORS.navy });
    cur.gap(16);
  }

  // ----- Building schedule -----
  if (input.buildings.length > 0) {
    section(cur, brand, "Building Schedule");
    cur.ensure(16);
    drawText(cur.page, "BIN / Building", brand, { x: LEFT, y: cur.y, size: 8, font: brand.fontBold, color: PDF_COLORS.slateLight });
    drawTextRight(cur.page, "Units", brand, { rightX: LEFT + 300, y: cur.y, size: 8, font: brand.fontBold, color: PDF_COLORS.slateLight });
    drawTextRight(cur.page, "Sq Ft", brand, { rightX: LEFT + 380, y: cur.y, size: 8, font: brand.fontBold, color: PDF_COLORS.slateLight });
    drawTextRight(cur.page, "Placed in Svc", brand, { rightX: RIGHT, y: cur.y, size: 8, font: brand.fontBold, color: PDF_COLORS.slateLight });
    cur.gap(13);
    for (const b of input.buildings) {
      cur.ensure(13);
      const label = `${b.bin || "(no BIN)"} · ${trunc(b.building_name || b.address || `Building ${b.building_number ?? ""}`, 30)}`;
      drawText(cur.page, trunc(label, 46), brand, { x: LEFT, y: cur.y, size: 8.5 });
      drawTextRight(cur.page, String(b.unit_count ?? "—"), brand, { rightX: LEFT + 300, y: cur.y, size: 8.5, color: PDF_COLORS.slate });
      drawTextRight(cur.page, b.square_footage ? b.square_footage.toLocaleString("en-US") : "—", brand, { rightX: LEFT + 380, y: cur.y, size: 8.5, color: PDF_COLORS.slate });
      drawTextRight(cur.page, monthYear(b.placed_in_service_date), brand, { rightX: RIGHT, y: cur.y, size: 8.5, color: PDF_COLORS.slate });
      cur.gap(13);
    }
    cur.gap(8);
  }

  drawText(
    cur.page,
    "Generated by the NuRock Development Platform. Eligible basis runs off actual invoiced costs; figures reflect live deal state as of the date above. Final certification subject to CPA review.",
    brand,
    { x: LEFT, y: LETTERHEAD.contentBottom + 6, size: 7.5, color: PDF_COLORS.slateLight }
  );

  return brand.doc.save();
}
