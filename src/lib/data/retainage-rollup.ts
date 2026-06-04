// =============================================================================
// Retainage Rollup (Retainage module r1)
// =============================================================================
// Per-vendor retainage position for a deal:
//   withheld   = Σ dm_draw_lines.retainage_amount on SUBMITTED or FUNDED draws,
//                grouped by the line's invoice vendor (draft draws excluded —
//                retainage isn't "withheld" until the draw goes out)
//   billed     = Σ dm_draw_lines.gross_amount on those same lines (for the
//                blended effective retainage %)
//   released   = Σ dm_retainage_releases.amount per vendor
//   outstanding = withheld − released
//
// There is no contracts table, so the grouping dimension is the vendor. Draw
// lines with no invoice/vendor fall into an "Unassigned" bucket.
// =============================================================================

import { createClient } from "@/lib/supabase/server";

export interface RetainageVendorRow {
  key: string;
  vendorId: string | null;
  vendorName: string;
  billed: number;
  withheld: number;
  released: number;
  outstanding: number;
  /** Blended effective retainage rate = withheld / billed (%). */
  effectivePct: number;
  releaseCount: number;
}

export interface RetainageMilestone {
  id: string;
  label: string;
  kind: string;
  status: string;
  targetDate: string | null;
  actualDate: string | null;
  reached: boolean;
}

export interface RetainageRelease {
  id: string;
  vendorId: string | null;
  vendorName: string;
  amount: number;
  releaseDate: string | null;
  milestoneLabel: string | null;
  notes: string | null;
}

export interface RetainageRollup {
  vendors: RetainageVendorRow[];
  milestones: RetainageMilestone[];
  releases: RetainageRelease[];
  totals: {
    billed: number;
    withheld: number;
    released: number;
    outstanding: number;
    effectivePct: number;
  };
}

const UNASSIGNED = "Unassigned";

function vendorKey(vendorId: string | null, vendorName: string): string {
  if (vendorId) return vendorId;
  const n = vendorName.trim().toLowerCase();
  return n && n !== UNASSIGNED.toLowerCase() ? `name:${n}` : "unassigned";
}

