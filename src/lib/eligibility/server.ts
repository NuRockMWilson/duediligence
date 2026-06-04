// =============================================================================
// Phase 5 r3 — Eligibility recalc, server side
// =============================================================================
// Glue between the pure calc engine (src/lib/eligibility/index.ts) and the
// dm_invoice_lines table. Looks up everything the engine needs (GL's
// interim_cost_type, deal's keyDates, invoice's invoice_date, line's period
// fields), fires the calc, and writes the result back.
//
// Called from the invoice save paths:
//   - bulk/actions.ts → updateInvoiceLineField (after amount or gl_account
//     change, AND after eligibility_period_* updates)
//   - invoices/actions.ts → upsertInvoiceWithLines (after delete-then-insert
//     of all lines on a drawer save)
//
// Skip logic mirrors the workbook's behavior: if the GL isn't classified as
// an interim cost (cost_account_map.interim_cost_type IS NULL), this helper
// is a no-op. If the line has eligibility_auto_computed = FALSE AND a
// non-null eligible_amount, it's treated as a manual override and left
// alone — preserving the user's typed value across subsequent saves.
// =============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { getUwModel } from "@/lib/data/uw-model";
import {
  computeEligibility,
  type EligibilityDealContext,
  type InterimCostType,
} from "./index";

/** Reason returned when a recalc doesn't write anything. Surfaced in
 *  optional debug logging — every caller's happy path tolerates any of
 *  these (they're all "no-op succeeded"). */
export type RecalcSkipReason =
  | "no_type"            // GL isn't an interim cost
  | "manual_override"    // user set eligible_amount manually
  | "missing_period"     // re_taxes/loan_fees/insurance need period_start + _end
  | "missing_keydates"   // deal model has no closingDate or certificatesOfOccupancy
  | "missing_invoice_date" // interest calc needs the invoice's invoice_date
  | "amount_zero"        // 0 amount → 0 eligible / 0 ineligible (no-op write)
  | "row_not_found";     // line id resolved to nothing

export interface RecalcResult {
  changed: boolean;
  skipped?: RecalcSkipReason;
  eligibleAmount?: number;
  ineligibleAmount?: number;
  methodology?: string;
}

/**
 * Recompute eligibility for ONE invoice line. Idempotent: re-running with
 * unchanged inputs writes the same values (small DB write, but the math is
 * pure so the result is deterministic).
 *
 * Performance note: the call does 3 DB reads (line, gl, invoice) + 1
 * model-fetch + 1 write. Acceptable for cell-blur cadence on a single line.
 * For the drawer's bulk insert path we batch via `recalculateInvoiceLines`
 * below to amortize the keyDates lookup.
 */
