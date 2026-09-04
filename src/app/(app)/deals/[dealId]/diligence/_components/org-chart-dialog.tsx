"use client";

// =============================================================================
// The org chart step — typed before a packet with repeating blocks is adopted
// =============================================================================
// Michael's spec: "before you import the template into an actual due diligence
// list, you type in the organizational chart, which determines the GP sections,
// developers, guarantors, and loans to populate all the relevant sections based
// on how many entries are entered."
//
// So this dialog stands between "add packet" and the packet actually appearing.
// It opens ONLY when the template has repeating blocks — a packet with none
// adopts in one click exactly as before, because making everyone walk through
// an empty org chart to attach an ordinary checklist would be a tax on the
// common case.
//
// EACH ROLE SHOWS WHAT IT FILLS. "Repeats per Guarantor" is abstract; "these 3
// blocks need guarantors: Guarantor" is checkable against the lender's document
// sitting next to the screen. The count is the user's to decide — PNC's file
// had five GP tiers because Westview has five, and the next deal will not.
//
// TYPE A NAME OR PICK ONE ALREADY KNOWN. NuRock's guarantors are the same three
// people on most deals, so the catalog offers them rather than making someone
// retype "Robby Block" on every deal. Reuse is by exact name within the role;
// the server does the matching, and does not fuzzy-match, because binding
// "R Block Development" to "R Block Development, LLC" would attach one deal's
// documents to another deal's entity and nothing would look wrong.
// =============================================================================

import * as React from "react";
import { Loader2, Plus, X, Users } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  saveDealOrgChart,
  listCatalogEntities,
  type OrgChartRole,
  type DealEntityRow,
  type OrgChartEntry,
} from "../entity-actions";

interface DraftRow {
  /** Local key only — never sent. */
  key: string;
  roleKey: string;
  name: string;
  /** Set when the user picked a catalog entity instead of typing. */
  entityId?: string;
}

let seq = 0;
const nextKey = () => `r${++seq}`;

const TYPE_NEW = "__type__";

