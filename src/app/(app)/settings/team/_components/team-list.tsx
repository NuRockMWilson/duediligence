"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Trash2, Loader2, Mail, X } from "lucide-react";
import { toast } from "sonner";
import {
  inviteUser,
  revokeInvite,
  setModuleRole,
  removeTeamMember,
} from "../actions";

export interface TeamMember {
  userId: string;
  displayName: string | null;
  email: string | null;
  devmgmtRole: string | null;
  underwritingRole: string | null;
}

export interface PendingInvite {
  email: string;
  displayName: string | null;
  devmgmtRole: string | null;
  underwritingRole: string | null;
}

const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "No access" },
  { value: "viewer", label: "Viewer" },
  { value: "contributor", label: "Contributor" },
  { value: "manager", label: "Manager" },
  { value: "admin", label: "Admin" },
];

const roleLabel = (k: string | null) =>
  ROLE_OPTIONS.find((o) => o.value === (k ?? ""))?.label ?? "No access";

export default function TeamList({
  members,
  invites,
  currentUserId,
}: {
  members: TeamMember[];
  invites: PendingInvite[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<TeamMember | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleRoleChange(userId: string, module: string, value: string) {
    startTransition(async () => {
      const res = await setModuleRole({ userId, module, roleKey: value === "" ? null : value });
      if ("error" in res && res.error) {
        toast.error(res.error);
        router.refresh();
        return;
      }
      toast.success("Role updated");
      router.refresh();
    });
  }

  function handleRevoke(email: string) {
    startTransition(async () => {
      const res = await revokeInvite(email);
      if ("error" in res && res.error) {
        toast.error(res.error);
        return;
      }
      toast.success("Invite revoked");
      router.refresh();
    });
  }

  return (
    <div>
      <div className="px-4 py-3 bg-nurock-gray/40 border-b border-nurock-border flex items-center justify-between">
        <h2 className="font-display text-sm uppercase tracking-wider text-nurock-navy font-semibold">
          Users ({members.length})
        </h2>
        <Button
          size="sm"
          onClick={() => setInviteOpen(true)}
          className="bg-nurock-navy hover:bg-nurock-navy-dark h-8"
        >
          <Mail className="w-4 h-4 mr-1" />
          Invite user
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-nurock-border">
              <th className="px-4 py-2 text-left text-[10px] uppercase tracking-wider font-display text-nurock-slate">Name</th>
              <th className="px-4 py-2 text-left text-[10px] uppercase tracking-wider font-display text-nurock-slate">Email</th>
              <th className="px-4 py-2 text-left text-[10px] uppercase tracking-wider font-display text-nurock-slate w-44">Development</th>
              <th className="px-4 py-2 text-left text-[10px] uppercase tracking-wider font-display text-nurock-slate w-44">Underwriting</th>
              <th className="px-4 py-2 text-right text-[10px] uppercase tracking-wider font-display text-nurock-slate w-16" />
            </tr>
          </thead>
          <tbody className="divide-y divide-nurock-border">
            {members.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-nurock-slate-light">
                  No users yet. Click Invite user to get started.
                </td>
              </tr>
            ) : (
              members.map((m) => (
                <tr key={m.userId} className="hover:bg-nurock-gray/20">
                  <td className="px-4 py-2">
                    <div className="font-medium text-nurock-black text-sm">
                      {m.displayName || "—"}
                      {m.userId === currentUserId && (
                        <span className="ml-2 text-[10px] text-nurock-slate-light uppercase tracking-wider">(you)</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-nurock-slate text-xs font-mono">{m.email || "—"}</td>
                  <td className="px-4 py-2">
                    <RoleSelect value={m.devmgmtRole ?? ""} disabled={isPending} onChange={(v) => handleRoleChange(m.userId, "devmgmt", v)} />
                  </td>
                  <td className="px-4 py-2">
                    <RoleSelect value={m.underwritingRole ?? ""} disabled={isPending} onChange={(v) => handleRoleChange(m.userId, "underwriting", v)} />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirmDelete(m)}
                      className="h-7 w-7 p-0 text-red-700 hover:bg-red-50"
                      title="Remove user"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pending invites */}
      {invites.length > 0 && (
        <div className="border-t border-nurock-border">
          <div className="px-4 py-2 bg-nurock-gray/20 text-[10px] uppercase tracking-wider font-display text-nurock-slate">
            Pending invites ({invites.length}) — activate automatically on first sign-in
          </div>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-nurock-border">
              {invites.map((inv) => (
                <tr key={inv.email} className="hover:bg-nurock-gray/10">
                  <td className="px-4 py-2 text-nurock-slate text-xs font-mono w-[28rem]">
                    <Mail className="w-3.5 h-3.5 inline mr-1.5 text-nurock-slate-light" />
                    {inv.email}
                    {inv.displayName ? (
                      <span className="ml-2 text-nurock-slate-light not-italic">{inv.displayName}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2 text-[11px] text-nurock-slate">
                    Dev: {roleLabel(inv.devmgmtRole)} · UW: {roleLabel(inv.underwritingRole)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRevoke(inv.email)}
                      disabled={isPending}
                      className="h-7 px-2 text-nurock-slate hover:text-red-700 hover:bg-red-50"
                      title="Revoke invite"
                    >
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} onSuccess={() => router.refresh()} />

      {confirmDelete && (
        <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Remove user?</DialogTitle>
              <DialogDescription>
                {confirmDelete.displayName || confirmDelete.email} will lose all roles across
                modules. Their Supabase Auth account stays intact.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmDelete(null)} disabled={isPending}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  startTransition(async () => {
                    const result = await removeTeamMember(confirmDelete.userId);
                    if ("error" in result && result.error) {
                      toast.error(result.error);
                      return;
                    }
                    toast.success("User removed");
                    setConfirmDelete(null);
                    router.refresh();
                  });
                }}
                disabled={isPending}
                className="bg-red-600 hover:bg-red-700"
              >
                {isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
                Remove
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function RoleSelect({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="w-full h-8 rounded border border-nurock-border bg-white px-2 text-xs text-nurock-black disabled:opacity-60"
    >
      {ROLE_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function InviteDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSuccess: () => void;
}) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [devRole, setDevRole] = useState("");
  const [uwRole, setUwRole] = useState("");
  const [isPending, startTransition] = useTransition();

  function reset() {
    setEmail("");
    setDisplayName("");
    setDevRole("");
    setUwRole("");
  }

  function handleSubmit() {
    startTransition(async () => {
      const result = await inviteUser({
        email: email.trim(),
        displayName: displayName.trim(),
        devmgmtRole: devRole || null,
        underwritingRole: uwRole || null,
      });
      if ("error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.alreadyActive
          ? "Roles applied — user already had an account"
          : "Invite sent — access activates on their first sign-in"
      );
      reset();
      onOpenChange(false);
      onSuccess();
    });
  }

  const canSubmit =
    email.trim().includes("@") && (devRole !== "" || uwRole !== "") && !isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite user</DialogTitle>
          <DialogDescription>
            Enter an email and pick roles. The user signs in with that email
            (magic link) and their access activates automatically — no UUID
            needed. If they already have an account, roles apply right away.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 my-2">
          <div className="space-y-1">
            <Label className="text-xs font-medium">Email</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. user@nurock.com"
              disabled={isPending}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-medium">Display name (optional)</Label>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Jane Smith"
              disabled={isPending}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs font-medium">Development role</Label>
              <select
                value={devRole}
                onChange={(e) => setDevRole(e.target.value)}
                disabled={isPending}
                className="w-full h-9 rounded border border-nurock-border bg-white px-2 text-sm"
              >
                {ROLE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium">Underwriting role</Label>
              <select
                value={uwRole}
                onChange={(e) => setUwRole(e.target.value)}
                disabled={isPending}
                className="w-full h-9 rounded border border-nurock-border bg-white px-2 text-sm"
              >
                {ROLE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              reset();
              onOpenChange(false);
            }}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit} className="bg-nurock-navy hover:bg-nurock-navy-dark">
            {isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
            Send invite
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
