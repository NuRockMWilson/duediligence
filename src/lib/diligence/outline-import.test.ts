import { describe, it, expect } from "vitest";
import {
  parseOutline,
  detectFamilies,
  detectCandidateFamilies,
  totalEntriesSaved,
  type ParsedOutline,
} from "./outline-import";

// =============================================================================
// The fixture below is a MINIATURE OF THE REAL FILE, not an invented shape.
// =============================================================================
// Every quirk asserted here was measured in "Residences at Westview Landing -
// PNC DD Checklist 8.26.2026.xlsx" (466 rows, sheet "DD Checklist") by running
// this very parser against it on 2026-09-04:
//
//     counts   { sections: 12, subsections: 45, thirdLevel: 15, items: 320 }
//     nodes 72 + items 320 = 392 entries
//     families 3 -> 5x7 general_partner, 3x13 developer, 3x12 guarantor
//     entries saved 78
//
// The fixture reproduces the SHAPES that make that file hard, at small scale:
//
//   * a preamble with no heading in sight (rows 1-6 of the real file)
//   * two-column indentation, heading in B and items in C
//   * three prefix conventions, one of which (roman) shares a column with items
//   * a subsection code that is not a bare letter: "b3.1"
//   * bare digits in the heading column that are ITEM NUMBERS (real section 7)
//   * items hanging directly off a section with no subsection (real 9 and 12)
//   * a subsection with zero items (real 7h) that must not read as a failure
//   * empty sibling blocks with no items at all (real 11a and 11c)
//   * a decoy: two blocks of the same length whose items DIFFER, which must not
//     collapse — the real file has exactly this in 1a vs 1d, both 12 items
//
// A fixture invented from the description in a comment would have shared my
// assumptions with the parser and could not have falsified anything. These rows
// were reduced from the measured output.
// =============================================================================

// Column layout matches PNC: A blank, B headings, C items, E/F/G resp/status/notes.
const r = (b: string, c = "", resp = "", status = "", notes = "") => [
  "",
  b,
  c,
  "",
  resp,
  status,
  notes,
];

const FIXTURE: string[][] = [
  // --- preamble: no heading yet, must not be read as content -----------------
  r("Residences at Westview Landing"),
  r("", "Committee Date: 8/26/2026"),
  r("Project Description: 120 units", "4% o9%"),
  r(""),

  // --- 1. Entity Information -------------------------------------------------
  r("1. Entity Information"),
  // The real column labels live down here, INSIDE section 1.
  r("", "Document", "Resp. Party", "Status", "Notes"),

  // a. 3 items, distinct list — the decoy's partner
  r("a. Marlin Housing Partners, LP - Partnership"),
  r("1", "Formation documents", "PNC", "Received", "ok"),
  r("2", "IRS form assigning EIN"),
  r("3", "Partnership Agreement"),

  // b / b1 / b2 — a GP family: 2 identical items each
  r("b. Marlin HP GP, LLC - GP    (.01% owner of Partnership)"),
  r("1", "Formation documents"),
  r("2", "IRS form assigning EIN"),
  r("b1. R Block GP MH I, LLC    (25% owner of GP)"),
  r("1", "Formation documents"),
  r("2", "IRS form assigning EIN"),
  // "b3.1" — the code convention that a plain /^[a-z]\./ would miss entirely.
  r("b3.1. MH GP MH, LLC    (10% owner of NDG Marlin Housing Managing GP, LLC)"),
  r("1", "Formation documents"),
  r("2", "IRS form assigning EIN"),

  // d. THE DECOY: same item COUNT as a., different titles. Must not collapse.
  r("d. Sponsor - NAME"),
  r("1", "Formation documents"),
  r("2", "IRS form assigning EIN"),
  r("3", "Sponsor Questionnaire"),

  // e. guarantors — third level, roman prefix, living in the ITEM column
  r("e. Guarantor(s)"),
  r("", "i. Guarantor 1: - Robert Hoskins"),
  r("1", "Personal Financial Statement"),
  r("2", "Background Check Authorization Form"),
  r("", "ii. Guarantor 2: - Robby Block"),
  r("1", "Personal Financial Statement"),
  r("2", "Background Check Authorization Form"),
  r("", "iii. Guarantor 3: - Rebecca Howell"),
  r("1", "Personal Financial Statement"),
  r("2", "Background Check Authorization Form"),

  // --- 7. a subsection with NO items (real 7h) -------------------------------
  r("7. Construction Documents"),
  r("a. Plans and Specifications"),
  r("1", "Architectural plans"),
  r("h. Plan and Cost Review Responses"),

  // --- 9. items hanging straight off the section, no subsection --------------
  r("9. Insurance"),
  r("1", "Evidence of Property Insurance"),
  r("2", "Evidence of Liability Insurance"),

  // --- 11. empty sibling blocks: the loan tier -------------------------------
  r("11. Transaction Financing"),
  r("c. Loan Documents"),
  r("", "i. Bridge (PNC)"),
  r("", "ii. Construction (PNC)"),
  r("", "iii. Miami - Surtax Conversion"),
  r("", "iv. Perm - PNC / Freddie Forward"),
  r("", "v. Permanent 3"),
  // NOT loans, and they sit among the loans in the real file's 11c. VERBATIM
  // from the sheet, including the "HUD/USDA" tail — an earlier version of this
  // fixture paraphrased these two, and the paraphrase was gentler than reality:
  // it dropped the word HUD, which was the very token that made the role hint
  // pre-tick both of them. The bug survived a green test and was caught only by
  // running the parser against the actual file.
  //
  // So: fixture strings are copied, never summarised. A fixture that is easier
  // than the input it stands for is not a test of that input.
  r("", "vi. HUD LLCI Certification (if applicable)"),
  r(
    "",
    "vii. Form 2530 - Previous Participation Certificate, HUD/USDA programs"
  ),
];

