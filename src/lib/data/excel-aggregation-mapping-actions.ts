"use server";

// =============================================================================
// Excel Aggregation Mapping — Server Actions (Phase 8.12)
// -----------------------------------------------------------------------------
// All mutations to the excel_aggregation_mapping table + the bulk realign
// loop live here. Separated from the reads/types module
// (`excel-aggregation-mapping.ts`) so client components can import types
// without dragging the next/headers-using Supabase server client through
// the client bundler.
//
// Client components import these directly:
//   import { addUwDescription, removeUwDescription, updateRowFields,
//     bulkRealignAffectedDeals } from "@/lib/data/excel-aggregation-mapping-actions";
//
// Each action revalidates the settings page on success. bulkRealignAffectedDeals
// additionally revalidates the portfolio + every affected deal's schedule.
// =============================================================================

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  getMappingByItemNumber,
  getUwDescriptionIndex,
  getDealsAffectedByMappingChange,
  type ExcelMappingRow,
  type MutationResult,
  type BulkRealignResult,
} from "./excel-aggregation-mapping";

// -----------------------------------------------------------------------------
// addUwDescription
// -----------------------------------------------------------------------------

/**
 * Append a UW description to a row's uw_descriptions array.
 * No-op if the description is already mapped to this row.
 * Fails if the description is already mapped to a DIFFERENT row (caller must
 * remove from old row first).
 */
export async function addUwDescription(
  itemNumber: number,
  uwDescription: string
): Promise<MutationResult> {
  const supabase = await createClient();
  const trimmed = uwDescription.trim();
  if (!trimmed) return { ok: false, error: "Description cannot be empty" };

  const index = await getUwDescriptionIndex();
  const existingRows = index.get(trimmed);
  if (existingRows && existingRows.length > 0) {
    const conflict = existingRows.find((r) => r.excel_item_number !== itemNumber);
    if (conflict) {
      return {
        ok: false,
        error: `"${trimmed}" is already mapped to Row ${conflict.excel_item_number} (${conflict.excel_description}). Remove it there first.`,
      };
    }
    // Already on the target row — no-op.
    const row = existingRows[0];
    return { ok: true, row };
  }

  const current = await getMappingByItemNumber(itemNumber);
  if (!current) {
    return { ok: false, error: `Row ${itemNumber} not found` };
  }

  const next = [...(current.uw_descriptions ?? []), trimmed];
  const { data, error } = await (supabase as any)
    .from("excel_aggregation_mapping")
    .update({ uw_descriptions: next })
    .eq("excel_item_number", itemNumber)
    .select("*")
    .single();

  if (error) {
    return { ok: false, error: error.message };
  }
  revalidatePath("/settings/excel-mapping");
  return { ok: true, row: data as ExcelMappingRow };
}

// -----------------------------------------------------------------------------
// removeUwDescription
// -----------------------------------------------------------------------------

/**
 * Remove a UW description from a row's uw_descriptions array.
 */
export async function removeUwDescription(
  itemNumber: number,
  uwDescription: string
): Promise<MutationResult> {
  const supabase = await createClient();
  const current = await getMappingByItemNumber(itemNumber);
  if (!current) {
    return { ok: false, error: `Row ${itemNumber} not found` };
  }
  const next = (current.uw_descriptions ?? []).filter((d) => d !== uwDescription);
  if (next.length === (current.uw_descriptions ?? []).length) {
    return {
      ok: false,
      error: `"${uwDescription}" not found on Row ${itemNumber}`,
    };
  }

  const { data, error } = await (supabase as any)
    .from("excel_aggregation_mapping")
    .update({ uw_descriptions: next })
    .eq("excel_item_number", itemNumber)
    .select("*")
    .single();

  if (error) {
    return { ok: false, error: error.message };
  }
  revalidatePath("/settings/excel-mapping");
  return { ok: true, row: data as ExcelMappingRow };
}

// -----------------------------------------------------------------------------
// updateRowFields
// -----------------------------------------------------------------------------

/**
 * Update editable scalar fields on a mapping row.
 * Does NOT allow editing excel_item_number or excel_section (structural).
 */
export async function updateRowFields(
  itemNumber: number,
  patch: {
    excel_description?: string;
    split_fraction?: number | null;
    notes?: string | null;
  }
): Promise<MutationResult> {
  const supabase = await createClient();

  // Validate split_fraction if provided.
  if (patch.split_fraction !== undefined && patch.split_fraction !== null) {
    if (patch.split_fraction <= 0 || patch.split_fraction > 1) {
      return {
        ok: false,
        error: "Split fraction must be between 0 (exclusive) and 1 (inclusive), or null.",
      };
    }
  }

  // Validate excel_description if provided.
  if (patch.excel_description !== undefined) {
    const trimmed = patch.excel_description.trim();
    if (!trimmed) {
      return { ok: false, error: "Description cannot be empty" };
    }
    patch.excel_description = trimmed;
  }

  const { data, error } = await (supabase as any)
    .from("excel_aggregation_mapping")
    .update(patch)
    .eq("excel_item_number", itemNumber)
    .select("*")
    .single();

  if (error) {
    return { ok: false, error: error.message };
  }
  revalidatePath("/settings/excel-mapping");
  return { ok: true, row: data as ExcelMappingRow };
}

// -----------------------------------------------------------------------------
// bulkRealignAffectedDeals
// -----------------------------------------------------------------------------

/**
 * Loop through every deal currently out of sync with the mapping and call
 * realign_deal_to_excel_format on each. Manual overrides are preserved by
 * v7 of the realign function (Phase 8.11). Returns per-deal results so the
 * UI can show a summary.
 */
export async function bulkRealignAffectedDeals(): Promise<BulkRealignResult> {
  const supabase = await createClient();
  const affected = await getDealsAffectedByMappingChange();

  const result: BulkRealignResult = {
    total_attempted: affected.length,
    succeeded: [],
    failed: [],
  };

  for (const deal of affected) {
    if (deal.status === "never_promoted") {
      // Skip — realign has nothing to align to in dev-mgmt yet.
      result.failed.push({
        deal_id: deal.deal_id,
        deal_name: deal.deal_name,
        error: "Deal has not yet been promoted to dev-mgmt",
      });
      continue;
    }

    const { error } = await (supabase as any).rpc("realign_deal_to_excel_format", {
      p_deal_id: deal.deal_id,
      p_dry_run: false,
    });

    if (error) {
      result.failed.push({
        deal_id: deal.deal_id,
        deal_name: deal.deal_name,
        error: error.message ?? "Unknown realign error",
      });
    } else {
      result.succeeded.push({
        deal_id: deal.deal_id,
        deal_name: deal.deal_name,
      });
    }
  }

  // Revalidate settings + portfolio + every affected deal's schedule so the
  // status indicators refresh.
  revalidatePath("/settings/excel-mapping");
  revalidatePath("/");
  for (const deal of result.succeeded) {
    revalidatePath(`/deals/${deal.deal_id}/schedule`);
  }

  return result;
}