export async function getRetainageRollup(dealId: string): Promise<RetainageRollup> {
  const supabase = await createClient();

  const [drawsRes, invoicesRes, releasesRes, milestonesRes] = await Promise.all([
    supabase.from("dm_draws").select("id, submitted_at, funded_at").eq("deal_id", dealId),
    supabase.from("dm_invoices").select("id, vendor_id, vendor_name").eq("deal_id", dealId),
    (supabase as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (c: string, v: string) => Promise<{ data: unknown }>;
        };
      };
    })
      .from("dm_retainage_releases")
      .select("id, vendor_id, vendor_name, amount, release_date, milestone_label, notes")
      .eq("deal_id", dealId),
    supabase
      .from("dm_milestones")
      .select("id, label, kind, status, target_date, actual_date, sort_order")
      .eq("deal_id", dealId)
      .order("sort_order", { ascending: true }),
  ]);

  // Committed draws = anything submitted or funded (drafts don't withhold yet).
  const committedDrawIds = ((drawsRes.data ?? []) as Array<{
    id: string;
    submitted_at: string | null;
    funded_at: string | null;
  }>)
    .filter((d) => d.submitted_at || d.funded_at)
    .map((d) => d.id);

  // invoice id → vendor
  const invVendor = new Map<string, { id: string | null; name: string }>();
  for (const inv of (invoicesRes.data ?? []) as Array<{
    id: string;
    vendor_id: string | null;
    vendor_name: string | null;
  }>) {
    invVendor.set(inv.id, { id: inv.vendor_id, name: inv.vendor_name || UNASSIGNED });
  }

  // Draw lines on committed draws.
  type Agg = { vendorId: string | null; vendorName: string; withheld: number; billed: number };
  const byVendor = new Map<string, Agg>();
  if (committedDrawIds.length > 0) {
    const { data: lines } = await supabase
      .from("dm_draw_lines")
      .select("invoice_id, retainage_amount, gross_amount")
      .in("draw_id", committedDrawIds);
    for (const dl of (lines ?? []) as Array<{
      invoice_id: string | null;
      retainage_amount: number | string | null;
      gross_amount: number | string | null;
    }>) {
      const v = dl.invoice_id ? invVendor.get(dl.invoice_id) : undefined;
      const vendorId = v?.id ?? null;
      const vendorName = v?.name ?? UNASSIGNED;
      const key = vendorKey(vendorId, vendorName);
      const agg = byVendor.get(key) ?? { vendorId, vendorName, withheld: 0, billed: 0 };
      agg.withheld += Number(dl.retainage_amount) || 0;
      agg.billed += Number(dl.gross_amount) || 0;
      byVendor.set(key, agg);
    }
  }

  // Released by vendor + the flat release list (for history / delete).
  const releasedByVendor = new Map<string, number>();
  const releaseCountByVendor = new Map<string, number>();
  const releaseNames = new Map<string, { vendorId: string | null; vendorName: string }>();
  const releases: RetainageRelease[] = [];
  for (const r of (releasesRes.data ?? []) as Array<{
    id: string;
    vendor_id: string | null;
    vendor_name: string | null;
    amount: number | string | null;
    release_date: string | null;
    milestone_label: string | null;
    notes: string | null;
  }>) {
    const vendorId = r.vendor_id ?? null;
    const vendorName = r.vendor_name || UNASSIGNED;
    const key = vendorKey(vendorId, vendorName);
    const amount = Number(r.amount) || 0;
    releasedByVendor.set(key, (releasedByVendor.get(key) ?? 0) + amount);
    releaseCountByVendor.set(key, (releaseCountByVendor.get(key) ?? 0) + 1);
    if (!releaseNames.has(key)) releaseNames.set(key, { vendorId, vendorName });
    releases.push({
      id: r.id,
      vendorId,
      vendorName,
      amount,
      releaseDate: r.release_date,
      milestoneLabel: r.milestone_label,
      notes: r.notes,
    });
  }
  releases.sort((a, b) => (b.releaseDate ?? "").localeCompare(a.releaseDate ?? ""));

  // Union of vendors that have withholding or releases.
  const keys = new Set<string>([...byVendor.keys(), ...releasedByVendor.keys()]);
  const vendors: RetainageVendorRow[] = [];
  for (const key of keys) {
    const agg = byVendor.get(key);
    const nameInfo = agg ?? releaseNames.get(key);
    const withheld = agg?.withheld ?? 0;
    const billed = agg?.billed ?? 0;
    const released = releasedByVendor.get(key) ?? 0;
    if (withheld <= 0 && released <= 0) continue;
    vendors.push({
      key,
      vendorId: nameInfo?.vendorId ?? null,
      vendorName: nameInfo?.vendorName ?? UNASSIGNED,
      billed,
      withheld,
      released,
      outstanding: withheld - released,
      effectivePct: billed > 0 ? (withheld / billed) * 100 : 0,
      releaseCount: releaseCountByVendor.get(key) ?? 0,
    });
  }
  // Largest outstanding first.
  vendors.sort((a, b) => b.outstanding - a.outstanding || b.withheld - a.withheld);

  const milestones: RetainageMilestone[] = ((milestonesRes.data ?? []) as Array<{
    id: string;
    label: string | null;
    kind: string | null;
    status: string | null;
    target_date: string | null;
    actual_date: string | null;
  }>).map((m) => {
    const status = (m.status ?? "").toLowerCase();
    return {
      id: m.id,
      label: m.label ?? "—",
      kind: m.kind ?? "",
      status: m.status ?? "",
      targetDate: m.target_date,
      actualDate: m.actual_date,
      reached: !!m.actual_date || /done|complete|reached|achieved/.test(status),
    };
  });

  const totals = vendors.reduce(
    (t, v) => {
      t.billed += v.billed;
      t.withheld += v.withheld;
      t.released += v.released;
      t.outstanding += v.outstanding;
      return t;
    },
    { billed: 0, withheld: 0, released: 0, outstanding: 0, effectivePct: 0 }
  );
  totals.effectivePct = totals.billed > 0 ? (totals.withheld / totals.billed) * 100 : 0;

  return { vendors, milestones, releases, totals };
}
