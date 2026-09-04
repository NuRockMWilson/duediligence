// =============================================================================
// Outline import — parsing an indented lender checklist, and collapsing the
// blocks that repeat
// =============================================================================
// PURE FUNCTIONS, NO DATABASE. Everything here is decided from the sheet alone,
// which is why it can be unit-tested — and it needed to be, because the existing
// column-mapping importer cannot read PNC's file at all.
//
// -----------------------------------------------------------------------------
// WHY COLUMN MAPPING FAILS ON THE REAL FILE
// -----------------------------------------------------------------------------
// Measured against "Residences at Westview Landing - PNC DD Checklist
// 8.26.2026.xlsx" (466 rows) on 2026-09-04:
//
//   * THERE IS NO SECTION COLUMN. Level is encoded by WHICH COLUMN the text sits
//     in, plus WHICH PREFIX CONVENTION it uses:
//         column B, "1." .. "12."          -> 12 top-level sections
//         column B, "a." / "b3.1." / "c2." -> 45 subsections
//         column C, roman "i." .. "vii."   -> 15 third-level blocks
//         column C, no prefix              -> 320 items
//         column B, bare digits            -> an item NUMBER, not a heading
//     The third level shares a column with the items it contains.
//
//   * HEADER DETECTION LANDS ON THE WRONG ROW. previewChecklistImport takes the
//     first row with >= 2 non-empty cells, which is row 4 ("Project Description:
//     [...]" / "4% o9%"). The real column labels — Resp. Party, Status, Notes —
//     sit at row 11, INSIDE section 1. So every column dropdown would be
//     labelled from garbage.
//
// -----------------------------------------------------------------------------
// AND WHY DETECTION MATTERS MORE THAN PARSING
// -----------------------------------------------------------------------------
// PNC repeats the same document list for each party:
//     5 GP entities  x  7 identical items
//     3 developers   x 13 identical items
//     3 guarantors   x 12 identical items
//     5 loan types   (empty today, repeated in two places)
//
// Michael's ruling: BIND, do not copy. One list attached to N named parties, so
// changing a requirement changes it once instead of five times. The parties are
// typed as an org chart when the template is adopted onto a deal, which makes
// their NAMES deal data rather than template data — so a detected family is
// named from the FAMILY ("GP Entity"), and PNC's five specific entity names are
// deliberately discarded here.
//
// That inverts what the importer should produce: NOT 11 sections, but 3 blocks
// each marked "repeats per <role>". Importing 11 and asking someone to collapse
// them afterwards would be work in the wrong direction.
//
// DETECTION IS STRUCTURAL, NOT TEXTUAL. A family is a set of sibling headings
// whose item titles are identical, in order. Role is GUESSED from the labels and
// offered as a suggestion the user confirms — deriving "GP Entity" from
// "Marlin HP GP, LLC - GP (.01% owner of Partnership)" by pattern is exactly the
// kind of inference that works on one lender's file and silently mis-files the
// next one.
// =============================================================================

/** A heading level. 0 = section, 1 = subsection, 2 = third level. */
export type OutlineLevel = 0 | 1 | 2;

export interface OutlineItem {
  /** The lender's own item number when it has one ("7"), else null. */
  number: string | null;
  title: string;
  /** Extra columns, captured when present. Never parsed. */
  respParty: string | null;
  status: string | null;
  notes: string | null;
}

export interface OutlineNode {
  level: OutlineLevel;
  /** The lender's own numbering, verbatim: "2", "b3.1", "iii". */
  code: string | null;
  label: string;
  /**
   * Stable identity for this node within the parse: "11", "11/c", "11/c/i".
   *
   * A CODE IS NOT AN IDENTIFIER. PNC has a block coded "i" under 11a AND a
   * different block coded "i" under 11c, so any UI decision keyed on the code
   * alone — "collapse these members into one block" — would be ambiguous and
   * could apply to the wrong tier. Built from the parse position rather than the
   * label, since two siblings may share a label.
   */
  path: string;
  items: OutlineItem[];
  children: OutlineNode[];
}

export interface ParsedOutline {
  sections: OutlineNode[];
  /** Rows before the first heading — title block, dates, project description. */
  preambleRows: number;
  counts: { sections: number; subsections: number; thirdLevel: number; items: number };
}

