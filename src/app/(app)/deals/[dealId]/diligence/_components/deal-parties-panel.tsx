"use client";

// =============================================================================
// The deal's org chart, after adoption
// =============================================================================
// THE GAP THIS CLOSES: a deal's parties could only be typed during packet
// adoption, and then never seen again. No screen listed them, none removed one,
// and the per-deal display_name override the schema provides had no UI at all.
//
// Round 58 made the cost concrete. Six test parties on a deal could not be
// deleted from the new catalog page — correctly, since both foreign keys are ON
// DELETE RESTRICT and the deal still named them — and there was no way to stop
// the deal naming them. The only route out was hand-written SQL. removeDealEntity
// had been written and guarded a round earlier and was wired to nothing.
//
// It renders only when the deal HAS parties or a packet that needs them: on an
// ordinary deal with a plain checklist, an org chart is a section about a
// feature that is not in use.
//
// COUNTS ARE ON EVERY ROW because removing a party deletes its untouched rows,
// and "12 rows" is the difference between a tidy-up and losing an afternoon's
// collection.
// =============================================================================

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, X, Users, Pencil } from "lucide-react";
import { Card } from "@/components/nurock-ui";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { DealParty } from "@/lib/data/diligence";
import {
  saveDealOrgChart,
  removeDealEntity,
  setDealEntityDisplayName,
  listCatalogEntities,
  getDealOrgChartRoles,
  type OrgChartRole,
} from "../entity-actions";

