// =============================================================================
// Excel Aggregation Mapping — Reads + Types (Phase 8.12)
// -----------------------------------------------------------------------------
// Single source of truth for the 32-row standard Excel layout.
//
// THIS FILE: types + server-side reads only. Safe to import types from client
// components — the actual read functions are server-only (they import
// next/headers via createClient), but TypeScript can tree-shake type-only
// imports out of client bundles.
//
// Mutations live in `./excel-aggregation-mapping-actions.ts` to keep the
// "use server" boundary clean. Client components must import actions from
// the actions file, not from here.
//
// Reads: getExcelMapping(), getMappingByItemNumber(), getUwDescriptionIndex(),
//   getMappingByExcelDescription() [legacy adapter for deal-schedule-rollup],
//   getOrphanUwDescriptions(), getDealsAffectedByMappingChange()
// =============================================================================

import { createClient } from "@/lib/supabase/server";

// -----------------------------------------------------------------------------
// Types — safe to import from client components (type-only imports tree-shake)
// -----------------------------------------------------------------------------

export type ExcelMappingRow = {
  excel_item_number: number; // 1..99
  excel_section: "soft_costs" | "construction_contract";
  excel_description: string;
  uw_descriptions: string[]; // case-sensitive match to UW line descriptions
  split_fraction: number | null; // null = full row; e.g. 0.3067 for Dev Fee OH/Fee
  notes: string | null;
};

export type OrphanUwDescription = {
  description: string;
  affected_deals: { deal_id: string; deal_name: string }[];
  occurrences: number;
};

export type DealAffectedByMapping = {
  deal_id: string;
  deal_name: string;
  status: "in_sync" | "pending_changes" | "never_promoted";
  total_variance: number;
  rows_with_variance: number;
};

export type MutationResult =
  | { ok: true; row: ExcelMappingRow }
  | { ok: false; error: string };

export type BulkRealignResult = {
  total_attempted: number;
  succeeded: { deal_id: string; deal_name: string }[];
  failed: { deal_id: string; deal_name: string; error: string }[];
};

// -----------------------------------------------------------------------------
// Reads
// -----------------------------------------------------------------------------

/**
 * Load the full 32-row mapping, ordered by excel_item_number.
 */
export async function getExcelMapping(): Promise<ExcelMappingRow[]> {
  const supabase = await createClient();
  const { data, error } = await (supabase as any)
    .from("excel_aggregation_mapping")
    .select("*")
    .order("excel_item_number", { ascending: true });

  if (error) {
    console.error("[excel-mapping] getExcelMapping error:", error);
    return [];
  }
  return (data ?? []) as ExcelMappingRow[];
}

/**
 * Fetch a single mapping row by its excel_item_number.
 */
export async function getMappingByItemNumber(
  itemNumber: number
): Promise<ExcelMappingRow | null> {
  const supabase = await createClient();
  const { data, error } = await (supabase as any)
    .from("excel_aggregation_mapping")
    .select("*")
    .eq("excel_item_number", itemNumber)
    .maybeSingle();

  if (error) {
    console.error("[excel-mapping] getMappingByItemNumber error:", error);
    return null;
  }
  return (data ?? null) as ExcelMappingRow | null;
}

/**
 * Inverse index: UW description -> Excel row(s) it maps into.
 * Used by promote + realign + orphan detection.
 */
export async function getUwDescriptionIndex(): Promise<
  Map<string, ExcelMappingRow[]>
> {
  const rows = await getExcelMapping();
  const index = new Map<string, ExcelMappingRow[]>();
  for (const row of rows) {
    for (const desc of row.uw_descriptions ?? []) {
      const existing = index.get(desc) ?? [];
      existing.push(row);
      index.set(desc, existing);
    }
  }
  return index;
}

// -----------------------------------------------------------------------------
// Legacy adapter — keyed-by-Excel-description map
// -----------------------------------------------------------------------------

/**
 * Shape used by deal-schedule-rollup.ts for the aggregation lookup. The keys
 * are Excel descriptions (e.g. "Developer Fee — OH/Fee During Construction"),
 * and each value carries the list of UW descriptions that roll into it plus an
 * optional split fraction (e.g. 0.3067 for the Developer Fee split rows).
 *
 * `splitFraction` is `undefined` (NOT `null`) when no split applies — caller
 * compares with `!== undefined`.
 */
export type LegacyMappingByDescription = Record<
  string,
  { uwDescriptions: string[]; splitFraction: number | undefined }
>;

/**
 * Build a description-keyed map of the 32-row standard mapping for use by
 * the schedule rollup (`deal-schedule-rollup.ts`). Camel-cases the snake_case
 * DB columns and converts `null` split fractions to `undefined` so existing
 * `split !== undefined` checks downstream continue to work.
 */