// A heading at level 0: "1. Entity Information".
const TOP = /^(\d+)\.\s*(.+)$/;
// A heading at level 1: "a. Title", "b3.1. MH GP MH, LLC", "c2. Developer - ...".
const SUB = /^([a-z]\d*(?:\.\d+)?)\.\s*(.+)$/i;
// A bare number in the heading column is an ITEM NUMBER, not a heading. Section 7
// enumerates its items this way, and without this check every one of them would
// be read as a new section.
const BARE_NUMBER = /^\d+$/;
// A heading at level 2, living in the ITEM column: "i. Guarantor 1: - ...".
// Anchored and requiring the dot so an item that merely begins with "i" is safe.
const ROMAN = /^(i{1,3}|iv|v|vi{1,3}|ix|x)\.\s*(.+)$/i;

const cell = (row: string[], i: number): string =>
  row[i] == null ? "" : String(row[i]).trim();

/**
 * Parse an indented sheet into a heading tree.
 *
 * `headingCol` and `itemCol` default to B and C, which is PNC's shape. They are
 * parameters rather than constants because the next lender's file will indent by
 * a different pair of columns, and the alternative — hardcoding B/C — would make
 * this function silently wrong rather than configurably right.
 */
export function parseOutline(
  rows: string[][],
  opts: {
    headingCol?: number;
    itemCol?: number;
    respCol?: number;
    statusCol?: number;
    notesCol?: number;
  } = {}
): ParsedOutline {
  const hc = opts.headingCol ?? 1;
  const ic = opts.itemCol ?? 2;
  const rc = opts.respCol ?? 4;
  const sc = opts.statusCol ?? 5;
  const nc = opts.notesCol ?? 6;

  const sections: OutlineNode[] = [];
  let section: OutlineNode | null = null;
  let sub: OutlineNode | null = null;
  let third: OutlineNode | null = null;
  let preambleRows = 0;
  let nSub = 0;
  let nThird = 0;
  let nItems = 0;

  for (const row of rows) {
    const h = cell(row, hc);
    const it = cell(row, ic);
    let m: RegExpMatchArray | null;

    // A new top-level section also ENDS the preamble. Everything before the
    // first "N." heading is the lender's cover block — title, committee date,
    // project description — and is not checklist content.
    if (h && (m = h.match(TOP))) {
      section = {
        level: 0,
        code: m[1],
        label: m[2].trim(),
        // Ordinal, not the code: a lender may repeat or skip numbers, and the
        // path has to stay unique regardless of what the sheet says.
        path: `s${sections.length}`,
        items: [],
        children: [],
      };
      sections.push(section);
      sub = null;
      third = null;
      continue;
    }

    if (!section) {
      if (h || it) preambleRows++;
      continue;
    }

    if (h && !BARE_NUMBER.test(h) && (m = h.match(SUB))) {
      sub = {
        level: 1,
        code: m[1],
        label: m[2].trim(),
        path: `${section.path}/${section.children.length}`,
        items: [],
        children: [],
      };
      section.children.push(sub);
      nSub++;
      third = null;
      continue;
    }

    if (it && (m = it.match(ROMAN))) {
      const parent = sub ?? section;
      third = {
        level: 2,
        code: m[1],
        label: m[2].trim(),
        path: `${parent.path}/${parent.children.length}`,
        items: [],
        children: [],
      };
      parent.children.push(third);
      nThird++;
      continue;
    }

    if (it) {
      // Deepest open heading wins. An item belongs to the third level if one is
      // open, else the subsection, else the section directly — section 9
      // (Insurance) and 12 (Closing Items) hold items with no subsection at all,
      // so "items always live under a subsection" would have dropped 29 of them.
      const target = third ?? sub ?? section;
      target.items.push({
        number: BARE_NUMBER.test(h) ? h : null,
        title: it,
        respParty: cell(row, rc) || null,
        status: cell(row, sc) || null,
        notes: cell(row, nc) || null,
      });
      nItems++;
    }
  }

  return {
    sections,
    preambleRows,
    counts: {
      sections: sections.length,
      subsections: nSub,
      thirdLevel: nThird,
      items: nItems,
    },
  };
}

// -----------------------------------------------------------------------------
// Family detection
// -----------------------------------------------------------------------------

export interface DetectedFamily {
  /** Stable id for this family, derived from its first member's path. */
  id: string;
  /** The sibling headings that share an identical item list. */
  members: Array<{ path: string; code: string | null; label: string }>;
  /** Their shared item titles, in order. */
  itemTitles: string[];
  /** Suggested role key, or null when nothing in the labels indicates one. */
  suggestedRole: string | null;
  /** Suggested block name, from the role rather than from any member's label. */
  suggestedLabel: string;
  /** Item entries this collapse avoids: items x (members - 1). */
  entriesSaved: number;
}

