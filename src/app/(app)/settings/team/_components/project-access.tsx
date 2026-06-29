"use client";

// =============================================================================
// Project Access — per-project access grants (Settings → Users & Access)
// =============================================================================
// Per-project view: pick a project, then grant/revoke each user's access to it.
// Owners and org admins always have access implicitly (shown disabled). For
// everyone else, the checkbox writes/removes a deal_access row (migration 0097).
// The grant controls WHICH projects a user can reach; their module role still
// governs WHAT they can do (Viewer = read, Contributor+ = edit), enforced in-app.
//
// Mirror of nurock-devmgmt's component — the deal_access table is shared, so a
// grant made here or there is the same grant. The only difference: this app
// also has a Diligence role, so the org-admin check considers it too.
// =============================================================================

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";
import { setDealAccess } from "../actions";
import type { TeamMember } from "./team-list";

export interface ProjectOption {
  id: string;
  name: string;
  stage: string | null;
  ownerId: string | null;
}

export default function ProjectAccess({
  projects,
  members,
  grantsByDeal,
  ready,
}: {
  projects: ProjectOption[];
  members: TeamMember[];
  grantsByDeal: Record<string, string[]>;
  ready: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selectedId, setSelectedId] = useState<string>(projects[0]?.id ?? "");

  const selected = useMemo(
    () => projects.find((p) => p.id === selectedId) ?? null,
    [projects, selectedId]
  );
  const granted = useMemo(
    () => new Set(grantsByDeal[selectedId] ?? []),
    [grantsByDeal, selectedId]
  );

  function toggle(userId: string, grant: boolean) {
    if (!selectedId) return;
    startTransition(async () => {
      const res = await setDealAccess({ dealId: selectedId, userId, grant });
      if ("error" in res && res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(grant ? "Access granted" : "Access revoked");
      router.refresh();
    });
  }

  const isAdmin = (m: TeamMember) =>
    m.devmgmtRole === "admin" ||
    m.underwritingRole === "admin" ||
    m.diligenceRole === "admin";

  if (!ready) {
    return (
      <div className="p-4 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md">
        Run migration <code className="font-mono">0097_deal_access.sql</code> in
        Supabase to enable Project Access.
      </div>
    );
  }
  if (projects.length === 0) {
    return (
      <div className="p-4 text-sm text-nurock-slate-light">
        No projects yet — create a deal first.
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <label className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium text-nurock-slate">Project:</span>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="rounded border border-nurock-border bg-white px-2 py-1.5 text-sm min-w-[260px] focus:outline-none focus:ring-1 focus:ring-nurock-navy"
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.stage ? ` · ${p.stage}` : ""}
            </option>
          ))}
        </select>
        <span className="text-xs text-nurock-slate-light">
          Check a user to grant them access to this project.
        </span>
      </label>

      <div className="divide-y divide-nurock-border rounded-md border border-nurock-border overflow-hidden">
        {members.length === 0 && (
          <div className="px-3 py-3 text-sm text-nurock-slate-light italic">
            No users in the directory yet.
          </div>
        )}
        {members.map((m) => {
          const owner = !!selected?.ownerId && selected.ownerId === m.userId;
          const admin = isAdmin(m);
          const has = granted.has(m.userId);
          const subParts = [
            m.email,
            m.diligenceRole ? `Dil: ${m.diligenceRole}` : null,
            m.devmgmtRole ? `Dev: ${m.devmgmtRole}` : null,
            m.underwritingRole ? `UW: ${m.underwritingRole}` : null,
          ].filter(Boolean);
          return (
            <div
              key={m.userId}
              className="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-nurock-gray/40 transition-colors"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-nurock-black truncate">
                  {m.displayName?.trim() || m.email || m.userId}
                </div>
                <div className="text-xs text-nurock-slate-light truncate">
                  {subParts.join(" · ")}
                </div>
              </div>
              {owner ? (
                <span className="shrink-0 text-[10px] uppercase tracking-wider font-display px-2 py-0.5 rounded-full bg-nurock-navy/10 text-nurock-navy">
                  Owner
                </span>
              ) : admin ? (
                <span
                  className="shrink-0 text-[10px] uppercase tracking-wider font-display px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200"
                  title="Org admins can access every project"
                >
                  Admin · all projects
                </span>
              ) : (
                <label className="shrink-0 inline-flex items-center gap-2 cursor-pointer select-none">
                  <span className="text-xs text-nurock-slate-light">
                    {has ? "Access" : "No access"}
                  </span>
                  <input
                    type="checkbox"
                    checked={has}
                    disabled={isPending}
                    onChange={(e) => toggle(m.userId, e.target.checked)}
                    className="h-4 w-4 accent-nurock-navy cursor-pointer disabled:opacity-50"
                    aria-label={`${has ? "Revoke" : "Grant"} access to ${
                      selected?.name ?? "project"
                    } for ${m.displayName ?? m.email ?? m.userId}`}
                  />
                </label>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-1.5 text-xs text-nurock-slate-light">
        <KeyRound className="w-3.5 h-3.5 shrink-0" />
        Access controls which projects a user can open. Their role (Viewer /
        Contributor / Manager) governs what they can do inside.
      </div>
    </div>
  );
}
