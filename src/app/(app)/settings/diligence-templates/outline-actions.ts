"use server";

// =============================================================================
// Outline import — preview an indented lender checklist, then commit it
// =============================================================================
// A SECOND IMPORT MODE, alongside the column-mapping one in actions.ts. It is
// not a replacement: a flat spreadsheet with a Section column is still best
// served by mapping columns. This mode handles the shape column mapping cannot
// express at all — level encoded by which column the text sits in.
//
// PNC's file is the motivating case and it defeats the existing importer
// outright: there is no section column, three different prefix conventions
// encode the three levels, the third level shares a column with its own items,
// and the row that carries the real column labels sits at row 11 inside section
// 1 (header detection lands on row 4, "Project Description").
//
// Parsing and family detection live in lib/diligence/outline-import.ts as pure
// functions with 28 unit tests, validated against the real 466-row file. This
// file is the thin server layer: read the upload, hand it to the parser, and on
// commit turn the reviewed tree into groups and items.
//
// -----------------------------------------------------------------------------
// PREVIEW IS NOT A COURTESY, IT IS THE SAFETY MECHANISM
// -----------------------------------------------------------------------------
// The commit writes 392 rows against a 466-row spreadsheet using heuristics that
// are demonstrably imperfect — a role hint in this very module pre-ticked two
// HUD forms as loans until the real file disproved it. So the tree, the detected
// families and the weaker candidates ALL round-trip through the client and come
// back as reviewed decisions. What Michael approves is what gets written; the
// server re-derives nothing from the file on commit.
//
// That also means the server must not trust what comes back. Every path is
// checked against the tree, every role against the live catalog, and a collapse
// with no role is refused here rather than left to trip the table's CHECK
// constraint as an opaque 23514.
// =============================================================================

import { revalidatePath } from "next/cache";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/server";
import { logDiligenceEvent } from "@/lib/diligence/audit";
import { assertDiligenceCan } from "@/lib/auth/access";
import { describeDbError } from "@/lib/diligence/db-errors";
import type { TemplateKind } from "@/lib/data/diligence-templates";
import {
  parseOutline,
  detectFamilies,
  detectCandidateFamilies,
  totalEntriesSaved,
  type ParsedOutline,
  type OutlineNode,
  type DetectedFamily,
  type CandidateFamily,
} from "@/lib/diligence/outline-import";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySb = any;

export interface EntityRoleOption {
  key: string;
  label: string;
}

export interface OutlinePreview {
  sheetNames: string[];
  sheetName: string;
  /** Which columns were read, so the UI can offer to change them. */
  columns: { heading: number; item: number };
  parsed: ParsedOutline;
  families: DetectedFamily[];
  candidates: CandidateFamily[];
  /** Roles that actually exist in the catalog — the dropdown's real options. */
  roles: EntityRoleOption[];
  /** Total nodes + items the commit would write if nothing were collapsed. */
  totalEntries: number;
  /** Item entries the detected collapses would avoid. */
  entriesSaved: number;
}

function countEntries(sections: OutlineNode[]): number {
  let n = 0;
  const walk = (ns: OutlineNode[]) => {
    for (const x of ns) {
      n += 1 + x.items.length;
      walk(x.children);
    }
  };
  walk(sections);
  return n;
}

/**
 * Parse an uploaded workbook as an outline and return everything the reviewer
 * needs to decide. WRITES NOTHING.
 *
 * Guarded at "edit" rather than "view": it is read-only, but it is also the
 * front half of a write, and a viewer has no reason to be uploading a lender's
 * checklist. Gating both halves the same way means there is no state where the
 * preview succeeds and the commit refuses.
 */
