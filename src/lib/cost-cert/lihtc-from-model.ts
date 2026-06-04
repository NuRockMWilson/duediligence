// =============================================================================
// LIHTC config derivation from deals.model
// =============================================================================
// Replaces the v1.2 dm_deal_lihtc_config table (dropped in the v1.3 schema
// migration). All values now come from the underwriting model populated during
// promoteDealToDevelopment.
//
// Sources by field:
//   applicable_percentage_pct → info.creditStructure mapping
//                               ("9pct_competitive" → 9.00, "4pct_bond" → 4.00)
//   basis_boost_pct           → qctDda.eligibleForBoost (true → 30, false → 0)
//   lihtc_unit_count          → sum of unitMix[].numberOfUnits where
//                               incomeLevel > 0
//   total_unit_count          → sum of unitMix[].numberOfUnits
//   state_credits_applicable  → info.stateCredits === "Yes"
//
// The notes field has no model equivalent and is always null in v1.3.
// =============================================================================

export interface LihtcConfig {
  deal_id: string;
  applicable_percentage_pct: number | null;
  basis_boost_pct: number;
  lihtc_unit_count: number | null;
  total_unit_count: number | null;
  state_credits_applicable: boolean;
  notes: string | null;
}

// Per-field source descriptions for the UI readout, so the user can see
// exactly which model path each value came from (useful when a derived value
// looks wrong — points the user at what to fix in the underwriting model).
export interface LihtcConfigSources {
  applicablePercentage: string;
  basisBoost: string;
  lihtcUnits: string;
  totalUnits: string;
  stateCredits: string;
}

export interface DerivedLihtcConfig {
  config: LihtcConfig;
  sources: LihtcConfigSources;
}

// Loose typing — model jsonb shape can drift; defensive reads throughout.
type ModelUnitMixRow = {
  numberOfUnits?: number | string | null;
  incomeLevel?: number | string | null;
};

type DealModel = {
  info?: {
    totalUnits?: number | string | null;
    stateCredits?: string | null;
    creditStructure?: string | null;
  } | null;
  qctDda?: {
    eligibleForBoost?: boolean | null;
  } | null;
  unitMix?: ModelUnitMixRow[] | null;
} | null;

// Post-2008 9% deals lock to the 9.00% floor; post-2020 (CAA) 4% deals lock
// to the 4.00% floor. NuRock's pipeline maps cleanly via creditStructure.
// Legacy locked rates on older deals are out of scope here.
const APPLICABLE_PERCENTAGE_BY_STRUCTURE: Record<string, number> = {
  "9pct_competitive": 9.0,
  "4pct_bond": 4.0,
};

export function deriveLihtcConfig(
  dealId: string,
  model: unknown
): DerivedLihtcConfig {
  const m = (model ?? null) as DealModel;

  // --- Applicable Percentage (IRS credit rate) -------------------------------
  const creditStructure = m?.info?.creditStructure ?? null;
  const applicablePct =
    creditStructure != null &&
    APPLICABLE_PERCENTAGE_BY_STRUCTURE[creditStructure] !== undefined
      ? APPLICABLE_PERCENTAGE_BY_STRUCTURE[creditStructure]
      : null;

  // --- Basis Boost -----------------------------------------------------------
  const eligibleForBoost = m?.qctDda?.eligibleForBoost === true;
  const basisBoostPct = eligibleForBoost ? 30 : 0;

  // --- Unit counts -----------------------------------------------------------
  const unitMix = Array.isArray(m?.unitMix) ? (m!.unitMix as ModelUnitMixRow[]) : [];
  let totalUnits = 0;
  let lihtcUnits = 0;
  for (const row of unitMix) {
    const count = Number(row?.numberOfUnits ?? 0);
    if (!isFinite(count) || count <= 0) continue;
    totalUnits += count;
    const incomeLevel = Number(row?.incomeLevel ?? 0);
    if (isFinite(incomeLevel) && incomeLevel > 0) {
      lihtcUnits += count;
    }
  }

  // --- State credits ---------------------------------------------------------
  const stateCreditsStr = (m?.info?.stateCredits ?? "").toString().toLowerCase();
  const stateCredits = stateCreditsStr === "yes";

  return {
    config: {
      deal_id: dealId,
      applicable_percentage_pct: applicablePct,
      basis_boost_pct: basisBoostPct,
      lihtc_unit_count: totalUnits > 0 ? lihtcUnits : null,
      total_unit_count: totalUnits > 0 ? totalUnits : null,
      state_credits_applicable: stateCredits,
      notes: null,
    },
    sources: {
      applicablePercentage: creditStructure
        ? `info.creditStructure = "${creditStructure}"`
        : "info.creditStructure missing — set in UW model",
      basisBoost: `qctDda.eligibleForBoost = ${eligibleForBoost ? "true" : "false"}`,
      lihtcUnits:
        unitMix.length > 0
          ? "sum(unitMix[].numberOfUnits) where incomeLevel > 0"
          : "unitMix empty — set in UW model",
      totalUnits:
        unitMix.length > 0
          ? "sum(unitMix[].numberOfUnits)"
          : "unitMix empty — set in UW model",
      stateCredits: `info.stateCredits = "${m?.info?.stateCredits ?? ""}"`,
    },
  };
}