const parsed: ParsedOutline = parseOutline(FIXTURE);

const sec = (code: string) => {
  const s = parsed.sections.find((x) => x.code === code);
  if (!s) throw new Error(`no section ${code}`);
  return s;
};
const sub = (secCode: string, subCode: string) => {
  const s = sec(secCode).children.find((x) => x.code === subCode);
  if (!s) throw new Error(`no subsection ${secCode}/${subCode}`);
  return s;
};

describe("parseOutline — structure", () => {
  it("finds every top-level section and no others", () => {
    expect(parsed.sections.map((s) => s.code)).toEqual(["1", "7", "9", "11"]);
  });

  it("stops treating rows as preamble once the first section opens", () => {
    // Three non-empty preamble rows precede "1.", and none of them may become
    // an item. The real file's row 4 is where header detection currently lands.
    expect(parsed.preambleRows).toBe(3);
  });

  it("reads a multi-part subsection code verbatim", () => {
    // "b3.1" is the case a /^[a-z]\./ pattern silently drops.
    expect(sub("1", "b3.1").label).toContain("MH GP MH, LLC");
  });

  it("treats a bare digit in the heading column as an item number, never a section", () => {
    // If BARE_NUMBER were removed, every numbered item in section 7 would open a
    // new top-level section and the section list would explode.
    const a = sub("1", "a");
    expect(a.items.map((i) => i.number)).toEqual(["1", "2", "3"]);
    expect(parsed.sections).toHaveLength(4);
  });

  it("puts roman-prefixed rows in the item column at the third level", () => {
    const e = sub("1", "e");
    expect(e.items).toHaveLength(0);
    expect(e.children.map((c) => c.code)).toEqual(["i", "ii", "iii"]);
    expect(e.children[0].label).toBe("Guarantor 1: - Robert Hoskins");
  });

  it("attaches items to the deepest open heading", () => {
    expect(sub("1", "e").children[1].items.map((i) => i.title)).toEqual([
      "Personal Financial Statement",
      "Background Check Authorization Form",
    ]);
  });

  it("keeps items that hang directly off a section with no subsection", () => {
    // Real sections 9 and 12 hold 29 items this way. A parser that required a
    // subsection would drop all of them.
    const nine = sec("9");
    expect(nine.children).toHaveLength(0);
    expect(nine.items.map((i) => i.title)).toEqual([
      "Evidence of Property Insurance",
      "Evidence of Liability Insurance",
    ]);
  });

  it("accepts a subsection with zero items rather than failing", () => {
    // Real 7h. An empty subsection is valid lender content, not a parse error.
    expect(sub("7", "h").items).toHaveLength(0);
    expect(sec("7").children.map((c) => c.code)).toEqual(["a", "h"]);
  });

  it("captures the extra columns when a row has them", () => {
    const first = sub("1", "a").items[0];
    expect(first.respParty).toBe("PNC");
    expect(first.status).toBe("Received");
    expect(first.notes).toBe("ok");
  });

  it("leaves the extra columns null when a row does not", () => {
    const second = sub("1", "a").items[1];
    expect(second.respParty).toBeNull();
    expect(second.status).toBeNull();
    expect(second.notes).toBeNull();
  });

  it("counts what it parsed", () => {
    // 9 subsections: 1a, 1b, 1b1, 1b3.1, 1d, 1e, 7a, 7h, 11c.
    // 10 third-level: 3 guarantors + 7 loan-document blocks.
    // 22 items: 1 (the column-label row) + 3 + 2x3 + 3 + 2x3 + 1 + 2.
    expect(parsed.counts).toEqual({
      sections: 4,
      subsections: 9,
      thirdLevel: 10,
      items: 22,
    });
  });

  it("loses nothing — every row with content lands somewhere", () => {
    // TOTAL ACCOUNTING, not a spot check. Headings + items + preamble must equal
    // the rows that actually carried text, or the parser dropped content
    // silently. This is the assertion that would catch a whole tier vanishing.
    let nodes = 0;
    let items = 0;
    const walk = (ns: typeof parsed.sections) => {
      for (const n of ns) {
        nodes++;
        items += n.items.length;
        walk(n.children);
      }
    };
    walk(parsed.sections);

    const rowsWithContent = FIXTURE.filter(
      (row) => String(row[1] ?? "").trim() || String(row[2] ?? "").trim()
    ).length;
    // Exact equality, both sides derived. Neither number was typed in by hand,
    // so this cannot be made to pass by adjusting an expectation — which is the
    // only reason it counts as coverage. It balances at 21 nodes + 22 items + 3
    // preamble = 46 rows.
    expect(nodes + items + parsed.preambleRows).toBe(rowsWithContent);
  });

  it("does read the mid-sheet column-label row as an item — a known limitation", () => {
    // ASSERTING THE FLAW RATHER THAN PRETENDING IT IS ABSENT. PNC's header row
    // sits inside section 1 and looks exactly like a document row, so it lands
    // as an item titled "Document". The preview tree exists so a reviewer
    // deletes it in one click; a heuristic that stripped rows resembling headers
    // would eventually strip a real requirement.
    expect(sec("1").items.map((i) => i.title)).toEqual(["Document"]);
  });
});

