import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Fetch the primary schedule's id for a deal — the one used by the /schedule
 * view, active draw auto-mapping, and past-draw views. Returns null if the deal
 * has no schedule yet.
 */
export async function getPrimaryScheduleId(
  supabase: SupabaseClient,
  dealId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("dm_schedules")
    .select("id")
    .eq("deal_id", dealId)
    .eq("is_primary", true)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}