export async function getMappingByExcelDescription(): Promise<LegacyMappingByDescription> {
  const rows = await getExcelMapping();
  const result: LegacyMappingByDescription = {};
  for (const row of rows) {
    result[row.excel_description] = {
      uwDescriptions: row.uw_descriptions ?? [],
      splitFraction: row.split_fraction ?? undefined,
    };
  }
  return result;
}

// -----------------------------------------------------------------------------
// Orphan detection
// -----------------------------------------------------------------------------

/**
 * Returns UW line descriptions that appear in any deal's constructionBudget
 * but are NOT mapped to any Excel row. Includes the deals each orphan
 * appears in for click-to-map UX.
 *
 * Excludes UW lines that are explicitly skip-listed (e.g. zero-amount
 * placeholder rows in the UW model with no description, or descriptions
 * that look like section headers).
 */
export async function getOrphanUwDescriptions(): Promise<OrphanUwDescription[]> {
  const supabase = await createClient();

  // Pull all deals' constructionBudget arrays from deals.model.
  const { data: deals, error } = await (supabase as any)
    .from("deals")
    .select("id, name, model")
    .order("name", { ascending: true });

  if (error) {
    console.error("[excel-mapping] getOrphanUwDescriptions error:", error);
    return [];
  }

  const index = await getUwDescriptionIndex();

  // description -> deals[]
  const orphanMap = new Map<
    string,
    { affected_deals: { deal_id: string; deal_name: string }[]; occurrences: number }
  >();

  for (const deal of (deals ?? []) as Array<{ id: string; name: string; model: any }>) {
    const cb: Array<{ id: string; description?: string }> =
      deal.model?.constructionBudget ?? [];
    const seenInThisDeal = new Set<string>();
    for (const line of cb) {
      const desc = (line.description ?? "").trim();
      if (!desc) continue;
      if (isLikelySectionHeader(desc)) continue;
      if (index.has(desc)) continue; // mapped — not orphan
      if (seenInThisDeal.has(desc)) continue;
      seenInThisDeal.add(desc);

      const entry = orphanMap.get(desc) ?? { affected_deals: [], occurrences: 0 };
      entry.affected_deals.push({ deal_id: deal.id, deal_name: deal.name });
      entry.occurrences += 1;
      orphanMap.set(desc, entry);
    }
  }

  const result: OrphanUwDescription[] = [];
  for (const [description, entry] of orphanMap.entries()) {
    result.push({
      description,
      affected_deals: entry.affected_deals,
      occurrences: entry.occurrences,
    });
  }
  // Most-occurring orphans first.
  result.sort((a, b) => b.occurrences - a.occurrences || a.description.localeCompare(b.description));
  return result;
}

function isLikelySectionHeader(desc: string): boolean {
  // Heuristic: ALL CAPS strings with no digits are likely section labels.
  if (desc.length < 3) return true;
  const upper = desc === desc.toUpperCase() && /[A-Z]/.test(desc);
  const hasDigit = /\d/.test(desc);
  return upper && !hasDigit && desc.length < 40;
}

// -----------------------------------------------------------------------------
// Affected deals after a mapping edit
// -----------------------------------------------------------------------------

/**
 * After any edit to the mapping table, returns the deals whose schedules
 * are now out of sync with the new mapping. Powers the amber banner +
 * "Realign Now" workflow on the settings page.
 *
 * Two-step query because deal_promote_status may not include deal_name:
 *   1. Pull non-in_sync rows from deal_promote_status
 *   2. Join to deals for human-readable names
 */
export async function getDealsAffectedByMappingChange(): Promise<
  DealAffectedByMapping[]
> {
  const supabase = await createClient();
  const { data: statusRows, error: statusErr } = await (supabase as any)
    .from("deal_promote_status")
    .select("deal_id, status, total_variance, rows_with_variance")
    .neq("status", "in_sync");

  if (statusErr) {
    console.error("[excel-mapping] getDealsAffectedByMappingChange status error:", statusErr);
    return [];
  }
  if (!statusRows || statusRows.length === 0) return [];

  const dealIds = statusRows.map((r: any) => r.deal_id);
  const { data: dealRows, error: dealErr } = await (supabase as any)
    .from("deals")
    .select("id, name")
    .in("id", dealIds);

  if (dealErr) {
    console.error("[excel-mapping] getDealsAffectedByMappingChange deals error:", dealErr);
    return [];
  }
  const nameById = new Map<string, string>(
    (dealRows ?? []).map((d: any) => [d.id, d.name])
  );

  const result: DealAffectedByMapping[] = statusRows.map((r: any) => ({
    deal_id: r.deal_id,
    deal_name: nameById.get(r.deal_id) ?? r.deal_id,
    status: r.status,
    total_variance: Number(r.total_variance ?? 0),
    rows_with_variance: Number(r.rows_with_variance ?? 0),
  }));
  result.sort((a, b) => b.total_variance - a.total_variance);
  return result;
}
