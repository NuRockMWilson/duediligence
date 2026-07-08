// =============================================================================
// Due-diligence readiness rollup
// =============================================================================
// Coverage % for a deal's canonical (NuRock-standard) checklist, mirroring the
// lien-waiver rollup shape. "Covered" = an item that is approved. Items marked
// `waived` or `na` are removed from the DENOMINATOR (a legitimately N/A item
// shouldn't inflate or deflate readiness) — but they're counted separately so
// the UI can show "40/45 approved · 3 N/A". Per-financier coverage (through the
// crosswalk) arrives in Increment 2; this is the NuRock-standard view that the
// dashboards + checklist header read today.
// =============================================================================

import { createClient } from "@/lib/supabase/server";

export type DiligenceStatus =
  | "not_started"
  | "in_progress"
  | "submitted"
  | "approved"
  | "waived"
  | "na";

export interface DiligenceAssigneeLoad {
  userId: string;
  name: string;
  outstanding: number;
}

export interface DiligenceRollup {
  /** All instantiated deal-items. */
  total: number;
  /** Required items still in play (excludes waived + na). The denominator. */
  applicable: number;
  approved: number;
  submitted: number;
  inProgress: number;
  notStarted: number;
  waivedCount: number;
  naCount: number;
  /** applicable − approved. */
  outstandingCount: number;
  /** Items past due that aren't approved/waived/na. */
  overdueCount: number;
  /** approved / applicable * 100 (100 when nothing is applicable). */
  coveragePct: number;
  allClear: boolean;
  byAssignee: DiligenceAssigneeLoad[];
}

/** Minimal row shape the rollup needs (also reused by the checklist fetch). */
export interface RollupItemRow {
  status: DiligenceStatus;
  isRequired: boolean;
  dueDate: string | null;
  assigneeUserId: string | null;
  assigneeName: string | null;
}

const COVERED = new Set<DiligenceStatus>(["approved"]);
const EXCLUDED_FROM_DENOM = new Set<DiligenceStatus>(["waived", "na"]);

/** Pure rollup over already-fetched rows — shared by checklist + dashboards. */
export function computeDiligenceRollup(
  rows: RollupItemRow[],
  todayIso: string
): DiligenceRollup {
  let approved = 0;
  let submitted = 0;
  let inProgress = 0;
  let notStarted = 0;
  let waivedCount = 0;
  let naCount = 0;
  let applicable = 0;
  let overdueCount = 0;

  const loadByUser = new Map<string, DiligenceAssigneeLoad>();

  for (const r of rows) {
    switch (r.status) {
      case "approved": approved++; break;
      case "submitted": submitted++; break;
      case "in_progress": inProgress++; break;
      case "not_started": notStarted++; break;
      case "waived": waivedCount++; break;
      case "na": naCount++; break;
    }

    const inDenom = r.isRequired && !EXCLUDED_FROM_DENOM.has(r.status);
    if (inDenom) applicable++;

    const outstanding = inDenom && !COVERED.has(r.status);
    if (outstanding) {
      if (r.dueDate && r.dueDate < todayIso) overdueCount++;
      if (r.assigneeUserId) {
        const existing = loadByUser.get(r.assigneeUserId);
        if (existing) existing.outstanding++;
        else
          loadByUser.set(r.assigneeUserId, {
            userId: r.assigneeUserId,
            name: r.assigneeName ?? "Unassigned",
            outstanding: 1,
          });
      }
    }
  }

  const outstandingCount = Math.max(applicable - approved, 0);
  const coveragePct =
    applicable === 0 ? 100 : Math.round((approved / applicable) * 100);

  return {
    total: rows.length,
    applicable,
    approved,
    submitted,
    inProgress,
    notStarted,
    waivedCount,
    naCount,
    outstandingCount,
    overdueCount,
    coveragePct,
    allClear: outstandingCount === 0,
    byAssignee: Array.from(loadByUser.values()).sort(
      (a, b) => b.outstanding - a.outstanding
    ),
  };
}

/**
 * Lean rollup fetch for dashboards (no document/notes payload). Joins the
 * assignee display name from app_users for the "outstanding by owner" list.
 */
