"use server";

// =============================================================================
// Diligence template admin actions (Increment 2)
// =============================================================================
// Create / retire templates, import an investor/lender checklist from Excel or
// CSV (parse → preview → commit), and manage the canonical↔external crosswalk.
// Spreadsheet parsing reuses the `xlsx` server-side pattern from the invoice
// import. Untyped accessor for the not-yet-typed nurock_diligence_* tables.
// =============================================================================

import { revalidatePath } from "next/cache";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/server";
import { logDiligenceEvent } from "@/lib/diligence/audit";
import { assertDiligenceCan } from "@/lib/auth/access";
import { describeDbError } from "@/lib/diligence/db-errors";
import { chunk, selectInChunks } from "@/lib/diligence/chunk";
import {
  getTemplateDetail,
  type TemplateKind,
  type TemplateDetail,
} from "@/lib/data/diligence-templates";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySb = any;

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${base || "template"}-${crypto.randomUUID().slice(0, 6)}`;
}

function revalidateTemplates() {
  revalidatePath("/settings/diligence-templates");
}

/** Client-callable wrapper around the read layer (for the detail drawer). */
export async function loadTemplateDetail(
  templateId: string
): Promise<TemplateDetail | null> {
  await assertDiligenceCan("view");
  return getTemplateDetail(templateId);
}

// -----------------------------------------------------------------------------
// Create / retire templates
// -----------------------------------------------------------------------------
export async function createDiligenceTemplate(input: {
  name: string;
  kind: TemplateKind;
  financierName: string | null;
  description: string | null;
}): Promise<{ id?: string; error?: string }> {
  await assertDiligenceCan("edit");
  const name = input.name.trim();
  if (!name) return { error: "Template name is required." };
  if (input.kind === "nurock_standard")
    return { error: "Only one canonical template is allowed." };

  const supabase = (await createClient()) as AnySb;
  const { data, error } = await supabase
    .from("nurock_diligence_templates")
    .insert({
      slug: slugify(name),
      name,
      description: input.description?.trim() || null,
      template_kind: input.kind,
      financier_name: input.financierName?.trim() || null,
      source: "manual",
      is_canonical: false,
      is_active: true,
    })
    .select("id")
    .single();
  if (error) return { error: describeDbError(error) };

  revalidateTemplates();
  return { id: (data as { id: string }).id };
}

export async function setDiligenceTemplateActive(input: {
  templateId: string;
  active: boolean;
}): Promise<{ error?: string }> {
  await assertDiligenceCan("edit");
  const supabase = (await createClient()) as AnySb;
  // Guard: never retire the canonical template.
  const { data: t } = await supabase
    .from("nurock_diligence_templates")
    .select("is_canonical")
    .eq("id", input.templateId)
    .maybeSingle();
  if (!input.active && (t as { is_canonical: boolean } | null)?.is_canonical) {
    return { error: "The canonical template can't be retired." };
  }
  // .select() so a zero-row update (e.g. RLS silently filtering the row)
  // fails loudly instead of toasting success without persisting.
  const { data: updated, error } = await supabase
    .from("nurock_diligence_templates")
    .update({ is_active: input.active, updated_at: new Date().toISOString() })
    .eq("id", input.templateId)
    .select("id");
  if (error) return { error: describeDbError(error) };
  if (!updated || (updated as unknown[]).length === 0) {
    return {
      error:
        "The change didn't persist — no row was updated. Check row-level security on nurock_diligence_templates.",
    };
  }
  revalidateTemplates();
  return {};
}

// -----------------------------------------------------------------------------
// Import — parse, then commit
// -----------------------------------------------------------------------------
export interface ParsedSheet {
  headers: string[];
  rows: string[][];
}

/** Parse an uploaded .xlsx/.csv into a header row + string data rows. */
export async function previewChecklistImport(
  formData: FormData
): Promise<{ sheet?: ParsedSheet; error?: string }> {
  await assertDiligenceCan("edit");
  const file = formData.get("file") as File | null;
  if (!file || !(file instanceof File)) return { error: "No file provided." };

  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buf, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) return { error: "The file has no readable sheet." };

    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      defval: null,
      raw: false,
    });

    // Find the header row: first row with >= 2 non-empty cells.
    let headerIdx = aoa.findIndex(
      (r) => r.filter((c) => c != null && String(c).trim() !== "").length >= 2
    );
    if (headerIdx < 0) headerIdx = 0;

    const headers = (aoa[headerIdx] ?? []).map((c, i) =>
      c != null && String(c).trim() !== "" ? String(c).trim() : `Column ${i + 1}`
    );
    const rows = aoa
      .slice(headerIdx + 1)
      .map((r) => headers.map((_, i) => (r[i] != null ? String(r[i]).trim() : "")))
      .filter((r) => r.some((c) => c !== ""));

    if (rows.length === 0)
      return { error: "No data rows found beneath the header." };

    return { sheet: { headers, rows } };
  } catch (e) {
    return { error: `Could not parse file: ${(e as Error).message}` };
  }
}

export interface ImportColumnMapping {
  title: number; // required column index
  category: number | null;
  description: number | null;
  code: number | null;
  /**
   * TEMPLATE-OWNED STRUCTURE (ASK 6(e)). The financier's own section names,
   * which are NOT the canonical 15 categories.
   *
   * This is the column that previously had nowhere to land. PNC's file has 12
   * numbered top-level sections with subsections beneath them and 329 items, and
   * none of its section names exist in the canonical list — so the importer
   * could only map the item title and the Section column had to be left as
   * reference-only. Mapping it here creates real groups on commit.
   */
  section: number | null;
  subsection: number | null;
}

export async function commitChecklistImport(input: {
  name: string;
  kind: TemplateKind;
  financierName: string | null;
  rows: string[][];
  mapping: ImportColumnMapping;
  source: "import_excel" | "import_csv";
}): Promise<{
  templateId?: string;
  itemCount?: number;
  /** Template-owned sections created from the Section/Subsection columns. */
  groupCount?: number;
  error?: string;
}> {
  await assertDiligenceCan("edit");
  const name = input.name.trim();
  if (!name) return { error: "Template name is required." };
  if (input.mapping.title == null || input.mapping.title < 0)
    return { error: "Map a column to the item title." };

  const supabase = (await createClient()) as AnySb;

  const { data: tmpl, error: tErr } = await supabase
    .from("nurock_diligence_templates")
    .insert({
      slug: slugify(name),
      name,
      template_kind: input.kind,
      financier_name: input.financierName?.trim() || null,
      source: input.source,
      is_canonical: false,
      is_active: true,
    })
    .select("id")
    .single();
  if (tErr) return { error: tErr.message };
  const templateId = (tmpl as { id: string }).id;

  const m = input.mapping;

  // ---------------------------------------------------------------------------
  // TEMPLATE-OWNED SECTIONS FROM THE SPREADSHEET (ASK 6(e))
  // ---------------------------------------------------------------------------
  // Groups are created in FIRST-APPEARANCE ORDER, which is the order the
  // financier wrote them. Sorting alphabetically would silently reorder a
  // lender's numbered checklist — PNC's sections run 1 to 12, and "10" sorts
  // before "2", so the packet would stop matching the source document.
  //
  // LABELS ARE STORED VERBATIM AND NEVER PARSED. A cell reading "2. Real Estate"
  // becomes the label "2. Real Estate", not code="2" plus label="Real Estate".
  // Splitting it would be guessing at one lender's formatting, and the same
  // principle already governs `code`: a financier's numbering is not arithmetic.
  // The rename control in the drawer can split it afterwards if anyone wants it.
  //
  // Dedupe is case-insensitive on the trimmed cell, because a real spreadsheet
  // contains "Real Estate" and "REAL ESTATE" in one column and they are one
  // section. The FIRST spelling seen is the one stored.
  const norm = (v: string) => v.trim().toLowerCase();
  const cellAt = (r: string[], i: number | null) =>
    i != null && i >= 0 ? (r[i] ?? "").trim() : "";
  // Composite-key separator, written as an ESCAPE rather than the raw byte.
  // I first wrote the literal character here. It compiled -- a NUL is a valid
  // string character and makes an ideal separator -- but git then classified
  // this file as BINARY and stopped producing line diffs for it. A source file
  // whose diff nobody can review is a bad trade for one byte.
  //
  // NUL is still the right VALUE: these keys are built from spreadsheet labels,
  // and any printable separator ("::", "|") could occur inside a real section
  // name and collide two distinct groups into one.
  const SEP = "\u0000";

  interface SectionAcc {
    label: string;
    subKeys: string[];
    subLabels: Map<string, string>;
  }
  const sections = new Map<string, SectionAcc>();
  const sectionKeys: string[] = [];

  if (m.section != null || m.subsection != null) {
    for (const r of input.rows) {
      if (!cellAt(r, m.title)) continue; // titleless rows are dropped below too
      let secLabel = cellAt(r, m.section);
      let subLabel = cellAt(r, m.subsection);
      // A subsection with no section becomes a TOP-LEVEL section: the
      // alternative is an orphan with no parent, and the migration's trigger
      // derives depth FROM the parent, so a parentless child cannot exist.
      if (!secLabel && subLabel) {
        secLabel = subLabel;
        subLabel = "";
      }
      if (!secLabel) continue; // genuinely ungrouped row
      const sk = norm(secLabel);
      let entry = sections.get(sk);
      if (!entry) {
        entry = { label: secLabel, subKeys: [], subLabels: new Map() };
        sections.set(sk, entry);
        sectionKeys.push(sk);
      }
      if (subLabel) {
        const subk = norm(subLabel);
        if (!entry.subLabels.has(subk)) {
          entry.subLabels.set(subk, subLabel);
          entry.subKeys.push(subk);
        }
      }
    }
  }

  // Sections first, then their subsections: a subsection needs its parent's id,
  // and the trigger derives depth from that parent.
  const sectionIdByKey = new Map<string, string>();
  const subIdByKey = new Map<string, string>();
  if (sectionKeys.length > 0) {
    const { data: secRows, error: secErr } = await supabase
      .from("nurock_diligence_item_groups")
      .insert(
        sectionKeys.map((sk, i) => ({
          template_id: templateId,
          parent_group_id: null,
          label: sections.get(sk)!.label,
          sort_order: i,
        }))
      )
      .select("id, label");
    if (secErr) {
      // Roll the template back rather than leave a half-imported packet — the
      // same treatment the empty-items case already gets below.
      await supabase
        .from("nurock_diligence_templates")
        .delete()
        .eq("id", templateId);
      return { error: describeDbError(secErr) };
    }
    // Match returned rows back by LABEL, not by array position: PostgREST does
    // not promise the insert returns rows in the order they were sent.
    const secIdByLabel = new Map(
      ((secRows ?? []) as Array<{ id: string; label: string }>).map((x) => [
        norm(x.label),
        x.id,
      ])
    );
    for (const sk of sectionKeys) {
      const id = secIdByLabel.get(sk);
      if (id) sectionIdByKey.set(sk, id);
    }

    const subPayload: Array<{
      key: string;
      row: {
        template_id: string;
        parent_group_id: string;
        label: string;
        sort_order: number;
      };
    }> = [];
    for (const sk of sectionKeys) {
      const entry = sections.get(sk)!;
      const parentId = sectionIdByKey.get(sk);
      if (!parentId) continue;
      entry.subKeys.forEach((subk, i) => {
        subPayload.push({
          key: `${sk}${SEP}${subk}`,
          row: {
            template_id: templateId,
            parent_group_id: parentId,
            label: entry.subLabels.get(subk)!,
            sort_order: i,
          },
        });
      });
    }

    if (subPayload.length > 0) {
      const { data: subRows, error: subErr } = await supabase
        .from("nurock_diligence_item_groups")
        .insert(subPayload.map((p) => p.row))
        .select("id, label, parent_group_id");
      if (subErr) {
        await supabase
          .from("nurock_diligence_templates")
          .delete()
          .eq("id", templateId);
        return { error: describeDbError(subErr) };
      }
      // Keyed on (parent, label): two different sections may each legitimately
      // contain a "Title" subsection, so the label alone is not unique.
      const subIdByParentLabel = new Map(
        ((subRows ?? []) as Array<{
          id: string;
          label: string;
          parent_group_id: string;
        }>).map((x) => [`${x.parent_group_id}${SEP}${norm(x.label)}`, x.id])
      );
      for (const p of subPayload) {
        const id = subIdByParentLabel.get(
          `${p.row.parent_group_id}${SEP}${norm(p.row.label)}`
        );
        if (id) subIdByKey.set(p.key, id);
      }
    }
  }

  /** The group a row belongs in: its subsection if it has one, else its section. */
  const groupIdForRow = (r: string[]): string | null => {
    if (m.section == null && m.subsection == null) return null;
    let secLabel = cellAt(r, m.section);
    let subLabel = cellAt(r, m.subsection);
    if (!secLabel && subLabel) {
      secLabel = subLabel;
      subLabel = "";
    }
    if (!secLabel) return null;
    const sk = norm(secLabel);
    if (subLabel) {
      const id = subIdByKey.get(`${sk}${SEP}${norm(subLabel)}`);
      if (id) return id;
    }
    return sectionIdByKey.get(sk) ?? null;
  };

  const items = input.rows
    .map((r, idx) => {
      const title = (r[m.title] ?? "").trim();
      if (!title) return null;
      return {
        template_id: templateId,
        item_number: idx + 1,
        title,
        group_id: groupIdForRow(r),
        // `category` STAYS the canonical LIHTC grouping and is NOT fed from the
        // section column. They are different facts about one item, and merging
        // them is precisely what ASK 6 exists to undo.
        category:
          m.category != null && r[m.category]?.trim()
            ? r[m.category].trim()
            : "imported",
        description:
          m.description != null && r[m.description]?.trim()
            ? r[m.description].trim()
            : null,
        code: m.code != null && r[m.code]?.trim() ? r[m.code].trim() : null,
        item_type: "document",
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  if (items.length === 0) {
    // Roll back the empty template.
    await supabase.from("nurock_diligence_templates").delete().eq("id", templateId);
    return { error: "No items had a non-empty title." };
  }

  const { error: iErr } = await supabase
    .from("nurock_diligence_items")
    .insert(items);
  if (iErr) {
    await supabase.from("nurock_diligence_templates").delete().eq("id", templateId);
    return { error: iErr.message };
  }

  {
    const authed = await createClient();
    const {
      data: { user },
    } = await authed.auth.getUser();
    await logDiligenceEvent(supabase, {
      dealId: null, // org-level event — no deal
      actorUserId: user?.id ?? null,
      eventType: "template_imported",
      summary: `Imported checklist "${name}" (${items.length} items, ${
        sectionIdByKey.size + subIdByKey.size
      } sections, ${input.source === "import_csv" ? "CSV" : "Excel"})`,
      detail: { templateId, itemCount: items.length, source: input.source },
    });
  }

  revalidateTemplates();
  return {
    templateId,
    itemCount: items.length,
    groupCount: sectionIdByKey.size + subIdByKey.size,
  };
}

// -----------------------------------------------------------------------------
// Crosswalk
// -----------------------------------------------------------------------------
export async function addCrosswalkMapping(input: {
  canonicalItemId: string;
  externalItemId: string;
  mode?: "all" | "any";
}): Promise<{ error?: string }> {
  await assertDiligenceCan("edit");
  const supabase = (await createClient()) as AnySb;
  const { error } = await supabase.from("nurock_diligence_crosswalk").upsert(
    {
      canonical_item_id: input.canonicalItemId,
      external_item_id: input.externalItemId,
      requirement_mode: input.mode ?? "all",
    },
    { onConflict: "canonical_item_id,external_item_id", ignoreDuplicates: true }
  );
  if (error) return { error: describeDbError(error) };
  revalidateTemplates();
  return {};
}

export async function removeCrosswalkMapping(input: {
  canonicalItemId: string;
  externalItemId: string;
}): Promise<{ error?: string }> {
  await assertDiligenceCan("edit");
  const supabase = (await createClient()) as AnySb;
  const { error } = await supabase
    .from("nurock_diligence_crosswalk")
    .delete()
    .eq("canonical_item_id", input.canonicalItemId)
    .eq("external_item_id", input.externalItemId);
  if (error) return { error: describeDbError(error) };
  revalidateTemplates();
  return {};
}

/** requirement_mode is per external item — apply to all its crosswalk rows. */
export async function setCrosswalkMode(input: {
  externalItemId: string;
  mode: "all" | "any";
}): Promise<{ error?: string }> {
  await assertDiligenceCan("edit");
  const supabase = (await createClient()) as AnySb;
  const { error } = await supabase
    .from("nurock_diligence_crosswalk")
    .update({ requirement_mode: input.mode, updated_at: new Date().toISOString() })
    .eq("external_item_id", input.externalItemId);
  if (error) return { error: describeDbError(error) };
  revalidateTemplates();
  return {};
}

// -----------------------------------------------------------------------------
// Per-deal adoption (called from the diligence page's packet picker)
// -----------------------------------------------------------------------------
export async function adoptTemplateForDeal(input: {
  dealId: string;
  templateId: string;
}): Promise<{ error?: string }> {
  await assertDiligenceCan("edit");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const sb = supabase as AnySb;
  const { error } = await sb.from("dm_diligence_deal_templates").upsert(
    {
      deal_id: input.dealId,
      template_id: input.templateId,
      adopted_by: user?.id ?? null,
    },
    { onConflict: "deal_id,template_id", ignoreDuplicates: true }
  );
  if (error) return { error: describeDbError(error) };

  await logDiligenceEvent(sb, {
    dealId: input.dealId,
    actorUserId: user?.id ?? null,
    eventType: "packet_attached",
    summary: "Packet attached to the deal",
    detail: { templateId: input.templateId },
  });

  revalidatePath(`/deals/${input.dealId}/diligence`);
  revalidatePath(`/deals/${input.dealId}/dashboard`);
  return {};
}

/**
 * A DISCRIMINATED UNION, not a bag of optional fields.
 *
 * The first version typed this as `{ error?, removed?, kept? }` — all optional —
 * and the function still ended with the original `return {}`. It compiled
 * perfectly: `{}` satisfies a type whose every field is optional. So live round
 * 58 deleted all 274 rows correctly, orphan-free, and reported "Packet removed —
 * 0 rows deleted", which is the opposite of what happened and would tell an
 * operator to try again after their checklist had just lost two thirds of its
 * contents.
 *
 * Optional-everything return types cannot tell you that you forgot to return
 * anything. This shape can: the success branch REQUIRES both counts, so a bare
 * `return {}` is a compile error rather than a silent zero.
 */
export type UnadoptResult =
  | { error: string; removed?: undefined; kept?: undefined }
  | {
      error?: undefined;
      /** Rows deleted because nobody had worked them. */
      removed: number;
      /** Rows KEPT because they carry history — worked, documented, signed off. */
      kept: number;
    };

export async function unadoptTemplateForDeal(input: {
  dealId: string;
  templateId: string;
}): Promise<UnadoptResult> {
  await assertDiligenceCan("edit");
  const authed = await createClient();
  const {
    data: { user },
  } = await authed.auth.getUser();
  const supabase = authed as AnySb;
  const { error } = await supabase
    .from("dm_diligence_deal_templates")
    .delete()
    .eq("deal_id", input.dealId)
    .eq("template_id", input.templateId);
  if (error) return { error: describeDbError(error) };

  // ---------------------------------------------------------------------------
  // Clean up the packet's item instances — ONLY the untouched ones
  // ---------------------------------------------------------------------------
  // Instances someone has worked keep their history and stay on the checklist.
  // That rule is unchanged; what follows is how it is carried out.
  //
  // REWRITTEN FOR SCALE AND FOR SILENCE, both exposed by round 57's 242-item
  // packet producing 274 tracked rows:
  //
  //   * THREE UNCHUNKED `.in()` CALLS. supabase-js puts the list in a GET query
  //     string at ~37 characters an id, so 242 ids is a ~9KB URL — at or past
  //     the cap proxies commonly enforce. Chunked now.
  //
  //   * EVERY READ DISCARDED ITS ERROR. `const { data } = await ...` drops the
  //     error, a failed read yields null, null reads as "no rows", and no rows
  //     reads as "nothing to clean up". So the version that could not query
  //     would delete the adoption row, leave all 274 instances orphaned on the
  //     checklist, and return success. The scale bug and the silence bug
  //     together are what made this worth rewriting rather than patching.
  //
  //   * THE DELETE'S RESULT WAS NEVER CHECKED, so an RLS no-op was invisible.
  //
  // The counts are returned rather than merely logged because "what did that
  // actually remove" is the first question anyone asks after clicking it, and
  // until now the only way to answer was to count the checklist by hand.
  let removed = 0;
  let kept = 0;
  {
    const { data: tmplItems, error: tErr } = await supabase
      .from("nurock_diligence_items")
      .select("id")
      .eq("template_id", input.templateId);
    if (tErr) {
      return {
        error:
          `The packet was detached, but its items could not be read, so nothing was cleaned up: ${describeDbError(tErr)}`,
      };
    }
    const itemIds = ((tmplItems ?? []) as Array<{ id: string }>).map((r) => r.id);

    if (itemIds.length > 0) {
      // Entity-scoped rows are included here without any special handling: a
      // replicated row still carries the template item's id in item_id, so all
      // of a party's copies are found by the same query. Verified by the
      // arithmetic in round 57, where 64 of the 274 rows were entity-scoped.
      const { rows: instRows, error: iErr } = await selectInChunks<
        { id: string },
        string
      >(itemIds, (batch) =>
        supabase
          .from("dm_diligence_deal_items")
          .select("id")
          .eq("deal_id", input.dealId)
          .in("item_id", batch)
          .eq("status", "not_started")
      );
      if (iErr) {
        return {
          error: `The packet was detached, but its rows could not be listed, so nothing was cleaned up: ${iErr}`,
        };
      }
      const instanceIds = instRows.map((r) => r.id);

      if (instanceIds.length > 0) {
        const [docsRes, signRes] = await Promise.all([
          selectInChunks<{ deal_item_id: string }, string>(
            instanceIds,
            (batch) =>
              supabase
                .from("dm_diligence_item_documents")
                .select("deal_item_id")
                .in("deal_item_id", batch)
          ),
          selectInChunks<{ deal_item_id: string }, string>(
            instanceIds,
            (batch) =>
              supabase
                .from("dm_diligence_signoffs")
                .select("deal_item_id")
                .in("deal_item_id", batch)
          ),
        ]);
        if (docsRes.error || signRes.error) {
          // FAIL CLOSED. Not knowing which rows carry documents means not
          // knowing which are safe to delete, and deleting on an incomplete
          // answer would destroy exactly the history this rule protects.
          return {
            error:
              `The packet was detached, but its rows were left in place: the check for attached documents or sign-offs failed (${docsRes.error ?? signRes.error}). Nothing was deleted.`,
          };
        }
        const touched = new Set([
          ...docsRes.rows.map((r) => r.deal_item_id),
          ...signRes.rows.map((r) => r.deal_item_id),
        ]);
        const removable = instanceIds.filter((id) => !touched.has(id));
        kept = instanceIds.length - removable.length;

        for (const batch of chunk(removable)) {
          const { data: deleted, error: dErr } = await supabase
            .from("dm_diligence_deal_items")
            .delete()
            .in("id", batch)
            .select("id");
          if (dErr) {
            return {
              error: `Removed ${removed} row(s), then failed: ${describeDbError(dErr)}`,
            };
          }
          removed += ((deleted ?? []) as unknown[]).length;
        }
        if (removable.length > 0 && removed === 0) {
          return {
            error:
              "The packet was detached but none of its rows were removed — check row-level security on dm_diligence_deal_items.",
          };
        }
      }
    }
  }

  // NOTE: the deal's ORG CHART is deliberately untouched. The parties belong to
  // the deal, not to the packet — a deal does not stop having three guarantors
  // because one lender's checklist was detached — and re-adopting the packet
  // should reproduce the same per-party rows rather than ask for the org chart
  // again. Removing a party is its own explicit action.

  await logDiligenceEvent(supabase, {
    dealId: input.dealId,
    actorUserId: user?.id ?? null,
    eventType: "packet_removed",
    // The counts belong in the audit trail too. "Packet removed from the deal"
    // does not distinguish detaching an empty packet from deleting 274 tracked
    // rows, and the audit log is where someone reconstructs what happened after
    // the toast is long gone.
    summary:
      kept > 0
        ? `Packet removed — ${removed} untouched row(s) deleted, ${kept} kept (work or documents attached)`
        : `Packet removed — ${removed} row(s) deleted`,
    detail: { templateId: input.templateId, removed, kept },
  });

  revalidatePath(`/deals/${input.dealId}/diligence`);
  revalidatePath(`/deals/${input.dealId}/dashboard`);
  return { removed, kept };
}