export function DealPartiesPanel({
  dealId,
  parties,
  canEdit,
}: {
  dealId: string;
  parties: DealParty[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [addOpen, setAddOpen] = React.useState(false);
  const [renaming, setRenaming] = React.useState<DealParty | null>(null);
  const [removing, setRemoving] = React.useState<DealParty | null>(null);

  const byRole = React.useMemo(() => {
    const m = new Map<string, DealParty[]>();
    for (const p of parties) {
      const arr = m.get(p.roleKey) ?? [];
      arr.push(p);
      m.set(p.roleKey, arr);
    }
    return m;
  }, [parties]);

  function run(fn: () => Promise<{ error?: string }>, ok: string) {
    start(async () => {
      const res = await fn();
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(ok);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-2">
        <h2 className="font-display text-[11.5px] uppercase tracking-wider text-nurock-slate flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5" />
          Parties on this deal
        </h2>
        <span className="text-[11px] text-nurock-slate-light">
          {parties.length}
        </span>
        {canEdit && (
          <button
            onClick={() => setAddOpen(true)}
            className="ml-auto text-[11.5px] text-nurock-navy hover:underline inline-flex items-center gap-1"
          >
            <Plus className="w-3 h-3" /> Add a party
          </button>
        )}
      </div>

      <Card className="bg-white overflow-hidden">
        {parties.length === 0 ? (
          <div className="px-4 py-3 text-[12px] text-nurock-slate-light">
            No parties named yet. Sections that repeat per party — GP entities,
            developers, guarantors — will not appear on the checklist until they
            are named here.
          </div>
        ) : (
          <table className="w-full text-[13px]">
            <tbody>
              {Array.from(byRole.entries()).map(([roleKey, rows]) => (
                <React.Fragment key={roleKey}>
                  <tr className="bg-nurock-gray/40 border-y border-nurock-border">
                    <td
                      colSpan={3}
                      className="px-4 py-1.5 font-display text-[10px] uppercase tracking-wider text-nurock-slate-light"
                    >
                      {rows[0].roleLabel}
                    </td>
                  </tr>
                  {rows.map((p) => (
                    <tr
                      key={p.entityId}
                      className="border-b border-nurock-border/60 last:border-0"
                    >
                      <td className="px-4 py-2 text-nurock-black">
                        {p.label}
                        {/* WHEN AN OVERRIDE IS IN PLAY, SHOW BOTH. Otherwise
                            this deal and the catalog silently disagree about a
                            party's name and nobody can tell which is which. */}
                        {p.displayName && p.displayName.trim() !== p.name && (
                          <span className="ml-2 text-[11px] text-nurock-slate-light">
                            (catalog: {p.name})
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-[11.5px] text-nurock-slate-light whitespace-nowrap">
                        {p.itemCount} row{p.itemCount === 1 ? "" : "s"}
                      </td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">
                        {canEdit && (
                          <div className="inline-flex items-center gap-0.5">
                            <button
                              type="button"
                              title="Name this party differently on this deal only"
                              aria-label={`Rename ${p.label} on this deal`}
                              onClick={() => setRenaming(p)}
                              disabled={pending}
                              className="p-1.5 rounded text-nurock-slate-light hover:text-nurock-navy hover:bg-nurock-gray disabled:opacity-30"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              title="Remove this party from the deal"
                              aria-label={`Remove ${p.label} from this deal`}
                              onClick={() => setRemoving(p)}
                              disabled={pending}
                              className="p-1.5 rounded text-nurock-slate-light hover:text-red-600 hover:bg-red-50 disabled:opacity-30"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <AddPartyDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        dealId={dealId}
        pending={pending}
        onSaved={() => {
          setAddOpen(false);
          router.refresh();
        }}
      />

      {renaming && (
        <RenameOnDealDialog
          party={renaming}
          onOpenChange={(o) => {
            if (!o) setRenaming(null);
          }}
          pending={pending}
          onSubmit={(value) => {
            const target = renaming;
            setRenaming(null);
            run(
              () =>
                setDealEntityDisplayName({
                  dealId,
                  entityId: target.entityId,
                  displayName: value,
                }),
              value ? "Name updated on this deal" : "Back to the catalog name"
            );
          }}
        />
      )}

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => {
          if (!o) setRemoving(null);
        }}
        title="Remove this party from the deal?"
        description={
          removing
            ? `${removing.label} will no longer be part of this deal's org chart. ${
                removing.itemCount > 0
                  ? `Its ${removing.itemCount} checklist row${removing.itemCount === 1 ? "" : "s"} will be removed — but only the untouched ones. If any have work, documents or sign-offs on them, nothing is removed and you will be told which. `
                  : ""
              }The party stays in the catalog for other deals.`
            : undefined
        }
        confirmLabel="Remove from deal"
        destructive
        pending={pending}
        onConfirm={() => {
          const target = removing;
          if (!target) return;
          run(
            () => removeDealEntity({ dealId, entityId: target.entityId }),
            `${target.label} removed from this deal`
          );
        }}
      />
    </div>
  );
}

// -----------------------------------------------------------------------------

function RenameOnDealDialog({
  party,
  onOpenChange,
  pending,
  onSubmit,
}: {
  party: DealParty;
  onOpenChange: (o: boolean) => void;
  pending: boolean;
  onSubmit: (value: string | null) => void;
}) {
  const [value, setValue] = React.useState(party.displayName ?? "");

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Name on this deal</DialogTitle>
          <DialogDescription>
            {/* THE DISTINCTION THAT MATTERS. Renaming in the catalog changes
                every deal; this changes one. Saying so here is what stops
                someone forking the catalog to solve a one-deal problem. */}
            Use a different name for{" "}
            <span className="font-medium">{party.name}</span> on this deal only.
            Every other deal keeps the catalog name.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1 my-2">
          <Label className="text-xs font-medium">Name on this deal</Label>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={party.name}
            className="w-full h-9 px-2 text-sm border rounded border-nurock-border"
          />
          <p className="text-[11px] text-nurock-slate-light">
            Leave it empty to go back to the catalog name.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => onSubmit(value.trim() || null)}
            disabled={pending}
            className="bg-nurock-navy hover:bg-nurock-navy-dark text-white"
          >
            {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// -----------------------------------------------------------------------------

const TYPE_NEW = "__type__";

function AddPartyDialog({
  open,
  onOpenChange,
  dealId,
  pending,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  dealId: string;
  pending: boolean;
  onSaved: () => void;
}) {
  const [roles, setRoles] = React.useState<OrgChartRole[]>([]);
  const [allRoles, setAllRoles] = React.useState<
    Array<{ key: string; label: string }>
  >([]);
  const [roleKey, setRoleKey] = React.useState("");
  const [entityId, setEntityId] = React.useState(TYPE_NEW);
  const [name, setName] = React.useState("");
  const [catalog, setCatalog] = React.useState<
    Array<{ id: string; name: string; roleKey: string }>
  >([]);
  const [saving, setSaving] = React.useState(false);

  // Roles come from the deal's adopted packets when it has any, so the choices
  // match what the checklist can actually use. With no packet adopted there are
  // no repeating blocks, and a party would be recorded but produce no rows —
  // the dialog says so rather than silently doing nothing useful.
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const req = await getDealOrgChartRoles({ dealId });
      if (cancelled) return;
      if (req.error) {
        toast.error(req.error);
        return;
      }
      const list = req.roles ?? [];
      setRoles(list);
      const cat = await listCatalogEntities({
        roleKeys: list.length > 0 ? list.map((r) => r.key) : [],
      });
      if (cancelled) return;
      setCatalog(cat.entities ?? []);
      setAllRoles(list.map((r) => ({ key: r.key, label: r.label })));
      if (list.length > 0) setRoleKey(list[0].key);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, dealId]);

  const options = catalog.filter((c) => c.roleKey === roleKey);

  function save() {
    if (!roleKey) return;
    setSaving(true);
    void (async () => {
      const res = await saveDealOrgChart({
        dealId,
        entries: [
          entityId !== TYPE_NEW
            ? { entityId, roleKey }
            : { name: name.trim(), roleKey },
        ],
      });
      setSaving(false);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success("Party added to the deal");
      setName("");
      setEntityId(TYPE_NEW);
      onSaved();
    })();
  }

  const nothingToFill = roles.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a party to this deal</DialogTitle>
          <DialogDescription>
            Sections that repeat per party are created for each one you name
            here.
          </DialogDescription>
        </DialogHeader>

        {nothingToFill ? (
          // HONEST ABOUT DOING NOTHING. Recording a party against a deal whose
          // packets have no repeating blocks produces no rows, and letting
          // someone add one anyway would look like a broken feature rather than
          // a deal that has nothing to repeat.
          <div className="my-2 rounded-md border border-nurock-border bg-nurock-tan/[0.06] px-3 py-2.5 text-[12px] text-nurock-slate">
            None of this deal&apos;s packets have sections that repeat per party,
            so naming one here would not add anything to the checklist. Adopt a
            packet with repeating sections first.
          </div>
        ) : (
          <div className="space-y-3 my-2">
            <div className="space-y-1">
              <Label className="text-xs font-medium">Role</Label>
              <Select
                value={roleKey}
                onValueChange={(v) => {
                  setRoleKey(v);
                  setEntityId(TYPE_NEW);
                  setName("");
                }}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {allRoles.map((r) => (
                    <SelectItem key={r.key} value={r.key}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-medium">Party</Label>
              {options.length > 0 && (
                <Select
                  value={entityId}
                  onValueChange={(v) => {
                    setEntityId(v);
                    if (v !== TYPE_NEW) setName("");
                  }}
                >
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={TYPE_NEW}>Type a new name…</SelectItem>
                    {options.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {entityId === TYPE_NEW && (
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Legal name"
                  className="w-full h-9 px-2 text-sm border rounded border-nurock-border"
                />
              )}
              <p className="text-[11px] text-nurock-slate-light">
                A new name is saved to the shared catalog so later deals can pick
                it instead of retyping it.
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={
              pending ||
              saving ||
              nothingToFill ||
              !roleKey ||
              (entityId === TYPE_NEW && !name.trim())
            }
            className="bg-nurock-navy hover:bg-nurock-navy-dark text-white"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Add party"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
