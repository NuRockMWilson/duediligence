"use client";

// =============================================================================
// The entity catalog screen
// =============================================================================
// Grouped by role, because that is how the org chart asks for them and how the
// schema partitions them — the same name in two roles is two different parties,
// and a flat alphabetical list would hide that.
//
// USAGE IS ON EVERY ROW, not behind a click. "Used on 3 deals · 41 rows" is what
// decides whether a party can be deleted, whether renaming it is safe, and
// whether retiring it will surprise someone. Hiding it would leave every one of
// those decisions to guesswork.
//
// RETIRE IS PROMINENT, DELETE IS NOT. Both references are ON DELETE RESTRICT, so
// delete only ever succeeds for a party nothing has named; retiring hides it
// from every dropdown and keeps its history. The UI reflects that ordering
// rather than presenting them as equals.
// =============================================================================

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, RotateCcw, EyeOff, Pencil, Users } from "lucide-react";
import { Card, Badge } from "@/components/nurock-ui";
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
import type {
  CatalogEntity,
  EntityRoleRow,
} from "@/lib/data/diligence-entities";
import {
  createCatalogEntity,
  updateCatalogEntity,
  setCatalogEntityActive,
  deleteCatalogEntity,
} from "../actions";

export function EntitiesAdmin({
  roles,
  entities,
  canEdit,
}: {
  roles: EntityRoleRow[];
  entities: CatalogEntity[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<CatalogEntity | null>(null);
  const [toDelete, setToDelete] = React.useState<CatalogEntity | null>(null);
  const [showRetired, setShowRetired] = React.useState(false);

  const byRole = React.useMemo(() => {
    const m = new Map<string, CatalogEntity[]>();
    for (const e of entities) {
      if (!showRetired && !e.isActive) continue;
      const arr = m.get(e.roleKey) ?? [];
      arr.push(e);
      m.set(e.roleKey, arr);
    }
    return m;
  }, [entities, showRetired]);

  const retiredCount = entities.filter((e) => !e.isActive).length;

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
    <>
      <div className="flex items-center gap-2">
        {retiredCount > 0 && (
          <button
            onClick={() => setShowRetired((v) => !v)}
            className={`h-8 px-3 rounded text-[12px] border transition ${
              showRetired
                ? "border-nurock-navy/30 bg-nurock-navy/5 text-nurock-navy"
                : "border-nurock-border bg-white text-nurock-slate hover:bg-nurock-gray"
            }`}
          >
            {showRetired ? "Hiding" : "Show"} {retiredCount} retired
          </button>
        )}
        {canEdit && (
          <Button
            size="sm"
            className="h-8 ml-auto bg-nurock-navy hover:bg-nurock-navy-dark text-white"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="w-3.5 h-3.5 mr-1.5" /> Add a party
          </Button>
        )}
      </div>

      {entities.length === 0 ? (
        <Card className="p-10 text-center bg-white border-dashed border-2 border-nurock-border">
          <Users className="w-10 h-10 mx-auto text-nurock-slate-light mb-3" />
          <h2 className="font-display text-base text-nurock-black mb-1">
            No parties yet
          </h2>
          <p className="text-sm text-nurock-slate-light max-w-[460px] mx-auto">
            Parties are created the first time you type them into a deal&apos;s
            org chart, and appear here so later deals can reuse them.
          </p>
        </Card>
      ) : (
        <div className="space-y-5">
          {roles.map((role) => {
            const rows = byRole.get(role.key) ?? [];
            if (rows.length === 0) return null;
            return (
              <div key={role.key} className="space-y-1.5">
                <div className="flex items-baseline gap-2">
                  <h2 className="font-display text-[11.5px] uppercase tracking-wider text-nurock-slate">
                    {role.label}
                  </h2>
                  <span className="text-[11px] text-nurock-slate-light">
                    {rows.length}
                  </span>
                </div>
                <Card className="bg-white overflow-hidden">
                  <table className="w-full text-[13px]">
                    <tbody>
                      {rows.map((e) => (
                        <tr
                          key={e.id}
                          className="border-b border-nurock-border/60 last:border-0"
                        >
                          <td className="px-4 py-2.5">
                            <span
                              className={
                                e.isActive
                                  ? "text-nurock-black"
                                  : "text-nurock-slate-light"
                              }
                            >
                              {e.name}
                            </span>
                            {!e.isActive && (
                              <Badge tone="slate">
                                <span className="ml-2">Retired</span>
                              </Badge>
                            )}
                            {e.notes && (
                              <div className="text-[11px] text-nurock-slate-light mt-0.5">
                                {e.notes}
                              </div>
                            )}
                          </td>
                          {/* USAGE, ALWAYS VISIBLE. It decides whether a delete
                              can succeed and whether a rename is safe. */}
                          <td className="px-3 py-2.5 text-[11.5px] text-nurock-slate-light whitespace-nowrap">
                            {e.dealCount === 0 && e.itemCount === 0 ? (
                              <span className="italic">Not used yet</span>
                            ) : (
                              <>
                                {e.dealCount} deal{e.dealCount === 1 ? "" : "s"}
                                {" · "}
                                {e.itemCount} row{e.itemCount === 1 ? "" : "s"}
                              </>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right whitespace-nowrap">
                            {canEdit && (
                              <div className="inline-flex items-center gap-0.5">
                                <IconBtn
                                  title="Rename or add a note"
                                  onClick={() => setEditing(e)}
                                  disabled={pending}
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </IconBtn>
                                <IconBtn
                                  title={
                                    e.isActive
                                      ? "Retire — hides it from org charts, keeps its history"
                                      : "Bring back into use"
                                  }
                                  onClick={() =>
                                    run(
                                      () =>
                                        setCatalogEntityActive({
                                          entityId: e.id,
                                          isActive: !e.isActive,
                                        }),
                                      e.isActive
                                        ? `${e.name} retired`
                                        : `${e.name} is back in use`
                                    )
                                  }
                                  disabled={pending}
                                >
                                  {e.isActive ? (
                                    <EyeOff className="w-3.5 h-3.5" />
                                  ) : (
                                    <RotateCcw className="w-3.5 h-3.5" />
                                  )}
                                </IconBtn>
                                {/* DELETE ONLY WHERE IT CAN WORK. Both foreign
                                    keys are ON DELETE RESTRICT, so offering it
                                    on a party in use would be offering a button
                                    guaranteed to fail. */}
                                <IconBtn
                                  title={
                                    e.deletable
                                      ? "Delete permanently"
                                      : `In use on ${e.dealCount} deal(s) — retire it instead`
                                  }
                                  onClick={() => setToDelete(e)}
                                  disabled={pending || !e.deletable}
                                  danger
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </IconBtn>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              </div>
            );
          })}
        </div>
      )}

      <EntityDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        roles={roles}
        pending={pending}
        onSubmit={(v) =>
          run(
            () =>
              createCatalogEntity({
                name: v.name,
                roleKey: v.roleKey,
                notes: v.notes,
              }),
            `${v.name} added`
          )
        }
      />

      {editing && (
        <EntityDialog
          open
          onOpenChange={(o) => {
            if (!o) setEditing(null);
          }}
          roles={roles}
          pending={pending}
          existing={editing}
          onSubmit={(v) => {
            const target = editing;
            setEditing(null);
            run(
              () =>
                updateCatalogEntity({
                  entityId: target.id,
                  name: v.name,
                  notes: v.notes,
                }),
              "Saved"
            );
          }}
        />
      )}

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => {
          if (!o) setToDelete(null);
        }}
        title="Delete this party?"
        description={
          toDelete
            ? `Permanently delete "${toDelete.name}". Nothing references it, so nothing else changes. If you might use it again, retire it instead — retiring hides it from org charts and can be undone.`
            : undefined
        }
        confirmLabel="Delete"
        destructive
        pending={pending}
        onConfirm={() => {
          const target = toDelete;
          if (!target) return;
          run(
            () => deleteCatalogEntity({ entityId: target.id }),
            `${target.name} deleted`
          );
        }}
      />
    </>
  );
}

function IconBtn({
  children,
  title,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={`p-1.5 rounded transition disabled:opacity-30 disabled:cursor-not-allowed ${
        danger
          ? "text-nurock-slate-light hover:text-red-600 hover:bg-red-50"
          : "text-nurock-slate-light hover:text-nurock-navy hover:bg-nurock-gray"
      }`}
    >
      {children}
    </button>
  );
}

function EntityDialog({
  open,
  onOpenChange,
  roles,
  pending,
  existing,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  roles: EntityRoleRow[];
  pending: boolean;
  existing?: CatalogEntity;
  onSubmit: (v: { name: string; roleKey: string; notes: string | null }) => void;
}) {
  const [name, setName] = React.useState(existing?.name ?? "");
  const [roleKey, setRoleKey] = React.useState(
    existing?.roleKey ?? roles[0]?.key ?? ""
  );
  const [notes, setNotes] = React.useState(existing?.notes ?? "");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{existing ? "Edit party" : "Add a party"}</DialogTitle>
          <DialogDescription>
            {existing
              ? "This party is shared across every deal that names it."
              : "Parties are shared across deals, so enter the legal name once and reuse it."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 my-2">
          <div className="space-y-1">
            <Label className="text-xs font-medium">Name *</Label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Marlin HP GP, LLC"
              className="w-full h-9 px-2 text-sm border rounded border-nurock-border"
            />
          </div>

          {/* ROLE IS FIXED AFTER CREATION. The same name in two roles is two
              different parties, and the role is half of how every lookup finds
              one — changing it would silently re-point existing rows at a party
              that is, by the catalog's own definition, not the same one. */}
          <div className="space-y-1">
            <Label className="text-xs font-medium">Role</Label>
            {existing ? (
              <div className="h-9 px-2 flex items-center text-sm text-nurock-slate bg-nurock-tan/[0.07] rounded border border-nurock-border">
                {existing.roleLabel}
              </div>
            ) : (
              <Select value={roleKey} onValueChange={setRoleKey}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r.key} value={r.key}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {existing && (
              <p className="text-[11px] text-nurock-slate-light">
                A party&apos;s role cannot change — the same name in another role
                is a different party. Add a new one instead.
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label className="text-xs font-medium">Notes</Label>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional — e.g. 25% owner of GP"
              className="w-full h-9 px-2 text-sm border rounded border-nurock-border"
            />
          </div>

          {/* THE PORTFOLIO-WIDE CONSEQUENCE, said before it happens. */}
          {existing && existing.dealCount > 0 && (
            <div className="rounded-md border border-nurock-tan-dark/50 bg-[#FDF6EC] px-3 py-2 text-[11.5px] text-nurock-slate">
              Renaming changes this party on{" "}
              <strong>
                {existing.dealCount} deal{existing.dealCount === 1 ? "" : "s"}
              </strong>
              . If only one deal&apos;s paperwork uses a different name, override
              it on that deal instead of renaming it here.
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => onSubmit({ name, roleKey, notes: notes || null })}
            disabled={pending || !name.trim() || !roleKey}
            className="bg-nurock-navy hover:bg-nurock-navy-dark text-white"
          >
            {pending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : existing ? (
              "Save"
            ) : (
              "Add party"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
