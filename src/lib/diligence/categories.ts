// =============================================================================
// Due-diligence category catalog — the canonical LIHTC DD groupings.
// =============================================================================
// Keys match the `category` column seeded in migration 0081. The UI groups the
// checklist by these and renders the label in seed order. Keeping this in one
// place means the checklist screen, exports, and any future template builder
// all read the same ordered list of human labels.
// =============================================================================

export interface DiligenceCategory {
  key: string;
  label: string;
  /** Short blurb shown under the group header — LIHTC context. */
  blurb: string;
}

export const DILIGENCE_CATEGORIES: DiligenceCategory[] = [
  { key: "org_docs", label: "Borrower / Organizational", blurb: "Entity formation, authority, and tax identity" },
  { key: "title_survey", label: "Title & Survey", blurb: "Title commitment, ALTA survey, and exceptions" },
  { key: "environmental", label: "Environmental", blurb: "Phase I/II ESA and hazardous-materials surveys" },
  { key: "zoning_land_use", label: "Zoning & Land Use", blurb: "Entitlements, permits, and utility availability" },
  { key: "lihtc_application", label: "LIHTC Application", blurb: "QAP submission, reservation, and 42(m)" },
  { key: "lihtc_carryover", label: "Carryover & 10% Test", blurb: "Carryover allocation and basis certification" },
  { key: "lihtc_8609", label: "Cost Cert & 8609", blurb: "Final cost cert, placed-in-service, and 8609s" },
  { key: "market_study", label: "Market Study", blurb: "Market and rent-comparability analyses" },
  { key: "appraisal", label: "Appraisal", blurb: "As-complete, as-stabilized, and land values" },
  { key: "insurance", label: "Insurance", blurb: "Builder's risk, liability, property, and flood" },
  { key: "financials", label: "Financials", blurb: "Budget, pro forma, and guarantor statements" },
  { key: "construction_docs", label: "Construction", blurb: "Contract, plans, schedule, and bonds" },
  { key: "partnership_lp", label: "Investor / Equity", blurb: "LP commitment, contributions, and DD questionnaire" },
  { key: "financing_commitments", label: "Financing Commitments", blurb: "Construction, permanent, and soft-source loans" },
  { key: "tax_compliance", label: "Tax & Compliance", blurb: "Abatement/PILOT, LURA, and utility allowance" },
];

const LABEL_BY_KEY = new Map(DILIGENCE_CATEGORIES.map((c) => [c.key, c.label]));
const ORDER_BY_KEY = new Map(DILIGENCE_CATEGORIES.map((c, i) => [c.key, i]));

export function categoryLabel(key: string): string {
  return LABEL_BY_KEY.get(key) ?? key;
}

/** Sort comparator that orders categories by their seed order (unknowns last). */
export function categoryOrder(key: string): number {
  return ORDER_BY_KEY.get(key) ?? Number.MAX_SAFE_INTEGER;
}