export async function getDiligenceRollup(
  dealId: string
): Promise<DiligenceRollup> {
  const supabase = await createClient();

  // dm_diligence_* aren't in the generated types yet — same untyped-accessor
  // pattern as lien-waiver-rollup.ts. Drop the cast after regenerating types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: itemRows } = await (supabase as any)
    .from("dm_diligence_deal_items")
    .select("status, is_required, due_date, assignee_user_id")
    .eq("deal_id", dealId);

  type Raw = {
    status: DiligenceStatus;
    is_required: boolean;
    due_date: string | null;
    assignee_user_id: string | null;
  };
  const raw = (itemRows ?? []) as Raw[];

  // Resolve assignee names in one fetch.
  const userIds = Array.from(
    new Set(raw.map((r) => r.assignee_user_id).filter((id): id is string => !!id))
  );
  const nameByUser = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: users } = await supabase
      .from("app_users")
      .select("user_id, display_name, email")
      .in("user_id", userIds);
    for (const u of (users ?? []) as Array<{
      user_id: string;
      display_name: string | null;
      email: string | null;
    }>) {
      nameByUser.set(u.user_id, u.display_name ?? u.email ?? "Team member");
    }
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  return computeDiligenceRollup(
    raw.map((r) => ({
      status: r.status,
      isRequired: r.is_required,
      dueDate: r.due_date,
      assigneeUserId: r.assignee_user_id,
      assigneeName: r.assignee_user_id
        ? nameByUser.get(r.assignee_user_id) ?? null
        : null,
    })),
    todayIso
  );
}

export interface DealReadiness {
  coveragePct: number;
  outstandingCount: number;
  overdueCount: number;
  total: number;
}

/**
 * One-query readiness summary for EVERY deal — feeds the portfolio dashboard's
 * per-deal readiness bar without N round-trips. Deals with no instantiated
 * items are simply absent from the map (the UI shows a neutral state).
 */
export async function getDiligenceReadinessByDeal(): Promise<
  Map<string, DealReadiness>