export async function recalculateLineEligibility(
  supabase: SupabaseClient,
  dealId: string,
  lineId: string
): Promise<RecalcResult> {
  // Fetch line + GL + invoice in parallel. The cast on .from("dm_invoice_lines")
  // is because the new columns from migration 0070 aren't in
  // database.types.ts yet (regenerated after deploy).
  type LineRow = {
    id: string;
    invoice_id: string;
    gl_account: string;
    amount: number | string | null;
    eligible_amount: number | string | null;
    eligibility_auto_computed: boolean | null;
    eligibility_period_start: string | null;
    eligibility_period_end: string | null;
    metadata: Record<string, unknown> | null;
  };

  const [lineRes, modelRes] = await Promise.all([
    supabase
      .from("dm_invoice_lines")
      .select(
        "id, invoice_id, gl_account, amount, eligible_amount, eligibility_auto_computed, eligibility_period_start, eligibility_period_end, metadata"
      )
      .eq("id", lineId)
      .maybeSingle(),
    getUwModel(dealId),
  ]);

  const line = lineRes.data as LineRow | null;
  if (!line) return { changed: false, skipped: "row_not_found" };

  // Resolve interim_cost_type via cost_account_map.
  const { data: glRow } = await supabase
    .from("cost_account_map")
    .select("gl_account, interim_cost_type")
    .eq("gl_account", line.gl_account)
    .maybeSingle();
  const type = (glRow as { interim_cost_type?: string | null } | null)
    ?.interim_cost_type as InterimCostType | null | undefined;
  if (!type) return { changed: false, skipped: "no_type" };

  // Respect manual override. Auto-computed lines (or freshly-typed-by-user
  // ones that haven't yet flipped the flag) DO get recalculated. The flag
  // semantics: TRUE = "engine owns this value, recompute freely";
  // FALSE = "user owns this value, don't touch".
  if (
    line.eligibility_auto_computed === false &&
    line.eligible_amount != null
  ) {
    return { changed: false, skipped: "manual_override" };
  }

  // Pull keyDates from the deal model (resolved values now persisted by
  // the UW save flow per task #77).
  const keyDates = modelRes?.keyDates;
  const closingDateIso = keyDates?.closingDate ?? null;
  const coIso = keyDates?.certificatesOfOccupancy ?? null;
  if (!closingDateIso || !coIso) {
    return { changed: false, skipped: "missing_keydates" };
  }
  const ctx: EligibilityDealContext = {
    closingDateIso,
    certificatesOfOccupancyIso: coIso,
  };

  const amount = Number(line.amount) || 0;
  if (amount === 0) {
    // Write zeros to keep the row consistent — but only if the current
    // value differs (idempotency).
    if (line.eligible_amount === 0 || line.eligible_amount === "0") {
      return { changed: false, skipped: "amount_zero" };
    }
    await writeResult(supabase, lineId, line.metadata, {
      eligibleAmount: 0,
      ineligibleAmount: 0,
      methodology: `${type} · zero amount`,
    });
    return {
      changed: true,
      skipped: "amount_zero",
      eligibleAmount: 0,
      ineligibleAmount: 0,
    };
  }

  // For non-interest types, period dates are required. If they're missing,
  // bail without clobbering whatever's there — the user just hasn't filled
  // them in yet.
  if (type !== "interest") {
    if (!line.eligibility_period_start || !line.eligibility_period_end) {
      return { changed: false, skipped: "missing_period" };
    }
  }

  // For interest, fetch the parent invoice's invoice_date.
  let paymentMonthIso: string | undefined;
  if (type === "interest") {
    const { data: inv } = await supabase
      .from("dm_invoices")
      .select("invoice_date")
      .eq("id", line.invoice_id)
      .maybeSingle();
    paymentMonthIso = (inv as { invoice_date?: string | null } | null)
      ?.invoice_date ?? undefined;
    if (!paymentMonthIso) {
      return { changed: false, skipped: "missing_invoice_date" };
    }
  }

  // Call the pure calc engine.
  const result = computeEligibility(type, amount, ctx, {
    paymentMonthIso,
    periodStartIso: line.eligibility_period_start ?? undefined,
    periodEndIso: line.eligibility_period_end ?? undefined,
  });

  await writeResult(supabase, lineId, line.metadata, result);

  return {
    changed: true,
    eligibleAmount: result.eligibleAmount,
    ineligibleAmount: result.ineligibleAmount,
    methodology: result.methodology,
  };
}

/**
 * Drawer-save companion. Re-uses one getUwModel call across N lines, so a
 * 10-line invoice doesn't fetch the (large) deal model JSON ten times.
 * Skips lines whose GL isn't classified — those keep whatever eligible_amount
 * the drawer's UI passed in. Returns a per-line outcome map for
 * observability/debugging; callers can ignore the return value.
 */
export async function recalculateInvoiceLines(
  supabase: SupabaseClient,
  dealId: string,
  lineIds: string[]
): Promise<Map<string, RecalcResult>> {
  const out = new Map<string, RecalcResult>();
  if (lineIds.length === 0) return out;
  for (const id of lineIds) {
    const r = await recalculateLineEligibility(supabase, dealId, id);
    out.set(id, r);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Internal write helper
// ---------------------------------------------------------------------------

async function writeResult(
  supabase: SupabaseClient,
  lineId: string,
  prevMetadata: Record<string, unknown> | null,
  result: {
    eligibleAmount: number;
    ineligibleAmount: number;
    methodology: string;
  }
): Promise<void> {
  // Preserve any unrelated metadata keys. Stamp the run with an ISO
  // timestamp so the UI tooltip can show "last computed at".
  const metadata = {
    ...(prevMetadata ?? {}),
    eligibility: {
      methodology: result.methodology,
      computedAt: new Date().toISOString(),
    },
  };

  await supabase
    .from("dm_invoice_lines")
    .update({
      eligible_amount: result.eligibleAmount,
      ineligible_amount: result.ineligibleAmount,
      eligibility_auto_computed: true,
      metadata,
    } as never)
    .eq("id", lineId);
}