describe("detectFamilies", () => {
  const families = detectFamilies(parsed);

  it("finds the repeated blocks and only those", () => {
    expect(families).toHaveLength(2);
  });

  it("names a family from the family, not from any member", () => {
    // Michael's ruling: the block is "GP Entity"; PNC's five specific entity
    // names become deal data typed into the org chart at adoption.
    const gp = families.find((f) => f.suggestedRole === "general_partner");
    expect(gp).toBeDefined();
    expect(gp!.suggestedLabel).toBe("GP Entity");
    expect(gp!.members.map((m) => m.code)).toEqual(["b", "b1", "b3.1"]);
    expect(gp!.itemTitles).toEqual([
      "Formation documents",
      "IRS form assigning EIN",
    ]);
  });

  it("detects a family across the third level too", () => {
    const g = families.find((f) => f.suggestedRole === "guarantor");
    expect(g).toBeDefined();
    expect(g!.members.map((m) => m.code)).toEqual(["i", "ii", "iii"]);
    expect(g!.suggestedLabel).toBe("Guarantor");
  });

  it("does NOT collapse two blocks that merely share an item count", () => {
    // THE DECOY. 1a and 1d both hold 3 items; the third differs. A fuzzy or
    // count-based comparison would fuse them and lose a real requirement — the
    // real file has this exact trap at 12 items in 1a vs 1d.
    const codes = families.flatMap((f) => f.members.map((m) => m.code));
    expect(codes).not.toContain("a");
    expect(codes).not.toContain("d");
  });

  it("never groups headings that have no items", () => {
    // The loan tier must not appear here — nothing in the sheet proves it
    // repeats. It surfaces through detectCandidateFamilies instead.
    for (const f of families) expect(f.itemTitles.length).toBeGreaterThan(0);
  });

  it("reports the saving as items x (members - 1)", () => {
    const gp = families.find((f) => f.suggestedRole === "general_partner")!;
    expect(gp.entriesSaved).toBe(2 * (3 - 1));
    // 3 GP members x 2 items + 3 guarantors x 2 items -> 4 + 4
    expect(totalEntriesSaved(families)).toBe(8);
  });

  it("orders the biggest saving first", () => {
    const saved = families.map((f) => f.entriesSaved);
    expect([...saved].sort((a, b) => b - a)).toEqual(saved);
  });

  it("returns nothing at all for a sheet with no repetition", () => {
    const lonely = parseOutline([
      ["", "1. Only Section"],
      ["", "a. Only Subsection"],
      ["", "", "Only Item"],
    ]);
    expect(detectFamilies(lonely)).toEqual([]);
    expect(totalEntriesSaved([])).toBe(0);
  });
});