export async function previewOutlineImport(
  formData: FormData
): Promise<{ preview?: OutlinePreview; error?: string }> {
  await assertDiligenceCan("edit");

  const file = formData.get("file") as File | null;
  if (!file || !(file instanceof File)) return { error: "No file provided." };

  const wantSheet = (formData.get("sheetName") as string | null) ?? null;
  const headingCol = Number(formData.get("headingCol") ?? 1);
  const itemCol = Number(formData.get("itemCol") ?? 2);
  if (!Number.isInteger(headingCol) || headingCol < 0)
    return { error: "Heading column must be a column index." };
  if (!Number.isInteger(itemCol) || itemCol < 0)
    return { error: "Item column must be a column index." };
  if (headingCol === itemCol)
    return {
      error:
        "The heading and item columns must differ — the levels are told apart by which column the text is in.",
    };

  let parsed: ParsedOutline;
  let sheetNames: string[];
  let sheetName: string;
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buf, { type: "buffer" });
    sheetNames = wb.SheetNames;
    // The named sheet if it exists, else the first. PNC's content is on "DD
    // Checklist", which is NOT the first sheet in every version of that file.
    sheetName =
      wantSheet && sheetNames.includes(wantSheet) ? wantSheet : sheetNames[0];
    const ws = wb.Sheets[sheetName];
    if (!ws) return { error: "The file has no readable sheet." };

    // blankrows:true keeps the row indices honest; raw:false so a numeric item
    // number arrives as "7" rather than 7.
    const aoa = XLSX.utils.sheet_to_json<string[]>(ws, {
      header: 1,
      raw: false,
      defval: "",
      blankrows: true,
    });
    parsed = parseOutline(aoa, { headingCol, itemCol });
  } catch (e) {
    return { error: `Could not parse file: ${(e as Error).message}` };
  }

  if (parsed.sections.length === 0) {
    return {
      error:
        `No numbered sections found in column ${colName(headingCol)}. ` +
        `An outline needs headings like "1. Entity Information" — if this file ` +
        `has a Section column instead, use the column-mapping importer.`,
    };
  }

  const families = detectFamilies(parsed);
  const candidates = detectCandidateFamilies(parsed);

  // Roles come from the CATALOG, not from the detector's suggestions. entity_role
  // carries a foreign key, so a suggestion the catalog does not contain would
  // fail on insert — and the reviewer needs the real list to override with
  // anyway.
  const supabase = (await createClient()) as AnySb;
  const { data: roleRows, error: roleErr } = await supabase
    .from("nurock_diligence_entity_roles")
    .select("key, label")
    .eq("is_active", true)
    .order("sort_order");
  if (roleErr) return { error: describeDbError(roleErr) };
  const roles = ((roleRows ?? []) as EntityRoleOption[]).map((r) => ({
    key: r.key,
    label: r.label,
  }));

  return {
    preview: {
      sheetNames,
      sheetName,
      columns: { heading: headingCol, item: itemCol },
      parsed,
      families,
      candidates,
      roles,
      totalEntries: countEntries(parsed.sections),
      entriesSaved: totalEntriesSaved(families),
    },
  };
}

