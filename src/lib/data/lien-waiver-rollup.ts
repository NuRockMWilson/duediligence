// =============================================================================
// Lien Waiver Rollup (Ship 4 r2)
// =============================================================================
// For a given draw, produces the per-vendor lien-waiver matrix the active-draw
// RequiredDocsCard + submit-gate need. The vendors in a draw are the distinct
// vendor_ids on the invoices included in that draw:
//
//   dm_draws → dm_draw_lines.invoice_id → dm_invoices.vendor_id
//
// Each vendor needs two waiver types per period: a CONDITIONAL waiver for the
// current draw and an UNCONDITIONAL waiver for the prior period. We surface
// the status of each, derived from dm_lien_waivers (one row per draw/vendor/
// type), defaulting to "pending" when no row exists yet.
// =============================================================================

import { createClient } from "@/lib/supabase/server";
import { classifyCoi, type CoiStatus } from "@/lib/finance/coi-status";

export type WaiverType = "conditional" | "unconditional";
export type WaiverStatus = "pending" | "requested" | "received" | "waived";

export interface VendorWaiverRow {
  vendorId: string;
  vendorName: string;
  /** Total $ this vendor's invoices contribute to the draw — context for
   *  prioritizing whose waiver matters most. */
  drawAmount: number;
  /** Ship 4 r3 — Certificate of Insurance status for this vendor. */
  coiStatus: CoiStatus;
  coiExpiresAt: string | null;
  conditional: {
    status: WaiverStatus;
    receivedAt: string | null;
    filePath: string | null;
    waiverId: string | null;
  };
  unconditional: {
    status: WaiverStatus;
    receivedAt: string | null;
    filePath: string | null;
    waiverId: string | null;
  };
}

export interface LienWaiverRollup {
  drawId: string;
  vendors: VendorWaiverRow[];
  /** Count of (vendor × type) slots not yet received OR waived. This is the
   *  number the submit-gate / RequiredDocsCard advisory keys off. */
  outstandingCount: number;
  /** True when every required waiver is received or explicitly waived. */
  allClear: boolean;
  /** Ship 4 r3 — count of draw vendors with an expired OR missing COI. */
  coiActionableCount: number;
  /** Count of draw vendors whose COI expires within COI_SOON_DAYS. */
  coiExpiringSoonCount: number;
}

const EMPTY_SLOT = {
  status: "pending" as WaiverStatus,
  receivedAt: null,
  filePath: null,
  waiverId: null,
};

export async function getLienWaiverRollup(
  dealId: string,
  drawId: string
): Promise<LienWaiverRollup> {
  const supabase = await createClient();

  // 1. Draw lines → invoice ids in this draw.
  const { data: drawLineRows } = await supabase
    .from("dm_draw_lines")
    .select("invoice_id")
    .eq("draw_id", drawId);

  const invoiceIds = Array.from(
    new Set(
      ((drawLineRows ?? []) as Array<{ invoice_id: string | null }>)
        .map((r) => r.invoice_id)
        .filter((id): id is string => !!id)
    )
  );

  if (invoiceIds.length === 0) {
    return {
      drawId,
      vendors: [],
      outstandingCount: 0,
      allClear: true,
      coiActionableCount: 0,
      coiExpiringSoonCount: 0,
    };
  }

  // 2. Those invoices → distinct vendors + each vendor's $ in the draw.
  const { data: invoiceRows } = await supabase
    .from("dm_invoices")
    .select("id, vendor_id, vendor_name, net_amount, gross_amount")
    .in("id", invoiceIds);

  type InvRow = {
    id: string;
    vendor_id: string | null;
    vendor_name: string | null;
    net_amount: number | string | null;
    gross_amount: number | string | null;
  };
  const vendorAgg = new Map<
    string,
    { vendorId: string; vendorName: string; drawAmount: number }
  >();
  for (const inv of (invoiceRows ?? []) as InvRow[]) {
    if (!inv.vendor_id) continue;
    const amt = Number(inv.net_amount ?? inv.gross_amount) || 0;
    const existing = vendorAgg.get(inv.vendor_id);
    if (existing) {
      existing.drawAmount += amt;
    } else {
      vendorAgg.set(inv.vendor_id, {
        vendorId: inv.vendor_id,
        vendorName: inv.vendor_name ?? "(unknown vendor)",
        drawAmount: amt,
      });
    }
  }

  // 3. Existing waiver rows for this draw.
  // Cast the client to `any` for dm_lien_waivers — the table was added in
  // migration 0072 and isn't in the generated database.types.ts yet. Same
  // pattern as reset-deal-to-uw.ts and other not-yet-regenerated tables.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: waiverRows } = await (supabase as any)
    .from("dm_lien_waivers")
    .select("id, vendor_id, waiver_type, status, received_at, file_path")
    .eq("draw_id", drawId);

  type WaiverRow = {
    id: string;
    vendor_id: string;
    waiver_type: WaiverType;
    status: WaiverStatus;
    received_at: string | null;
    file_path: string | null;
  };
  // Key: `${vendorId}:${waiverType}`
  const waiverByKey = new Map<string, WaiverRow>();
  for (const w of (waiverRows ?? []) as WaiverRow[]) {
    waiverByKey.set(`${w.vendor_id}:${w.waiver_type}`, w);
  }

  const slotOf = (vendorId: string, type: WaiverType) => {
    const w = waiverByKey.get(`${vendorId}:${type}`);
    if (!w) return { ...EMPTY_SLOT };
    return {
      status: w.status,
      receivedAt: w.received_at,
      filePath: w.file_path,
      waiverId: w.id,
    };
  };

  // 4. Ship 4 r3 — COI expiration per vendor. One fetch for all draw vendors.
  const vendorIds = Array.from(vendorAgg.keys());
  const { data: vendorCoiRows } = await supabase
    .from("dm_vendors")
    .select("id, coi_expires_at")
    .in("id", vendorIds);
  const coiByVendor = new Map<string, string | null>();
  for (const v of (vendorCoiRows ?? []) as Array<{
    id: string;
    coi_expires_at: string | null;
  }>) {
    coiByVendor.set(v.id, v.coi_expires_at);
  }
  const todayIso = new Date().toISOString().slice(0, 10);

  const vendors: VendorWaiverRow[] = Array.from(vendorAgg.values())
    .sort((a, b) => b.drawAmount - a.drawAmount)
    .map((v) => {
      const coiExpiresAt = coiByVendor.get(v.vendorId) ?? null;
      return {
        vendorId: v.vendorId,
        vendorName: v.vendorName,
        drawAmount: v.drawAmount,
        coiStatus: classifyCoi(coiExpiresAt, todayIso),
        coiExpiresAt,
        conditional: slotOf(v.vendorId, "conditional"),
        unconditional: slotOf(v.vendorId, "unconditional"),
      };
    });

  // 5. Tallies — waiver outstanding + COI issues.
  let outstandingCount = 0;
  let coiActionableCount = 0;
  let coiExpiringSoonCount = 0;
  for (const v of vendors) {
    for (const slot of [v.conditional, v.unconditional]) {
      if (slot.status !== "received" && slot.status !== "waived") {
        outstandingCount++;
      }
    }
    if (v.coiStatus === "expired" || v.coiStatus === "missing") {
      coiActionableCount++;
    } else if (v.coiStatus === "expiring_soon") {
      coiExpiringSoonCount++;
    }
  }

  return {
    drawId,
    vendors,
    outstandingCount,
    allClear: outstandingCount === 0,
    coiActionableCount,
    coiExpiringSoonCount,
  };
}