describe("detectCandidateFamilies", () => {
  const candidates = detectCandidateFamilies(parsed);

  it("surfaces the empty sibling blocks the lender left as placeholders", () => {
    expect(candidates).toHaveLength(1);
    expect(candidates[0].parentLabel).toBe("Loan Documents");
    expect(candidates[0].members).toHaveLength(7);
  });

  it("suggests the loan role from the labels", () => {
    expect(candidates[0].suggestedRole).toBe("loan");
  });

  it("pre-ticks the five loans and leaves the two documents unticked", () => {
    // THE REGRESSION. This is the assertion the softened fixture could not make:
    // "HUD LLCI Certification" and "Form 2530 ... HUD/USDA programs" are single
    // documents filed among the loan placeholders, and pre-ticking them would
    // ask Michael how many HUD LLCI Certifications his deal has.
    const byCode = Object.fromEntries(
      candidates[0].members.map((m) => [m.code, m.suggested])
    );
    expect(byCode).toEqual({
      i: true,
      ii: true,
      iii: true,
      iv: true,
      v: true,
      vi: false,
      vii: false,
    });
  });

  it("does not let an agency name in a form title read as a loan", () => {
    // Narrower than the test above, and aimed straight at the token that caused
    // the miss: HUD alone must never satisfy the loan hint.
    const hudOnly = parseOutline([
      ["", "1. Financing"],
      ["", "a. Loan Documents"],
      ["", "", "i. HUD LLCI Certification (if applicable)"],
      ["", "", "ii. Form 2530 - Previous Participation Certificate, HUD/USDA"],
      ["", "", "iii. HUD Firm Commitment"],
    ]);
    const c = detectCandidateFamilies(hudOnly);
    // No member matches any role hint, so the group has no suggested role and
    // everything is ticked on the strength of the grouping alone — which is the
    // documented fallback, not a loan claim.
    expect(c[0].suggestedRole).toBeNull();
    expect(c[0].suggestedLabel).toBe("Repeating block");
  });

  it("ignores a pair of empty siblings", () => {
    // minMembers is 3: two placeholders are far likelier to be two placeholders
    // than a repeating family, and a false candidate costs more attention than
    // a missed one.
    const two = parseOutline([
      ["", "1. Section"],
      ["", "a. Parent"],
      ["", "", "i. First"],
      ["", "", "ii. Second"],
    ]);
    expect(detectCandidateFamilies(two)).toEqual([]);
  });

  it("does not offer blocks that already have items", () => {
    // Those are detectFamilies' business; a heading cannot be in both.
    for (const c of candidates) {
      expect(c.members.map((m) => m.code)).not.toContain("a");
    }
  });
});