/**
 * Role suggestions, keyed to the seeded nurock_diligence_entity_roles.
 *
 * ORDER MATTERS: "general partner" is checked before "developer" because a GP
 * entity's label can mention both. First match wins, and the list is ordered
 * most-specific first.
 */
const ROLE_HINTS: Array<{ role: string; label: string; test: RegExp }> = [
  { role: "guarantor", label: "Guarantor", test: /guarantor/i },
  { role: "general_partner", label: "GP Entity", test: /\bGP\b|general partner|managing (?:gp|member)/i },
  { role: "developer", label: "Developer", test: /developer/i },
  { role: "sponsor", label: "Sponsor", test: /sponsor/i },
  // "hud" is DELIBERATELY ABSENT from this pattern. It was in an earlier draft
  // and pre-ticked two things that are not financing sources — "HUD LLCI
  // Certification" and "Form 2530 - Previous Participation Certificate,
  // HUD/USDA program" — because HUD is an agency whose name appears in form
  // titles far more often than it names a loan. A hint that fires on an agency
  // rather than an instrument is not a hint.
  { role: "loan", label: "Loan / Financing Source", test: /\b(bridge|construction|permanent|perm|surtax|bond|freddie|fannie)\b/i },
  { role: "contractor", label: "General Contractor", test: /contractor/i },
  { role: "management", label: "Management Agent", test: /management|property manager/i },
  { role: "ownership", label: "Ownership Entity", test: /partnership|ownership|\bLP\b/i },
];

function suggestRole(labels: string[]): { role: string | null; label: string } {
  const joined = labels.join(" | ");
  for (const h of ROLE_HINTS) {
    if (h.test.test(joined)) return { role: h.role, label: h.label };
  }
  // No hint is a legitimate answer. A family of identical sections that is not
  // entity-shaped still repeats, and the user can name it themselves — guessing
  // would be worse than admitting there is nothing to go on.
  return { role: null, label: "Repeating block" };
}

/**
 * Find sibling headings whose item lists are IDENTICAL, in order.
 *
 * Exact title match, deliberately. A fuzzy comparison would collapse blocks that
 * merely resemble each other, and a family member with one extra or reworded
 * item would then be silently flattened into its siblings — losing a requirement
 * a lender actually asked for. The live session checked PNC's three families for
 * exactly that kind of near-miss and found none, so exactness costs nothing
 * there and protects every other file.
 *
 * `minMembers` is 2: two identical siblings already justify one block.
 */
export function detectFamilies(
  parsed: ParsedOutline,
  minMembers = 2
): DetectedFamily[] {
  const families: DetectedFamily[] = [];

  const visit = (nodes: OutlineNode[]) => {
    // Group siblings by their item-title signature.
    const bySignature = new Map<string, OutlineNode[]>();
    for (const n of nodes) {
      // A heading with no items cannot be shown to repeat anything. PNC's 12
      // empty loan blocks land here — they ARE a family by intent, but nothing
      // in the sheet proves it, and inventing a shared item list for them would
      // be fabricating content.
      if (n.items.length === 0) continue;
      // NUL as the separator, written as an ESCAPE and never as a literal byte.
      // A document title cannot contain NUL, so two different item lists can
      // never produce the same signature — whereas joining on a space would let
      // ["a b", "c"] and ["a", "b c"] collide and fuse two unrelated blocks into
      // one family. The escape matters as much as the choice: a literal NUL
      // compiles fine but makes git classify the whole file as binary, which is
      // precisely how this line was first committed.
      const sig = n.items.map((i) => i.title).join("\u0000");
      const arr = bySignature.get(sig) ?? [];
      arr.push(n);
      bySignature.set(sig, arr);
    }

    for (const group of bySignature.values()) {
      if (group.length < minMembers) continue;
      const labels = group.map((g) => g.label);
      const { role, label } = suggestRole(labels);
      families.push({
        id: `fam:${group[0].path}`,
        members: group.map((g) => ({
          path: g.path,
          code: g.code,
          label: g.label,
        })),
        itemTitles: group[0].items.map((i) => i.title),
        suggestedRole: role,
        suggestedLabel: label,
        entriesSaved: group[0].items.length * (group.length - 1),
      });
    }

    for (const n of nodes) visit(n.children);
  };

  visit(parsed.sections);
  // Largest saving first — that is the order a reviewer wants to read them in.
  families.sort((a, b) => b.entriesSaved - a.entriesSaved);
  return families;
}

