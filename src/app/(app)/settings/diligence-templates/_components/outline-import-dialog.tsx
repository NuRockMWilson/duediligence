"use client";

// =============================================================================
// Outline import — the review step
// =============================================================================
// A second import mode for indented lender checklists, where the level is
// encoded by WHICH COLUMN the text sits in rather than by a Section column.
//
// THE TREE AND THE FAMILY CARDS ARE THE POINT OF THIS COMPONENT. The commit
// writes several hundred rows from heuristics that are provably imperfect — a
// role hint in this very feature pre-ticked two HUD forms as loans until the
// real PNC file disproved it — so nothing is written until the whole structure,
// and every proposed collapse, has been looked at. The reviewer's decisions are
// what gets sent; the server re-derives nothing from the file.
//
// Separate from ImportDialog rather than a mode inside it. That component is
// already ~270 lines of column mapping, and the two flows share only the file
// drop: one asks "which column is the title", this one asks "are these five
// blocks the same thing".
// =============================================================================

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronRight,
  Layers,
  Loader2,
  Repeat,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import FileDropZone from "@/components/file-drop-zone";
import type { TemplateKind } from "@/lib/data/diligence-templates";
import { planCollapse, type OutlineNode } from "@/lib/diligence/outline-import";
import {
  previewOutlineImport,
  commitOutlineImport,
  type OutlinePreview,
  type CollapseDecision,
} from "../outline-actions";

/** Per-family review state. `collapse` is what actually decides the write. */
interface FamilyChoice {
  collapse: boolean;
  label: string;
  roleKey: string;
  /** Candidates only: which members participate. */
  memberPaths: Set<string>;
}

const NO_ROLE = "__none__";

