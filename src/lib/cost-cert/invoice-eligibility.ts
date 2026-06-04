// =============================================================================
// Invoice line eligibility helpers (v1.3 Ship 2c)
// =============================================================================
// Resolves the eligible / ineligible split for a single invoice line. Ship 2c
// uses GL-level defaults from cost_account_map.is_eligible_basis as the
// fallback when the user hasn't entered an explicit split — and respects any
// explicit split when present. Per-deal NuRock-Standard-line overrides from
// dm_eligible_basis_overrides still apply on top of the GL default.
//
// Ship 2d will layer interim cost amortization here — for is_interim_cost = true
// invoice lines, the eligibility decays month-by-month with the lease-up
// schedule (units_under_construction / total_units), and the helper will
// return the amortized split instead of the GL default × amount.
// =============================================================================

export interface EligibilityResolverInputs {
  // Per-GL eligibility defaults (true → 100% eligible by default, false → 0%)
  glEligibleDefault: Map<string, boolean>;
  // GL → NuRock Standard schedule line (for the per-deal override lookup)
  standardLineByGl: Map<string, string>;
  // Per-deal Standard-line overrides (eligible pct 0-100)
  overrideByStandardLine: Map<string, number>;
}

export interface ResolvedEligibility {
  eligibleAmount: number;
  ineligibleAmount: number;
  // True if the value came from an explicit per-row eligible_amount on the
  // invoice line; false if it was auto-computed from GL defaults.
  isExplicit: boolean;
}

export function resolveInvoiceLineEligibility(
  line: {
    amount: number;
    gl_account: string;
    eligible_amount: number | null;
    ineligible_amount: number | null;
  },
  inputs: EligibilityResolverInputs
): ResolvedEligibility {
  // Explicit per-line value wins — that's the cert-prep user's authoritative
  // override (entered manually in Ship 2c, auto-computed via interim formula
  // in Ship 2d).
  if (line.eligible_amount !== null) {
    const eligible = Number(line.eligible_amount);
    const ineligible =
      line.ineligible_amount !== null
        ? Number(line.ineligible_amount)
        : Number(line.amount) - eligible;
    return {
      eligibleAmount: round2(eligible),
      ineligibleAmount: round2(ineligible),
      isExplicit: true,
    };
  }

  // Fall back to: per-deal Standard-line override → GL default → 0% eligible
  const stdLineId = inputs.standardLineByGl.get(line.gl_account) ?? null;
  let eligiblePct = 0;
  if (stdLineId && inputs.overrideByStandardLine.has(stdLineId)) {
    eligiblePct = inputs.overrideByStandardLine.get(stdLineId) ?? 0;
  } else {
    eligiblePct = inputs.glEligibleDefault.get(line.gl_account) === true ? 100 : 0;
  }

  const amount = Number(line.amount);
  const eligibleAmount = round2((amount * eligiblePct) / 100);
  const ineligibleAmount = round2(amount - eligibleAmount);
  return {
    eligibleAmount,
    ineligibleAmount,
    isExplicit: false,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