/** "B" for 1, "C" for 2 — for error messages a person has to act on. */
function colName(i: number): string {
  let s = "";
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

// -----------------------------------------------------------------------------
// Commit
// -----------------------------------------------------------------------------

export interface CollapseDecision {
  /** The family or candidate id from the preview. */
  id: string;
  /**
   * Paths that collapse into ONE block. The FIRST survives and carries the
   * block's items; the rest are dropped, because they are the same list.
   */
  memberPaths: string[];
  /** The block's name. Named from the family, not from any one member. */
  label: string;
  /** Must be a key in nurock_diligence_entity_roles. */
  roleKey: string;
}

export interface CommitOutlineInput {
  name: string;
  kind: TemplateKind;
  financierName: string | null;
  /** The tree exactly as previewed. The server re-parses nothing. */
  parsed: ParsedOutline;
  /** Only the collapses the reviewer accepted. An empty array imports as-is. */
  collapses: CollapseDecision[];
  source: "import_excel" | "import_csv";
}

export async function commitOutlineImport(input: CommitOutlineInput): Promise<{
  templateId?: string;
  groupCount?: number;
  itemCount?: number;
  parameterizedCount?: number;
  droppedCount?: number;
  error?: string;
}> {
  await assertDiligenceCan("edit");

  const name = input.name.trim();
  if (!name) return { error: "Template name is required." };
  if (!input.parsed?.sections?.length)
    return { error: "Nothing to import — the outline has no sections." };

  // ---------------------------------------------------------------------------
  // VALIDATE THE DECISIONS AGAINST THE TREE BEFORE WRITING ANYTHING
  // ---------------------------------------------------------------------------
  // This input arrived from the browser and every field of it is attacker- or
  // accident-controlled. The checks below are not defensive noise: a bad path
  // would silently drop a whole tier (a collapse that keeps nothing), and a
  // missing role would surface as a raw 23514 from the table's CHECK constraint
  // with no indication of which block caused it.
  const byPath = new Map<string, OutlineNode>();
  const parentOf = new Map<string, string | null>();
  {
    const walk = (ns: OutlineNode[], parent: string | null) => {
      for (const n of ns) {
        byPath.set(n.path, n);
        parentOf.set(n.path, parent);
        walk(n.children, n.path);
      }
    };
    walk(input.parsed.sections, null);
  }

  const supabase = (await createClient()) as AnySb;
  const { data: roleRows, error: roleErr } = await supabase
    .from("nurock_diligence_entity_roles")
    .select("key")
    .eq("is_active", true);
  if (roleErr) return { error: describeDbError(roleErr) };
  const validRoles = new Set(
    ((roleRows ?? []) as Array<{ key: string }>).map((r) => r.key)
  );

  /** path -> the collapse it survives as. */
  const survivorOf = new Map<string, CollapseDecision>();
  /** paths that are absorbed into a survivor and must NOT be written. */
  const dropped = new Set<string>();

  for (const c of input.collapses) {
    if (c.memberPaths.length < 2)
      return {
        error: `"${c.label}" would collapse fewer than two blocks — nothing to combine.`,
      };
    const label = c.label.trim();
    if (!label) return { error: "A repeating block needs a name." };
    if (!c.roleKey || !validRoles.has(c.roleKey))
      return {
        error:
          `"${label}" has no valid role. A repeating block must say what it ` +
          `repeats over, so the org chart knows which entities fill it.`,
      };
    for (const p of c.memberPaths) {
      if (!byPath.has(p))
        return {
          error: `A collapse refers to a block ("${p}") that is not in the previewed outline. Re-run the preview.`,
        };
      if (survivorOf.has(p) || dropped.has(p))
        return {
          error: `Block "${byPath.get(p)!.label}" appears in more than one repeating block.`,
        };
    }
    // Every member must share a parent, or "collapse these siblings" is not what
    // is being asked and the survivor would swallow a block from another tier.
    const parents = new Set(c.memberPaths.map((p) => parentOf.get(p) ?? "root"));
    if (parents.size > 1)
      return {
        error: `"${label}" spans more than one section. A repeating block has to sit in one place.`,
      };

    survivorOf.set(c.memberPaths[0], { ...c, label });
    for (const p of c.memberPaths.slice(1)) dropped.add(p);
  }

  // ---------------------------------------------------------------------------
  // The template row
  // ---------------------------------------------------------------------------
  const { data: tmpl, error: tErr } = await supabase
    .from("nurock_diligence_templates")
    .insert({
      slug: slugifyLocal(name),
      name,
      template_kind: input.kind,
      financier_name: input.financierName?.trim() || null,
      source: input.source,
      is_canonical: false,
      is_active: true,
    })
    .select("id")
    .single();
  if (tErr) return { error: describeDbError(tErr) };
  const templateId = (tmpl as { id: string }).id;

  /** Undo the whole import rather than leave a half-written packet. */
  const rollback = async (message: string) => {
    await supabase
      .from("nurock_diligence_templates")
      .delete()
      .eq("id", templateId);
    return { error: message };
  };

  // ---------------------------------------------------------------------------
  // Groups, one depth at a time
  // ---------------------------------------------------------------------------
  // BREADTH-FIRST BY DEPTH, not depth-first: a child needs its parent's id, and
  // the table's trigger derives depth FROM the parent. Three inserts total
  // rather than one per node — 72 sequential round trips against a shared
  // database is a materially different thing from three.
  const groupIdByPath = new Map<string, string>();
  let parameterizedCount = 0;

  interface Pending {
    path: string;
    row: {
      template_id: string;
      parent_group_id: string | null;
      label: string;
      code: string | null;
      sort_order: number;
      is_entity_parameterized: boolean;
      entity_role: string | null;
    };
  }

  const levelNodes = (depth: number): OutlineNode[] => {
    const out: OutlineNode[] = [];
    const walk = (ns: OutlineNode[], d: number) => {
      for (const n of ns) {
        if (d === depth) out.push(n);
        else if (d < depth) walk(n.children, d + 1);
      }
    };
    walk(input.parsed.sections, 0);
    return out;
  };

  for (const depth of [0, 1, 2]) {
    const nodes = levelNodes(depth).filter((n) => !dropped.has(n.path));
    if (nodes.length === 0) continue;

    const pending: Pending[] = [];
    // sort_order is per-parent and must restart for each, or the second
    // section's children would all sort after the first section's.
    const nextOrder = new Map<string, number>();
    for (const n of nodes) {
      const parentPath = parentOf.get(n.path) ?? null;
      const parentId = parentPath ? groupIdByPath.get(parentPath) : null;
      if (parentPath && !parentId) {
        // The parent was itself dropped as an absorbed family member. Its
        // children have nowhere to hang, so this is a bug in the decisions
        // rather than something to paper over with a NULL parent (which would
        // silently promote a subsection to a top-level section).
        return rollback(
          `Cannot place "${n.label}" — the section it belongs to was collapsed away.`
        );
      }
      const key = parentPath ?? "root";
      const order = nextOrder.get(key) ?? 0;
      nextOrder.set(key, order + 1);

      const collapse = survivorOf.get(n.path);
      if (collapse) parameterizedCount++;
      pending.push({
        path: n.path,
        row: {
          template_id: templateId,
          parent_group_id: parentId ?? null,
          // A collapsed block is named FROM THE FAMILY. PNC's five specific
          // entity names are deliberately discarded: they become deal data the
          // moment the org chart is typed at adoption, and keeping "Marlin HP
          // GP, LLC" as a template label would bake one deal's parties into a
          // template meant for all of them.
          label: collapse ? collapse.label : n.label,
          // The lender's numbering, kept verbatim so a packet can echo the
          // source document — except on a collapsed block, where the code
          // belonged to one absorbed member and would be misleading.
          code: collapse ? null : n.code,
          sort_order: order,
          is_entity_parameterized: Boolean(collapse),
          entity_role: collapse ? collapse.roleKey : null,
        },
      });
    }

    const { data: rows, error } = await supabase
      .from("nurock_diligence_item_groups")
      .insert(pending.map((p) => p.row))
      .select("id, label, parent_group_id, sort_order");
    if (error) return rollback(describeDbError(error));

    const returned = (rows ?? []) as Array<{
      id: string;
      label: string;
      parent_group_id: string | null;
      sort_order: number;
    }>;
    if (returned.length !== pending.length) {
      return rollback(
        `Only ${returned.length} of ${pending.length} sections were written at depth ${depth} — check row-level security on nurock_diligence_item_groups.`
      );
    }

    // MATCH BY (parent, sort_order), NOT BY ARRAY POSITION. PostgREST does not
    // promise the insert returns rows in the order they were sent, and the
    // existing importer already learned this the hard way. Label alone is not
    // unique either: two sections may each contain a "Title" subsection, and a
    // lender file legitimately repeats labels — which is the very thing family
    // detection is about.
    const idByKey = new Map(
      returned.map((r) => [`${r.parent_group_id ?? "root"}#${r.sort_order}`, r.id])
    );
    for (const p of pending) {
      const id = idByKey.get(
        `${p.row.parent_group_id ?? "root"}#${p.row.sort_order}`
      );
      if (!id)
        return rollback(
          `Could not identify the row written for "${p.row.label}". Nothing was imported.`
        );
      groupIdByPath.set(p.path, id);
    }
  }

  // ---------------------------------------------------------------------------
  // Items
  // ---------------------------------------------------------------------------
  interface ItemRow {
    template_id: string;
    item_number: number;
    title: string;
    group_id: string | null;
    category: string;
    description: string | null;
    code: string | null;
    item_type: string;
  }
  const items: ItemRow[] = [];
  let n = 0;
  const collectItems = (ns: OutlineNode[]) => {
    for (const node of ns) {
      // An absorbed member's items are NOT written. They are the same list as
      // the survivor's — that identity is what proved the family — so writing
      // them would recreate the duplication the collapse exists to remove.
      if (dropped.has(node.path)) continue;
      const groupId = groupIdByPath.get(node.path) ?? null;
      for (const it of node.items) {
        n++;
        items.push({
          template_id: templateId,
          item_number: n,
          title: it.title,
          group_id: groupId,
          // `category` stays the canonical LIHTC grouping and is NOT fed from
          // the lender's section names. They are different facts about one
          // item; conflating them is what the groups work exists to undo.
          category: "imported",
          description: null,
          // The lender's own item number, kept as text. Not the same thing as
          // item_number, which is this template's ordering.
          code: it.number,
          item_type: "document",
        });
      }
      collectItems(node.children);
    }
  };
  collectItems(input.parsed.sections);

  if (items.length === 0) {
    return rollback(
      "No items were found in the outline — only headings. Nothing was imported."
    );
  }

  // Chunked: a single 320-row insert is fine, but a lender file with a few
  // thousand rows would exceed what one request should carry.
  for (let i = 0; i < items.length; i += 500) {
    const chunk = items.slice(i, i + 500);
    const { data: wrote, error } = await supabase
      .from("nurock_diligence_items")
      .insert(chunk)
      .select("id");
    if (error) return rollback(describeDbError(error));
    if (!wrote || (wrote as unknown[]).length !== chunk.length) {
      return rollback(
        `Only ${(wrote as unknown[] | null)?.length ?? 0} of ${chunk.length} items were written — check row-level security on nurock_diligence_items.`
      );
    }
  }

  {
    const authed = await createClient();
    const {
      data: { user },
    } = await authed.auth.getUser();
    await logDiligenceEvent(supabase, {
      dealId: null,
      actorUserId: user?.id ?? null,
      eventType: "template_imported",
      summary:
        `Imported outline "${name}" — ${groupIdByPath.size} sections ` +
        `(${parameterizedCount} repeating), ${items.length} items` +
        (dropped.size > 0 ? `, ${dropped.size} duplicate blocks collapsed` : ""),
      detail: {
        templateId,
        itemCount: items.length,
        groupCount: groupIdByPath.size,
        parameterizedCount,
        droppedCount: dropped.size,
        source: input.source,
        mode: "outline",
      },
    });
  }

  revalidatePath("/settings/diligence-templates");
  return {
    templateId,
    groupCount: groupIdByPath.size,
    itemCount: items.length,
    parameterizedCount,
    droppedCount: dropped.size,
  };
}

function slugifyLocal(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${base || "template"}-${crypto.randomUUID().slice(0, 6)}`;
}
