// =============================================================================
// Federal LIHTC credit calculation (shared)
// =============================================================================
// Mirrors the math in cert-prep/_components/credit-calc-summary.tsx so the
// on-screen calc and the exported Cost Cert package agree. Pure.
//   eligible basis × (1 + boost) = adjusted eligible basis
//   × applicable fraction (LI units / total units) = qualified basis
//   × applicable percentage = annual credit
//   × 10 years = total credit
// =============================================================================

import type { LihtcConfig } from "./lihtc-from-model";

export interface CreditCalc {
  totalDevelopmentCost: number;
  totalEligibleBasis: number;
  basisBoostPct: number; // 0 or 30 (display)
  adjustedEligibleBasis: number;
  lihtcUnits: number;
  totalUnits: number;
  applicableFraction: number | null;
  qualifiedBasis: number | null;
  applicablePct: number | null; // fraction (e.g. 0.09)
  annualCredit: number | null;
  totalCredit: number | null;
}

export function computeCreditCalc(
  config: LihtcConfig,
  totalEligibleBasis: number,
  totalDevelopmentCost: number
): CreditCalc {
  const boost = (config.basis_boost_pct ?? 0) / 100;
  const adjustedEligibleBasis = totalEligibleBasis * (1 + boost);

  const lihtcUnits = config.lihtc_unit_count ?? 0;
  const totalUnits = config.total_unit_count ?? 0;
  const applicableFraction = totalUnits > 0 ? lihtcUnits / totalUnits : null;
  const qualifiedBasis =
    applicableFraction !== null ? adjustedEligibleBasis * applicableFraction : null;

  const applicablePct =
    config.applicable_percentage_pct !== null
      ? Number(config.applicable_percentage_pct) / 100
      : null;
  const annualCredit =
    qualifiedBasis !== null && applicablePct !== null
      ? qualifiedBasis * applicablePct
      : null;
  const totalCredit = annualCredit !== null ? annualCredit * 10 : null;

  return {
    totalDevelopmentCost,
    totalEligibleBasis,
    basisBoostPct: boost > 0 ? 30 : 0,
    adjustedEligibleBasis,
    lihtcUnits,
    totalUnits,
    applicableFraction,
    qualifiedBasis,
    applicablePct,
    annualCredit,
    totalCredit,
  };
}