export function OrgChartDialog({
  open,
  onOpenChange,
  dealId,
  templateName,
  roles,
  existing,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  dealId: string;
  templateName: string;
  roles: OrgChartRole[];
  existing: DealEntityRow[];
  /** Called after the org chart is saved, to run the adoption itself. */
  onDone: () => void;
}) {
  // ONE EMPTY ROW PER ROLE, from a state INITIALIZER rather than an effect.
  //
  // The first version seeded these with setRows() inside a useEffect, which is
  // a cascading render — render, effect, setState, render again — and the repo's
  // lint rule rejects it. It was also unnecessary: this is initial state
  // derived from props, not synchronisation with anything external. The parent
  // renders this component conditionally and keys it per template, so it mounts
  // fresh for each packet and the initializer runs exactly when it should.
  const [rows, setRows] = React.useState<DraftRow[]>(() =>
    roles.map((r) => ({ key: nextKey(), roleKey: r.key, name: "" }))
  );
  const [catalog, setCatalog] = React.useState<
    Array<{ id: string; name: string; roleKey: string }>
  >([]);
  const [saving, setSaving] = React.useState(false);

  // The catalog read IS a real effect — fetching from outside React — and its
  // setState lands in an async callback rather than the effect body.
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const res = await listCatalogEntities({
        roleKeys: roles.map((r) => r.key),
      });
      if (cancelled) return;
      if (res.error) {
        // Not fatal: typing a name still works, so say what is missing rather
        // than blocking the dialog on a read that is only a convenience.
        toast.error(`Could not load known parties: ${res.error}`);
        return;
      }
      setCatalog(res.entities ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, roles]);

  const existingByRole = React.useMemo(() => {
    const m = new Map<string, DealEntityRow[]>();
    for (const e of existing) {
      const arr = m.get(e.roleKey) ?? [];
      arr.push(e);
      m.set(e.roleKey, arr);
    }
    return m;
  }, [existing]);

  const filled = rows.filter((r) => r.entityId || r.name.trim());

  /**
   * Roles that will produce nothing. Not a blocker — a deal may genuinely have
   * no guarantors yet, and forcing a placeholder name would put a fake party in
   * the catalog forever. But it is worth saying plainly, because the blocks for
   * that role will simply not appear and that is easy to mistake for a bug.
   */
  const emptyRoles = roles.filter(
    (r) =>
      (existingByRole.get(r.key)?.length ?? 0) === 0 &&
      !filled.some((f) => f.roleKey === r.key)
  );

  function save() {
    const entries: OrgChartEntry[] = filled.map((r) => ({
      entityId: r.entityId,
      name: r.entityId ? undefined : r.name.trim(),
      roleKey: r.roleKey,
    }));
    setSaving(true);
    void (async () => {
      if (entries.length > 0) {
        const res = await saveDealOrgChart({ dealId, entries });
        if (res.error) {
          setSaving(false);
          toast.error(res.error);
          return;
        }
      }
      setSaving(false);
      onOpenChange(false);
      // The adoption itself runs after, so a failure to save the org chart
      // never leaves a packet attached with nothing to populate it.
      onDone();
    })();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Who is on this deal?</DialogTitle>
          <DialogDescription>
            <span className="font-medium">{templateName}</span> has sections
            that repeat once per party. Name the parties and those sections will
            be created for each one.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 my-2 max-h-[58vh] overflow-y-auto pr-1">
          {roles.map((role) => {
            const already = existingByRole.get(role.key) ?? [];
            const roleRows = rows.filter((r) => r.roleKey === role.key);
            const options = catalog.filter((c) => c.roleKey === role.key);
            return (
              <div
                key={role.key}
                className="rounded-md border border-nurock-border p-3 space-y-2"
              >
                <div>
                  <div className="text-[12.5px] font-medium text-nurock-black flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-nurock-slate-light" />
                    {role.label}
                  </div>
                  {/* WHAT THIS ROLE ACTUALLY FILLS. Checkable against the
                      lender's document rather than taken on trust. */}
                  <div className="text-[11px] text-nurock-slate-light mt-0.5">
                    {role.blockCount} section
                    {role.blockCount === 1 ? " repeats" : "s repeat"} per{" "}
                    {role.label}: {role.blockLabels.slice(0, 3).join(", ")}
                    {role.blockLabels.length > 3
                      ? ` +${role.blockLabels.length - 3} more`
                      : ""}
                  </div>
                </div>

                {already.length > 0 && (
                  <div className="text-[11.5px] text-nurock-slate">
                    Already on this deal:{" "}
                    {already.map((a) => a.displayName ?? a.name).join(", ")}
                  </div>
                )}

                {/* "WIRED BUT EMPTY" MUST NOT LOOK LIKE "NOT WIRED".
                    Round 54 reported that no card offered existing names and
                    read that as the catalog not being connected. It is
                    connected — there simply are no entities in these roles yet,
                    because nothing has ever created one. But the UI showed a
                    bare text input either way, so the two states were
                    indistinguishable from the outside. Now the empty state says
                    what it is, and what typing a name will do. */}
                {options.length === 0 && (
                  <div className="text-[11px] text-nurock-slate-light">
                    No {role.label.toLowerCase()} on file yet. The first name you
                    type is saved for reuse, so later deals can pick it instead
                    of retyping it.
                  </div>
                )}

                <div className="space-y-1.5">
                  {roleRows.map((r) => (
                    <div key={r.key} className="flex items-center gap-1.5">
                      {options.length > 0 && (
                        <Select
                          value={r.entityId ?? TYPE_NEW}
                          onValueChange={(v) =>
                            setRows((prev) =>
                              prev.map((x) =>
                                x.key === r.key
                                  ? v === TYPE_NEW
                                    ? { ...x, entityId: undefined, name: "" }
                                    : {
                                        ...x,
                                        entityId: v,
                                        name:
                                          options.find((o) => o.id === v)
                                            ?.name ?? "",
                                      }
                                  : x
                              )
                            )
                          }
                        >
                          <SelectTrigger className="h-8 text-[12.5px] w-[190px] shrink-0">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={TYPE_NEW}>
                              Type a new name…
                            </SelectItem>
                            {options.map((o) => (
                              <SelectItem key={o.id} value={o.id}>
                                {o.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      <input
                        value={r.name}
                        disabled={Boolean(r.entityId)}
                        onChange={(e) =>
                          setRows((prev) =>
                            prev.map((x) =>
                              x.key === r.key
                                ? { ...x, name: e.target.value }
                                : x
                            )
                          )
                        }
                        placeholder={`e.g. ${placeholderFor(role.key)}`}
                        className="flex-1 h-8 px-2 text-[12.5px] border rounded border-nurock-border disabled:bg-nurock-tan/[0.08] disabled:text-nurock-slate"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setRows((prev) => prev.filter((x) => x.key !== r.key))
                        }
                        className="text-nurock-slate-light hover:text-red-600 p-1"
                        aria-label="Remove this row"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      setRows((prev) => [
                        ...prev,
                        { key: nextKey(), roleKey: role.key, name: "" },
                      ])
                    }
                    className="text-[11.5px] text-nurock-navy hover:underline flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" /> Add another {role.label}
                  </button>
                </div>
              </div>
            );
          })}

          {emptyRoles.length > 0 && (
            <div className="rounded-md border border-nurock-border bg-nurock-tan/[0.06] px-3 py-2 text-[11.5px] text-nurock-slate">
              No{" "}
              {emptyRoles.map((r) => r.label.toLowerCase()).join(" or ")} named
              — those sections will not appear on the checklist. That is fine if
              the deal has none yet; you can add them later and the sections
              will be created then.
            </div>
          )}
        </div>

        <DialogFooter className="items-center">
          <span className="mr-auto text-[11.5px] text-nurock-slate-light">
            {filled.length > 0
              ? `${filled.length} part${filled.length === 1 ? "y" : "ies"} to add`
              : "No new parties"}
          </span>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={saving}
            className="bg-nurock-navy hover:bg-nurock-navy-dark text-white"
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              "Save and add packet"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Role-shaped placeholders, so the field says what kind of name belongs. */
function placeholderFor(roleKey: string): string {
  switch (roleKey) {
    case "general_partner":
      return "Marlin HP GP, LLC";
    case "developer":
      return "NuRock Development Partners";
    case "guarantor":
      return "Robby Block";
    case "loan":
      return "Construction (PNC)";
    case "ownership":
      return "Marlin Housing Partners, LP";
    case "contractor":
      return "NuRock Construction";
    case "management":
      return "NuRock Management, Inc.";
    default:
      return "name";
  }
}
