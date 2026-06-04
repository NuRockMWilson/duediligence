import { createClient } from "@/lib/supabase/server";

// ============================================================================
// UW Model Fetcher (Phase B)
// ----------------------------------------------------------------------------
// Reads the underwriting model JSON from `deals.model` (shared Supabase
// project, same DB as nurock-devmgmt). Parses defensively — every nested
// access uses optional chaining + Number()/String() coercion so a partially-
// populated model doesn't crash the page.
//
// The model's top-level keys (per Foxcroft 9pct_competitive deal):
//   acknowledgments, assumptions, cashWaterfall, constructionBudget,
//   constructionFinancing, customBases, devFeeDuringConstructionPct,
//   devFeePayoutPercents, equity, hudFmr, hudIncomeLimits, info, keyDates,
//   leaseUp, marketRates, operatingBudget, partnership, permanentFinancing,
//   qctDda, unitMix, utilityAllowances
//
// Phase B reads just `info` + `constructionBudget`. Phase C will pull in
// equity/constructionFinancing/permanentFinancing for the Sources tab.
// ============================================================================

export type UwBudgetLine = {
  id: string;                              // "cb1", "cb70" — joins to dm_underwriting_line_gl.source_line_id
  description: string;
  category: string;
  amount: number;                          // UW budget for this line
  costEligible: number;                    // $ amount counted toward eligible basis
  ineligibleBasisAllocation: string | null; // e.g., "land_basis"
};

export type UwInfo = {
  projectName: string;
  entityName: string;
  totalUnits: number;
  totalSquareFeet: number;
  creditStructure: string;                 // e.g., "9pct_competitive", "4pct_bond"
  city: string;
  state: string;
  county: string;
  address: string;
};

/**
 * UW KeyDates — mirrors the KeyDates interface in
 * nurock-underwriting/lib/types.ts. Every field is a date string (typically
 * ISO `YYYY-MM-DD`; timeline-derived milestones may be month-anchored to
 * the first of the month). Optional everywhere because:
 *
 *   (a) older deal snapshots predate some keys (e.g. taxCreditPartnershipClosing
 *       was added later), and
 *   (b) computed dates may be empty until the UW Key Project Dates tab has
 *       been visited at least once.
 *
 * Consumers in this app should treat empty strings the same as missing —
 * `parseKeyDates` already coerces "" to null.
 */
export type UwKeyDates = {
  closingDate: string | null;
  taxCreditPartnershipClosing: string | null;
  constructionStart: string | null;
  construction25Complete: string | null;
  construction50Complete: string | null;
  construction75Complete: string | null;
  constructionCompleteFirstBuilding: string | null;
  certificatesOfOccupancy: string | null;
  placedInService: string | null;
  operationsStart: string | null;
  stabilizationDate: string | null;
  permanentFinancingClosing: string | null;
  firstTaxCreditMonth: string | null;
  form8609Delivery: string | null;
  taxReturnDelivery: string | null;
  operatingReserveFundingDate: string | null;
  dispositionDate: string | null;
};

export type UwModel = {
  info: UwInfo;
  constructionBudget: UwBudgetLine[];
  keyDates: UwKeyDates;
};

export async function getUwModel(dealId: string): Promise<UwModel | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("deals")
    .select("model")
    .eq("id", dealId)
    .maybeSingle();

  if (error) {
    console.error("[uw-model] deals query:", error);
    return null;
  }

  if (!data || !data.model) {
    console.warn("[uw-model] no model JSON for deal:", dealId);
    return null;
  }

  // Supabase returns JSONB as a parsed object — no JSON.parse needed
  const model = data.model as Record<string, unknown>;

  return {
    info: parseInfo(model.info),
    constructionBudget: parseBudget(model.constructionBudget),
    keyDates: parseKeyDates(model.keyDates),
  };
}

// -----------------------------------------------------------------------------
// Defensive parsers
// -----------------------------------------------------------------------------

function parseInfo(raw: unknown): UwInfo {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    projectName: String(r.projectName ?? ""),
    entityName: String(r.entityName ?? ""),
    totalUnits: Number(r.totalUnits ?? 0),
    totalSquareFeet: Number(r.totalSquareFeet ?? 0),
    creditStructure: String(r.creditStructure ?? ""),
    city: String(r.city ?? ""),
    state: String(r.state ?? ""),
    county: String(r.county ?? ""),
    address: String(r.address ?? ""),
  };
}

function parseKeyDates(raw: unknown): UwKeyDates {
  const r = (raw ?? {}) as Record<string, unknown>;
  // Coerce: stringify whatever's there; empty string → null. Don't validate
  // the format — the UW model writes ISO `YYYY-MM-DD`, but Date.parse is
  // lenient and downstream consumers (dashboard-rollup) use localeCompare on
  // the raw string and `new Date(...)` for month arithmetic, both of which
  // tolerate any ISO-ish form.
  const norm = (key: string): string | null => {
    const v = r[key];
    if (v == null) return null;
    const s = String(v);
    return s.length === 0 ? null : s;
  };
  return {
    closingDate:                       norm("closingDate"),
    taxCreditPartnershipClosing:       norm("taxCreditPartnershipClosing"),
    constructionStart:                 norm("constructionStart"),
    construction25Complete:            norm("construction25Complete"),
    construction50Complete:            norm("construction50Complete"),
    construction75Complete:            norm("construction75Complete"),
    constructionCompleteFirstBuilding: norm("constructionCompleteFirstBuilding"),
    certificatesOfOccupancy:           norm("certificatesOfOccupancy"),
    placedInService:                   norm("placedInService"),
    operationsStart:                   norm("operationsStart"),
    stabilizationDate:                 norm("stabilizationDate"),
    permanentFinancingClosing:         norm("permanentFinancingClosing"),
    firstTaxCreditMonth:               norm("firstTaxCreditMonth"),
    form8609Delivery:                  norm("form8609Delivery"),
    taxReturnDelivery:                 norm("taxReturnDelivery"),
    operatingReserveFundingDate:       norm("operatingReserveFundingDate"),
    dispositionDate:                   norm("dispositionDate"),
  };
}

function parseBudget(raw: unknown): UwBudgetLine[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item: unknown) => {
      const r = (item ?? {}) as Record<string, unknown>;
      return {
        id: String(r.id ?? ""),
        description: String(r.description ?? ""),
        category: String(r.category ?? "Uncategorized"),
        amount: Number(r.amount ?? 0),
        costEligible: Number(r.costEligible ?? 0),
        ineligibleBasisAllocation:
          r.ineligibleBasisAllocation != null
            ? String(r.ineligibleBasisAllocation)
            : null,
      };
    })
    .filter((line) => line.id); // drop rows without an id
}
