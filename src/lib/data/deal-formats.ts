import { createClient } from "@/lib/supabase/server";
import { NUROCK_STANDARD_FORMAT_ID } from "@/lib/formats";

// Report-format inclusions for a deal. The operational draw schedule is always
// NuRock Standard; other formats are opt-in report views persisted in
// dm_deal_formats and generated into dm_draw_schedule_lines by realign.

export interface FormatInclusion {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  hasDefinitions: boolean; // false → format has no schedule-line defs yet
  included: boolean;
}

export interface FormatReportRow {
  id: string;
  itemNumber: number | null;
  section: string;
  description: string;
  originalBudget: number;
  revisedBudget: number;
  lineType: "detail" | "total";
}

export async function getFormatInclusionState(
  dealId: string
): Promise<FormatInclusion[]> {
  const supabase = await createClient();

  const [formatsRes, defsRes, inclRes] = await Promise.all([
    supabase
      .from("nurock_schedule_formats")
      .select("id, slug, name, description, is_default, sort_order")
      .order("sort_order", { ascending: true }),
    supabase.from("nurock_standard_schedule_lines").select("format_id"),
    supabase.from("dm_deal_formats").select("format_id").eq("deal_id", dealId),
  ]);

  const withDefs = new Set(
    (defsRes.data ?? []).map((r: { format_id: string }) => r.format_id)
  );
  const includedIds = new Set(
    ((inclRes.data ?? []) as { format_id: string }[]).map((r) => r.format_id)
  );

  return (formatsRes.data ?? []).map((f) => ({
    id: f.id,
    slug: f.slug,
    name: f.name,
    description: f.description,
    isDefault: Boolean(f.is_default),
    hasDefinitions: withDefs.has(f.id),
    included: f.is_default ? true : includedIds.has(f.id),
  }));
}

export async function getFormatScheduleRows(
  dealId: string,
  formatId: string
): Promise<FormatReportRow[]> {
  const supabase = await createClient();

  // The default (NuRock Standard) format is the operational schedule and lives
  // in dm_draw_schedule_lines. Every other (report) format lives in the
  // separate dm_report_schedule_lines.
  type RawRow = {
    id: string;
    item_number: number | null;
    section: string;
    description: string;
    original_budget: number | null;
    revised_budget: number | null;
  };

  let rows: RawRow[] = [];
  if (formatId === NUROCK_STANDARD_FORMAT_ID) {
    const { data } = await supabase
      .from("dm_draw_schedule_lines")
      .select("id, item_number, section, description, original_budget, revised_budget")
      .eq("deal_id", dealId)
      .eq("format_id", formatId)
      .lt("item_number", 10000)
      .order("item_number", { ascending: true });
    rows = (data ?? []) as RawRow[];
  } else {
    const { data } = await supabase
      .from("dm_report_schedule_lines")
      .select("id, item_number, section, description, original_budget, revised_budget")
      .eq("deal_id", dealId)
      .eq("format_id", formatId)
      .order("item_number", { ascending: true });
    rows = (data ?? []) as RawRow[];
  }

  // Format definition: which lines are totals + what each total sums.
  const [defLinesRes, membersRes] = await Promise.all([
    supabase
      .from("nurock_standard_schedule_lines")
      .select("id, line_number, line_type")
      .eq("format_id", formatId),
    supabase
      .from("nurock_schedule_line_members")
      .select("parent_line_id, member_line_id"),
  ]);

  const lineNumberById = new Map<string, number>();
  const lineTypeByNumber = new Map<number, "detail" | "total">();
  for (const l of defLinesRes.data ?? []) {
    lineNumberById.set(l.id, l.line_number);
    lineTypeByNumber.set(
      l.line_number,
      l.line_type === "total" ? "total" : "detail"
    );
  }
  // parent line_number → member line_numbers (within this format)
  const memberNumbersByParent = new Map<number, number[]>();
  for (const m of membersRes.data ?? []) {
    const pNum = lineNumberById.get(m.parent_line_id);
    const cNum = lineNumberById.get(m.member_line_id);
    if (pNum == null || cNum == null) continue;
    const arr = memberNumbersByParent.get(pNum) ?? [];
    arr.push(cNum);
    memberNumbersByParent.set(pNum, arr);
  }

  // Base (stored) amounts per line_number from the per-deal rows.
  const revisedBase = new Map<number, number>();
  const originalBase = new Map<number, number>();
  for (const r of rows) {
    if (r.item_number == null) continue;
    revisedBase.set(r.item_number, Number(r.revised_budget ?? 0));
    originalBase.set(r.item_number, Number(r.original_budget ?? 0));
  }

  // Totals = recursive sum of members (nesting allowed; cycle-guarded).
  const makeCompute = (base: Map<number, number>) => {
    const memo = new Map<number, number>();
    const fn = (num: number, visiting: Set<number>): number => {
      if (memo.has(num)) return memo.get(num)!;
      if (lineTypeByNumber.get(num) !== "total") {
        const v = base.get(num) ?? 0;
        memo.set(num, v);
        return v;
      }
      if (visiting.has(num)) return 0; // cyclic reference — bail
      visiting.add(num);
      const sum = (memberNumbersByParent.get(num) ?? []).reduce(
        (s, m) => s + fn(m, visiting),
        0
      );
      visiting.delete(num);
      memo.set(num, sum);
      return sum;
    };
    return fn;
  };
  const computeRevised = makeCompute(revisedBase);
  const computeOriginal = makeCompute(originalBase);

  return rows.map((r) => {
    const num = r.item_number;
    const lineType =
      num != null ? lineTypeByNumber.get(num) ?? "detail" : "detail";
    const isTotal = lineType === "total" && num != null;
    return {
      id: r.id,
      itemNumber: r.item_number,
      section: r.section,
      description: r.description,
      originalBudget: isTotal
        ? computeOriginal(num as number, new Set())
        : Number(r.original_budget ?? 0),
      revisedBudget: isTotal
        ? computeRevised(num as number, new Set())
        : Number(r.revised_budget ?? 0),
      lineType,
    };
  });
}

export { NUROCK_STANDARD_FORMAT_ID };