/** Total item entries avoided by collapsing every detected family. */
export function totalEntriesSaved(families: DetectedFamily[]): number {
  return families.reduce((s, f) => s + f.entriesSaved, 0);
}

// -----------------------------------------------------------------------------
// Candidate families — repetition the sheet SUGGESTS but does not prove
// -----------------------------------------------------------------------------
// detectFamilies() only returns groups whose identical item lists demonstrate
// repetition. PNC's loan blocks have NO items at all:
//
//   11a Commitment Letters/Term Sheets -> i..v    (5 empty blocks)
//   11c Loan Documents                -> i..vii  (7 empty blocks)
//
// Structurally they are indistinguishable from any other empty heading, so
// detectFamilies() correctly ignores them. But Michael explicitly wants loans
// parameterized — five financing sources typed once in the org chart, not five
// hand-copied subsections — and silently dropping the one family he named would
// be worse than admitting the evidence is weaker here.
//
// Hence a SEPARATE return type. These are suggestions from LABEL TEXT, presented
// as pre-ticked checkboxes rather than a decision already made, because the
// label hints are demonstrably imperfect on this very file: "HUD LLCI
// Certification (if applicable)" and "Form 2530 - Previous Participation
// Certificate" sit among the loan blocks in 11c and are NOT loans. The first
// even matches the loan hint on the word "HUD".
//
// A reviewer unticking two boxes is the correct amount of work. Guessing, and
// being wrong twice out of seven, is not.
// -----------------------------------------------------------------------------

/**
 * Labels that name a DOCUMENT, not a party.
 *
 * A repeating block stands for a party the user will name in the org chart — a
 * GP entity, a guarantor, a loan. "HUD LLCI Certification" and "Form 2530 -
 * Previous Participation Certificate" are neither: they are single documents
 * that happen to sit among the loan placeholders in PNC's section 11c.
 *
 * Dropping "hud" from the loan hint already unticks both, so this is a second,
 * independent guard. Two cheap guards on a suggestion that becomes a template's
 * structure is proportionate — a wrongly-parameterized block asks the user for
 * "how many HUD LLCI Certifications do you have", which is nonsense they then
 * have to unpick.
 */
const NAMES_A_DOCUMENT = /\b(certificat(?:e|ion)|form\s*\d|questionnaire|report|opinion|agreement)\b/i;

export interface CandidateFamily {
  id: string;
  /** The parent heading these empty blocks sit under, for context. */
  parentLabel: string;
  parentPath: string;
  members: Array<{
    path: string;
    code: string | null;
    label: string;
    /** Pre-ticked when the label matches the role hint. Always overridable. */
    suggested: boolean;
  }>;
  suggestedRole: string | null;
  suggestedLabel: string;
}

/**
 * Sibling headings that carry NO items, grouped by parent.
 *
 * `minMembers` of 3 rather than 2: two empty siblings are far more likely to be
 * an ordinary pair of placeholder headings than a repeating family, and a
 * false candidate costs a reviewer more attention than a missed one.
 */
export function detectCandidateFamilies(
  parsed: ParsedOutline,
  minMembers = 3
): CandidateFamily[] {
  const out: CandidateFamily[] = [];

  const visit = (parent: OutlineNode) => {
    const empties = parent.children.filter(
      (c) => c.items.length === 0 && c.children.length === 0
    );
    if (empties.length >= minMembers) {
      const labels = empties.map((e) => e.label);
      const { role, label } = suggestRole(labels);
      const hint = ROLE_HINTS.find((h) => h.role === role);
      out.push({
        id: `cand:${parent.path}`,
        parentLabel: parent.label,
        parentPath: parent.path,
        members: empties.map((e) => ({
          path: e.path,
          code: e.code,
          label: e.label,
          // No hint matched the group at all -> tick everything, since the whole
          // group is the only signal there is. A hint DID match -> tick only the
          // members it matches, which is what separates the five loans from
          // Form 2530. Either way, something that names a document is never a
          // party.
          suggested:
            !NAMES_A_DOCUMENT.test(e.label) &&
            (hint ? hint.test.test(e.label) : true),
        })),
        suggestedRole: role,
        suggestedLabel: label,
      });
    }
    for (const c of parent.children) visit(c);
  };

  for (const s of parsed.sections) visit(s);
  return out;
}