> {
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from("dm_diligence_deal_items")
    .select("deal_id, status, is_required, due_date");

  type Raw = {
    deal_id: string;
    status: DiligenceStatus;
    is_required: boolean;
    due_date: string | null;
  };
  const byDeal = new Map<string, RollupItemRow[]>();
  for (const r of (data ?? []) as Raw[]) {
    const arr = byDeal.get(r.deal_id) ?? [];
    arr.push({
      status: r.status,
      isRequired: r.is_required,
      dueDate: r.due_date,
      assigneeUserId: null,
      assigneeName: null,
    });
    byDeal.set(r.deal_id, arr);
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const out = new Map<string, DealReadiness>();
  for (const [dealId, rows] of byDeal) {
    const r = computeDiligenceRollup(rows, todayIso);
    out.set(dealId, {
      coveragePct: r.coveragePct,
      outstandingCount: r.outstandingCount,
      overdueCount: r.overdueCount,
      total: r.total,
    });
  }
  return out;
}

// =============================================================================
// Per-financier coverage (Increment 2) — computed THROUGH the crosswalk.
// =============================================================================
// For each external template the deal has adopted, an external item is
// "satisfied" when its mapped canonical item(s) are approved, per the item's
// requirement_mode ('all' = every mapped canonical approved; 'any' = at least
// one). External items with NO crosswalk mapping count as outstanding and are
// flagged `unmapped` — a real LIHTC gap (a lender requirement NuRock standard
// doesn't capture), never hidden as 0/0 = 100%.
// =============================================================================

export type FinancierCoverageItemState = "satisfied" | "outstanding" | "unmapped";

export interface FinancierCoverageItem {
  itemNumber: number | null;
  title: string;
  category: string;
  /** satisfied = mapped canonical requirement met; outstanding = mapped but
   *  not yet approved; unmapped = no NuRock-standard crosswalk yet. */
  state: FinancierCoverageItemState;
}

export interface FinancierCoverage {
  templateId: string;
  name: string;
  kind: string;
  financierName: string | null;
  /** External items considered (excludes section headers). */
  total: number;
  satisfied: number;
  unmappedCount: number;
  coveragePct: number;
  /** Per-item detail — powers the per-financier packet export (the lender's own
   *  item list with satisfied state). Aggregate consumers can ignore it. */
  items: FinancierCoverageItem[];
}

export async function getDiligenceFinancierCoverage(
  dealId: string
): Promise<FinancierCoverage[]> {
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  // Adopted, active, non-canonical templates for this deal.
  const { data: adopted } = await sb
    .from("dm_diligence_deal_templates")
    .select(
      `template_id,
       nurock_diligence_templates ( id, name, template_kind, financier_name, is_canonical, is_active )`
    )
    .eq("deal_id", dealId);

  type AdoptedRow = {
    template_id: string;
    nurock_diligence_templates: {
      id: string;
      name: string;
      template_kind: string;
      financier_name: string | null;
      is_canonical: boolean;
      is_active: boolean;
    } | null;
  };
  const externalTemplates = ((adopted ?? []) as AdoptedRow[])
    .map((a) => a.nurock_diligence_templates)
    .filter(
      (t): t is NonNullable<AdoptedRow["nurock_diligence_templates"]> =>
        !!t && !t.is_canonical && t.is_active
    );
  if (externalTemplates.length === 0) return [];

  const externalTemplateIds = externalTemplates.map((t) => t.id);

  const [{ data: extItems }, { data: canonicalItems }] = await Promise.all([
    sb
      .from("nurock_diligence_items")
      .select("id, template_id, item_number, category, title, item_type, is_active")
      .in("template_id", externalTemplateIds),
    sb
      .from("dm_diligence_deal_items")
      .select("item_id, status")
      .eq("deal_id", dealId),
  ]);

  type ExtItem = {
    id: string;
    template_id: string;
    item_number: number | null;
    category: string;
    title: string;
    item_type: string;
    is_active: boolean;
  };
  const externalItems = ((extItems ?? []) as ExtItem[]).filter(
    (i) => i.is_active && i.item_type !== "section_header"
  );
  const externalItemIds = externalItems.map((i) => i.id);

  // Crosswalk rows touching these external items.
  const { data: xwalk } =
    externalItemIds.length > 0
      ? await sb
          .from("nurock_diligence_crosswalk")
          .select("canonical_item_id, external_item_id, requirement_mode")
          .in("external_item_id", externalItemIds)
      : { data: [] };

  type Xwalk = {
    canonical_item_id: string;
    external_item_id: string;
    requirement_mode: "all" | "any";
  };
  const mappingByExternal = new Map<
    string,
    { canonical: string[]; mode: "all" | "any" }
  >();
  for (const x of (xwalk ?? []) as Xwalk[]) {
    const m = mappingByExternal.get(x.external_item_id) ?? {
      canonical: [],
      mode: x.requirement_mode,
    };
    m.canonical.push(x.canonical_item_id);
    m.mode = x.requirement_mode; // consistent per external item by convention
    mappingByExternal.set(x.external_item_id, m);
  }

  // Canonical approval state by item_id.
  const approvedCanonical = new Set<string>();
  for (const c of (canonicalItems ?? []) as Array<{
    item_id: string;
    status: DiligenceStatus;
  }>) {
    if (c.status === "approved") approvedCanonical.add(c.item_id);
  }

  const itemsByTemplate = new Map<string, ExtItem[]>();
  for (const i of externalItems) {
    const arr = itemsByTemplate.get(i.template_id) ?? [];
    arr.push(i);
    itemsByTemplate.set(i.template_id, arr);
  }

  return externalTemplates
    .map((t) => {
      const templateItems = itemsByTemplate.get(t.id) ?? [];
      const detailItems: FinancierCoverageItem[] = templateItems.map((item) => {
        const mapping = mappingByExternal.get(item.id);
        let state: FinancierCoverageItemState;
        if (!mapping || mapping.canonical.length === 0) {
          state = "unmapped";
        } else {
          const ok =
            mapping.mode === "any"
              ? mapping.canonical.some((c) => approvedCanonical.has(c))
              : mapping.canonical.every((c) => approvedCanonical.has(c));
          state = ok ? "satisfied" : "outstanding";
        }
        return {
          itemNumber: item.item_number,
          title: item.title,
          category: item.category,
          state,
        };
      });
      const total = detailItems.length;
      const satisfied = detailItems.filter((i) => i.state === "satisfied").length;
      const unmapped = detailItems.filter((i) => i.state === "unmapped").length;
      return {
        templateId: t.id,
        name: t.name,
        kind: t.template_kind,
        financierName: t.financier_name,
        total,
        satisfied,
        unmappedCount: unmapped,
        coveragePct: total === 0 ? 100 : Math.round((satisfied / total) * 100),
        items: detailItems,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