export function OutlineImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const router = useRouter();
  const [file, setFile] = React.useState<File | null>(null);
  const [preview, setPreview] = React.useState<OutlinePreview | null>(null);
  const [pending, start] = React.useTransition();

  const [name, setName] = React.useState("");
  const [kind, setKind] = React.useState<TemplateKind>("lender");
  const [financier, setFinancier] = React.useState("");
  const [choices, setChoices] = React.useState<Record<string, FamilyChoice>>({});

  function reset() {
    setFile(null);
    setPreview(null);
    setName("");
    setFinancier("");
    setChoices({});
  }

  function close(o: boolean) {
    if (!o) reset();
    onOpenChange(o);
  }

  function parse(sheetName?: string) {
    if (!file) return;
    const fd = new FormData();
    fd.set("file", file);
    if (sheetName) fd.set("sheetName", sheetName);
    start(async () => {
      const res = await previewOutlineImport(fd);
      if (res.error || !res.preview) {
        toast.error(res.error ?? "Could not read the outline");
        return;
      }
      const p = res.preview;
      setPreview(p);

      // DETECTED families default to collapsing — their identical item lists
      // are proof, and Michael's ruling is bind-not-copy. CANDIDATES default to
      // NOT collapsing: the only evidence is that the labels look alike, which
      // is not enough to reshape a template without someone saying yes.
      const next: Record<string, FamilyChoice> = {};
      for (const f of p.families) {
        next[f.id] = {
          collapse: true,
          label: f.suggestedLabel,
          roleKey: f.suggestedRole ?? NO_ROLE,
          memberPaths: new Set(f.members.map((m) => m.path)),
        };
      }
      for (const c of p.candidates) {
        next[c.id] = {
          collapse: false,
          label: c.suggestedLabel,
          roleKey: c.suggestedRole ?? NO_ROLE,
          memberPaths: new Set(
            c.members.filter((m) => m.suggested).map((m) => m.path)
          ),
        };
      }
      setChoices(next);
      if (!name.trim() && file) {
        setName(file.name.replace(/\.[^.]+$/, "").slice(0, 80));
      }
    });
  }

  /** The decisions, in the shape the server validates. */
  const collapses: CollapseDecision[] = React.useMemo(() => {
    if (!preview) return [];
    const out: CollapseDecision[] = [];
    const push = (
      id: string,
      orderedPaths: string[],
      fallbackLabel: string
    ) => {
      const c = choices[id];
      if (!c || !c.collapse) return;
      // Keep the ORIGINAL sheet order, filtered to the ticked members. Sending
      // a Set's iteration order would make which block survives depend on click
      // order, and the survivor is the one whose items are kept.
      const paths = orderedPaths.filter((p) => c.memberPaths.has(p));
      if (paths.length < 2) return;
      out.push({
        id,
        memberPaths: paths,
        label: c.label.trim() || fallbackLabel,
        roleKey: c.roleKey === NO_ROLE ? "" : c.roleKey,
      });
    };
    for (const f of preview.families)
      push(f.id, f.members.map((m) => m.path), f.suggestedLabel);
    for (const c of preview.candidates)
      push(c.id, c.members.map((m) => m.path), c.suggestedLabel);
    return out;
  }, [preview, choices]);

  /**
   * Reasons the commit would be refused, shown BEFORE the click.
   *
   * The server validates all of this too — it has to, the input is a POST
   * endpoint — but discovering "this block has no role" from a toast after
   * submitting is a worse experience than a disabled button that says why.
   */
  const blockers = React.useMemo(() => {
    const out: string[] = [];
    if (!name.trim()) out.push("Give the template a name.");
    for (const c of collapses) {
      if (!c.roleKey)
        out.push(
          `“${c.label}” repeats, but nothing says what it repeats over — pick a role.`
        );
    }
    return out;
  }, [name, collapses]);

  function commit() {
    if (!preview || blockers.length > 0) return;
    start(async () => {
      const res = await commitOutlineImport({
        name,
        kind,
        financierName: financier || null,
        parsed: preview.parsed,
        collapses,
        source: file?.name.toLowerCase().endsWith(".csv")
          ? "import_csv"
          : "import_excel",
      });
      if (res.error) {
        toast.error(res.error);
        return;
      }
      const bits = [
        `${res.itemCount} items`,
        `${res.groupCount} sections`,
      ];
      if (res.parameterizedCount)
        bits.push(`${res.parameterizedCount} repeating`);
      toast.success(`Imported ${bits.join(", ")}.`);
      close(false);
      router.refresh();
    });
  }

  const setChoice = (id: string, patch: Partial<FamilyChoice>) =>
    setChoices((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  // WHAT WILL ACTUALLY BE WRITTEN, from the same function the server checks
  // itself against.
  //
  // The first version of this footer read "Will import {counts.items} items with
  // N duplicate blocks combined" — and live round 54 proved it wrong: it
  // promised 320 and the import wrote 242. Both numbers were true of something,
  // but the sentence asserted the raw parse count AND the combining at once,
  // which cannot both hold. A reviewer approving that screen was told they
  // would get 78 items they were not going to get, on the last screen before
  // commit.
  //
  // planCollapse() is the single source now. commitOutlineImport calls it too
  // and REFUSES the import if the rows it built disagree, so the two can no
  // longer drift apart quietly.
  const plan = React.useMemo(
    () => (preview ? planCollapse(preview.parsed, collapses) : null),
    [preview, collapses]
  );

  const roleLabels = React.useMemo(
    () => new Map((preview?.roles ?? []).map((r) => [r.key, r.label])),
    [preview]
  );

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle>Import an outline checklist</DialogTitle>
          <DialogDescription>
            For lender checklists that are indented rather than columned — where
            sections, subsections and items are told apart by numbering and
            position, not by a Section column.
          </DialogDescription>
        </DialogHeader>

        {!preview ? (
          <div className="space-y-3 my-2">
            <FileDropZone
              file={file}
              onFileChange={setFile}
              accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              acceptLabel="Excel or CSV"
              maxBytes={15 * 1024 * 1024}
            />
            <Button
              onClick={() => parse()}
              disabled={!file || pending}
              className="w-full bg-nurock-navy hover:bg-nurock-navy-dark text-white"
            >
              {pending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Read the outline"
              )}
            </Button>
            <p className="text-[11px] text-nurock-slate-light">
              Nothing is written until you have seen the whole structure and
              approved it on the next screen.
            </p>
          </div>
        ) : (
          <div className="space-y-3.5 my-2 max-h-[62vh] overflow-y-auto pr-1">
            {preview.sheetNames.length > 1 && (
              <div className="space-y-1">
                <Label className="text-xs font-medium">Sheet</Label>
                <Select
                  value={preview.sheetName}
                  onValueChange={(v) => parse(v)}
                >
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {preview.sheetNames.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-medium">Template name *</Label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full h-9 px-2 text-sm border rounded border-nurock-border"
                  placeholder="e.g. PNC Construction DD"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Financier</Label>
                <input
                  value={financier}
                  onChange={(e) => setFinancier(e.target.value)}
                  className="w-full h-9 px-2 text-sm border rounded border-nurock-border"
                  placeholder="e.g. PNC Bank"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium">Type</Label>
              <Select
                value={kind}
                onValueChange={(v) => setKind(v as TemplateKind)}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="investor">Investor</SelectItem>
                  <SelectItem value="lender">Lender</SelectItem>
                  <SelectItem value="underwriter">Underwriter</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* ---------------------------------------------------------------
                WHAT WAS FOUND. Plain counts, before any interpretation.
            --------------------------------------------------------------- */}
            <div className="rounded-md border border-nurock-border bg-nurock-tan/[0.06] px-3 py-2.5 text-[12px] text-nurock-slate">
              <div className="flex items-center gap-1.5 font-medium text-nurock-black">
                <Layers className="w-3.5 h-3.5" />
                {preview.parsed.counts.sections} sections,{" "}
                {preview.parsed.counts.subsections} subsections,{" "}
                {preview.parsed.counts.thirdLevel} third-level blocks,{" "}
                {preview.parsed.counts.items} items
              </div>
              <div className="mt-1">
                Read from columns {colName(preview.columns.heading)} (headings)
                and {colName(preview.columns.item)} (items).
                {preview.parsed.preambleRows > 0 && (
                  <>
                    {" "}
                    {preview.parsed.preambleRows} row
                    {preview.parsed.preambleRows === 1 ? "" : "s"} above the
                    first section were skipped as cover text.
                  </>
                )}
              </div>
              {/* SILENT LOSS, MADE VISIBLE. A row with text in the heading
                  column that matches no heading convention, and nothing in the
                  item column, cannot be placed — the parser has no way to know
                  what it is. Guessing would be worse; saying nothing would mean
                  a total that quietly excludes it. */}
              {preview.parsed.unparsedRows > 0 && (
                <div className="mt-1.5 text-[11.5px] text-amber-900">
                  {preview.parsed.unparsedRows} row
                  {preview.parsed.unparsedRows === 1 ? "" : "s"} had text in
                  column {colName(preview.columns.heading)} that is not a
                  heading and nothing in column{" "}
                  {colName(preview.columns.item)}, so{" "}
                  {preview.parsed.unparsedRows === 1 ? "it was" : "they were"}{" "}
                  not imported. Check the sheet if that is unexpected — the
                  usual cause is content sitting one column over.
                </div>
              )}
            </div>

            {/* ---------------------------------------------------------------
                REPEATED BLOCKS — proven by identical item lists
            --------------------------------------------------------------- */}
            {preview.families.length > 0 && (
              <div className="space-y-2">
                <div className="text-[11px] uppercase tracking-wider font-display text-nurock-slate-light">
                  Repeated blocks found
                </div>
                <p className="text-[11.5px] text-nurock-slate">
                  These blocks hold the <em>same</em> list of documents, so they
                  can be imported once and attached to however many parties the
                  deal actually has. You type those parties in when the template
                  is used, which is why the block is named for the family rather
                  than for any one of them.
                </p>
                {preview.families.map((f) => (
                  <FamilyCard
                    key={f.id}
                    id={f.id}
                    heading={`${f.members.length} blocks × ${f.itemTitles.length} identical items`}
                    members={f.members.map((m) => ({ ...m, canUntick: false }))}
                    itemTitles={f.itemTitles}
                    proven
                    choice={choices[f.id]}
                    roles={preview.roles}
                    onChange={(patch) => setChoice(f.id, patch)}
                  />
                ))}
              </div>
            )}

            {/* ---------------------------------------------------------------
                CANDIDATES — empty blocks that only LOOK like a family
            --------------------------------------------------------------- */}
            {preview.candidates.length > 0 && (
              <div className="space-y-2">
                <div className="text-[11px] uppercase tracking-wider font-display text-nurock-slate-light">
                  Possibly repeated — your call
                </div>
                <p className="text-[11.5px] text-nurock-slate">
                  These blocks are empty in the file, so nothing in it proves
                  they repeat — the guess comes from their names alone. Off by
                  default. Untick anything that is a single document rather than
                  a party.
                </p>
                {preview.candidates.map((c) => (
                  <FamilyCard
                    key={c.id}
                    id={c.id}
                    heading={`${c.members.length} empty blocks under “${c.parentLabel}”`}
                    members={c.members.map((m) => ({ ...m, canUntick: true }))}
                    itemTitles={[]}
                    proven={false}
                    choice={choices[c.id]}
                    roles={preview.roles}
                    onChange={(patch) => setChoice(c.id, patch)}
                  />
                ))}
              </div>
            )}

            {/* ---------------------------------------------------------------
                THE WHOLE TREE. Every node, nothing hidden.
            --------------------------------------------------------------- */}
            <div className="space-y-1.5">
              <div className="text-[11px] uppercase tracking-wider font-display text-nurock-slate-light">
                Full structure
              </div>
              <div className="rounded border border-nurock-border divide-y divide-nurock-border/50">
                {preview.parsed.sections.map((s) => (
                  <TreeNode
                    key={s.path}
                    node={s}
                    collapses={collapses}
                    depth={0}
                    forceOpen
                    roleLabels={roleLabels}
                  />
                ))}
              </div>
            </div>

            {blockers.length > 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-900 space-y-0.5">
                {blockers.map((b, i) => (
                  <div key={i}>{b}</div>
                ))}
              </div>
            )}
          </div>
        )}

        {preview && (
          <DialogFooter className="items-center">
            <span className="mr-auto text-[11.5px] text-nurock-slate-light">
              {plan && plan.blocksCombined > 0
                ? `Will import ${plan.itemsToWrite} items in ${plan.groupsToWrite} sections — ${plan.blocksCombined} duplicate block${
                    plan.blocksCombined === 1 ? "" : "s"
                  } combined, ${plan.itemsDropped} duplicate entr${
                    plan.itemsDropped === 1 ? "y" : "ies"
                  } dropped.`
                : `Will import ${plan?.itemsToWrite ?? 0} items in ${
                    plan?.groupsToWrite ?? 0
                  } sections, nothing combined.`}
            </span>
            <Button variant="outline" onClick={() => setPreview(null)}>
              Back
            </Button>
            <Button
              onClick={commit}
              disabled={pending || blockers.length > 0}
              title={blockers[0]}
              className="bg-nurock-navy hover:bg-nurock-navy-dark text-white"
            >
              {pending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Import outline"
              )}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

// -----------------------------------------------------------------------------

function FamilyCard({
  heading,
  members,
  itemTitles,
  proven,
  choice,
  roles,
  onChange,
}: {
  id: string;
  heading: string;
  members: Array<{
    path: string;
    code: string | null;
    label: string;
    canUntick: boolean;
  }>;
  itemTitles: string[];
  proven: boolean;
  choice: FamilyChoice | undefined;
  roles: Array<{ key: string; label: string }>;
  onChange: (patch: Partial<FamilyChoice>) => void;
}) {
  if (!choice) return null;
  const ticked = members.filter((m) => choice.memberPaths.has(m.path));

  return (
    <div className="rounded-md border border-nurock-border p-3 space-y-2.5">
      <div className="flex items-start gap-2">
        <Checkbox
          checked={choice.collapse}
          onCheckedChange={(v) => onChange({ collapse: v === true })}
          className="mt-0.5"
          aria-label="Combine these blocks into one repeating block"
        />
        <div className="min-w-0">
          <div className="text-[12.5px] font-medium text-nurock-black flex items-center gap-1.5">
            <Repeat className="w-3.5 h-3.5 text-nurock-slate-light" />
            {heading}
          </div>
          {!proven && (
            <div className="text-[11px] text-nurock-slate-light">
              Guessed from the names — the file itself does not show these
              repeating.
            </div>
          )}
        </div>
      </div>

      <div className="pl-6 space-y-1">
        {members.map((m) => {
          const on = choice.memberPaths.has(m.path);
          const isSurvivor = ticked.length > 0 && ticked[0].path === m.path;
          return (
            <div key={m.path} className="flex items-start gap-2 text-[11.5px]">
              {m.canUntick ? (
                <Checkbox
                  checked={on}
                  disabled={!choice.collapse}
                  onCheckedChange={(v) => {
                    const next = new Set(choice.memberPaths);
                    if (v === true) next.add(m.path);
                    else next.delete(m.path);
                    onChange({ memberPaths: next });
                  }}
                  className="mt-[1px]"
                  aria-label={m.label}
                />
              ) : (
                <span className="w-4" />
              )}
              {/* STRIKE MEANS EXCLUDED, NOT ABSORBED.
                  Live round 54 flagged that absorbed members are struck through
                  in the tree but not here, and read that as a miss. It is a
                  real inconsistency, but the fix is not to add a strike: in the
                  tree a struck row means "this section will not exist", which
                  is true there. In this card every ticked member PARTICIPATES —
                  striking them would suggest their requirements are being
                  discarded, when in fact they are the same requirements as the
                  survivor's. So the strike is reserved for members the reviewer
                  has UNTICKED, and participation is said in words instead. */}
              <span
                className={
                  on && choice.collapse
                    ? "text-nurock-slate"
                    : "text-nurock-slate-light line-through decoration-nurock-slate-light/50"
                }
              >
                {m.code ? `${m.code}. ` : ""}
                {m.label}
              </span>
              {choice.collapse && on && (
                <span
                  className={`text-[10px] uppercase tracking-wider shrink-0 ${
                    isSurvivor
                      ? "text-nurock-navy"
                      : "text-nurock-slate-light"
                  }`}
                >
                  {isSurvivor ? "kept" : "merged in"}
                </span>
              )}
              {choice.collapse && !on && (
                <span className="text-[10px] uppercase tracking-wider text-nurock-slate-light shrink-0">
                  left separate
                </span>
              )}
            </div>
          );
        })}
      </div>

      {choice.collapse && (
        <div className="pl-6 grid grid-cols-2 gap-2.5">
          <div className="space-y-1">
            <Label className="text-[11px] font-medium">Block name</Label>
            <input
              value={choice.label}
              onChange={(e) => onChange({ label: e.target.value })}
              className="w-full h-8 px-2 text-[12.5px] border rounded border-nurock-border"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] font-medium">Repeats per *</Label>
            <Select
              value={choice.roleKey}
              onValueChange={(v) => onChange({ roleKey: v })}
            >
              <SelectTrigger className="h-8 text-[12.5px]">
                <SelectValue placeholder="Pick a role" />
              </SelectTrigger>
              <SelectContent>
                {/* No "none" option on purpose: a repeating block with nothing
                    to repeat over cannot be saved — the table's own constraint
                    refuses it — so offering it would be offering a dead end. */}
                {roles.map((r) => (
                  <SelectItem key={r.key} value={r.key}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {choice.collapse && itemTitles.length > 0 && (
        <div className="pl-6 text-[11px] text-nurock-slate-light">
          Each one will carry: {itemTitles.slice(0, 3).join(" · ")}
          {itemTitles.length > 3 ? ` · +${itemTitles.length - 3} more` : ""}
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------

function TreeNode({
  node,
  collapses,
  depth,
  forceOpen,
  roleLabels,
}: {
  node: OutlineNode;
  collapses: CollapseDecision[];
  depth: number;
  /** True when a collapse decision lives somewhere below this node. */
  forceOpen: boolean;
  /** Role key -> catalog label, so the badge never shows a raw enum. */
  roleLabels: Map<string, string>;
}) {
  // Sections open, everything below closed: 12 headings is a readable first
  // screen, 392 nodes is not.
  //
  // EXCEPT ON THE PATH TO A PROPOSED CHANGE. Live round 54 found the guarantor
  // family completely invisible in this tree: the three i/ii/iii blocks sit at
  // depth 2 under "e. Guarantor(s)", which starts closed, and because that
  // parent has no items of its own it rendered with no item count and no badge
  // — indistinguishable from an empty subsection like 7h. The GP and Developer
  // families showed because they happen to sit one level higher.
  //
  // The collapse was real and did get written correctly. But a reviewer
  // approving from this tree could not see that a guarantor block was about to
  // be created, and making the proposed changes visible is the tree's entire
  // job. So any ancestor of a collapse participant opens itself.
  const [open, setOpen] = React.useState(depth === 0 || forceOpen);

  const decision = collapses.find((c) => c.memberPaths.includes(node.path));
  const isSurvivor = decision?.memberPaths[0] === node.path;
  const isAbsorbed = Boolean(decision) && !isSurvivor;
  const hasChildren = node.children.length > 0 || node.items.length > 0;

  // A closed node that contains no items looked identical to a genuinely empty
  // one — the exact confusion that hid the guarantors. Say what is inside.
  const childBlockCount = node.children.length;

  return (
    <div className={depth === 0 ? "" : "border-t border-nurock-border/40"}>
      <div
        className="flex items-start gap-1.5 px-2 py-1"
        style={{ paddingLeft: 8 + depth * 16 }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="mt-[3px] text-nurock-slate-light hover:text-nurock-black"
            aria-label={open ? "Collapse" : "Expand"}
          >
            {open ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
          </button>
        ) : (
          <span className="w-3.5" />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[12px] flex items-baseline gap-1.5 flex-wrap">
            <span
              className={
                isAbsorbed
                  ? "text-nurock-slate-light line-through decoration-nurock-slate-light/50"
                  : depth === 0
                    ? "font-medium text-nurock-black"
                    : "text-nurock-slate"
              }
            >
              {node.code ? `${node.code}. ` : ""}
              {isSurvivor ? decision!.label : node.label}
            </span>
            {isSurvivor && (
              <span className="text-[10px] px-1.5 py-[1px] rounded bg-nurock-navy/10 text-nurock-navy uppercase tracking-wider">
                {/* The CATALOG LABEL, never the key. Round 54 caught
                    "per general_partner" leaking the raw enum into UI text;
                    "developer" and "guarantor" only read acceptably because
                    they happen to be single words. */}
                repeats per{" "}
                {roleLabels.get(decision!.roleKey) ??
                  decision!.roleKey.replace(/_/g, " ")}
              </span>
            )}
            {isAbsorbed && (
              <span className="text-[10px] text-nurock-slate-light uppercase tracking-wider">
                combined above
              </span>
            )}
            {node.items.length > 0 && !isAbsorbed && (
              <span className="text-[10.5px] text-nurock-slate-light">
                {node.items.length} item
                {node.items.length === 1 ? "" : "s"}
              </span>
            )}
            {/* A heading whose content is entirely in child blocks showed
                nothing at all before — "e. Guarantor(s)" read as empty while
                holding three guarantors. */}
            {node.items.length === 0 && childBlockCount > 0 && !isAbsorbed && (
              <span className="text-[10.5px] text-nurock-slate-light">
                {childBlockCount} block
                {childBlockCount === 1 ? "" : "s"}
              </span>
            )}
            {node.items.length === 0 &&
              childBlockCount === 0 &&
              !isAbsorbed && (
                <span className="text-[10.5px] text-nurock-slate-light italic">
                  empty
                </span>
              )}
          </div>
        </div>
      </div>

      {open && !isAbsorbed && (
        <>
          {node.items.map((it, i) => (
            <div
              key={i}
              className="text-[11.5px] text-nurock-slate-light py-[2px]"
              style={{ paddingLeft: 8 + (depth + 1) * 16 + 20 }}
            >
              {it.number ? `${it.number}. ` : ""}
              {it.title}
            </div>
          ))}
          {node.children.map((c) => (
            <TreeNode
              key={c.path}
              node={c}
              collapses={collapses}
              depth={depth + 1}
              forceOpen={holdsDecision(c, collapses)}
              roleLabels={roleLabels}
            />
          ))}
        </>
      )}
    </div>
  );
}

/**
 * Does a collapse decision live at or under this node?
 *
 * A PLAIN RECURSIVE FUNCTION, not a hook. The first version was a
 * React.useCallback that called itself, which the repo's lint rule correctly
 * rejects — a callback cannot reference its own binding before it is declared,
 * so the recursion would have read a stale value. Nothing here needs memoising:
 * it is a pure walk over the tree given the current decisions.
 */
function holdsDecision(node: OutlineNode, collapses: CollapseDecision[]): boolean {
  if (collapses.some((c) => c.memberPaths.includes(node.path))) return true;
  return node.children.some((c) => holdsDecision(c, collapses));
}

/** "B" for 1, "C" for 2 — the reviewer is looking at a spreadsheet. */
function colName(i: number): string {
  let s = "";
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}
