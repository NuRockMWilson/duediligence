import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Returns a Record mapping funding_source_id -> released_amount, where
 * released_amount = sum of tranche amounts whose status is 'released'
 * for sources that have any tranches at all. Sources with no tranches
 * are NOT in the returned map — caller should fall back to commitment_amount.
 */
export async function getReleasedBySource(
  supabase: SupabaseClient,
  sourceIds: string[]
): Promise<Record<string, number>> {
  if (!sourceIds.length) return {};
  const { data: tranches } = await supabase
    .from("dm_funding_source_tranches")
    .select("funding_source_id, amount, status")
    .in("funding_source_id", sourceIds);

  const sourcesWithTranches = new Set<string>();
  const releasedTotal: Record<string, number> = {};
  for (const t of tranches ?? []) {
    sourcesWithTranches.add(t.funding_source_id);
    if (t.status === "released") {
      releasedTotal[t.funding_source_id] =
        (releasedTotal[t.funding_source_id] ?? 0) + Number(t.amount);
    }
  }
  // Make sure sources WITH tranches but no released ones get 0 (not undefined)
  for (const sid of sourcesWithTranches) {
    if (!(sid in releasedTotal)) releasedTotal[sid] = 0;
  }
  return releasedTotal;
}

/**
 * Given a source's commitment + a possibly-undefined released amount from
 * the tranche table, return the effective "available pool" — released when
 * tranches exist, full commitment otherwise.
 */
export function effectiveReleased(
  commitmentAmount: number,
  releasedFromTranches: number | undefined
): number {
  return releasedFromTranches !== undefined
    ? releasedFromTranches
    : commitmentAmount;
}
