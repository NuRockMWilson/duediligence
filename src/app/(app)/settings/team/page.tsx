import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Users } from "lucide-react";
import { getCurrentUserAccess } from "@/lib/auth/access";
import TeamList, { type TeamMember } from "./_components/team-list";

// ============================================================================
// Settings → Users & Access (Phase 9 r2)
// ----------------------------------------------------------------------------
// Org-admin-only. Lists the user directory and lets an admin assign each user
// a role PER module (Development, Underwriting) via the shared RBAC tables.
// ============================================================================

export default async function TeamPage() {
  const supabase = await createClient();
  const access = await getCurrentUserAccess();
  if (!access) redirect("/login");

  // Admin-only (org admin, or legacy CFO as a fallback).
  let isAdmin = access.isOrgAdmin;
  if (!isAdmin) {
    const { data: me } = await supabase
      .from("app_users")
      .select("is_cfo")
      .eq("user_id", access.userId)
      .maybeSingle();
    isAdmin = !!me?.is_cfo;
  }
  if (!isAdmin) redirect("/no-access");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const [{ data: appUsers }, { data: roleRows }, { data: inviteRows }] =
    await Promise.all([
      supabase
        .from("app_users")
        .select("user_id, display_name, email, created_at")
        .order("created_at", { ascending: true }),
      sb.from("app_user_roles").select("user_id, module, role_key"),
      sb
        .from("app_user_invites")
        .select("email, display_name, devmgmt_role, underwriting_role, diligence_role, created_at")
        .is("claimed_at", null)
        .order("created_at", { ascending: true }),
    ]);

  const rolesByUser: Record<string, Record<string, string>> = {};
  for (const r of roleRows ?? []) {
    (rolesByUser[r.user_id] ??= {})[r.module] = r.role_key;
  }

  // RLS readiness probe (Phase 9 r4). Runs app_auth_probe() through the user's
  // SSR session — if auth_uid resolves here, auth.uid()-keyed RLS is safe to
  // enable. Null/missing → the RLS rollout (0076/0077) must NOT be applied yet.
  let probe: {
    auth_uid: string | null;
    auth_role: string | null;
    has_devmgmt_view: boolean | null;
    is_org_admin: boolean | null;
    rls_ready: boolean | null;
  } | null = null;
  try {
    const { data } = await (
      supabase as unknown as {
        rpc: (fn: string) => Promise<{ data: typeof probe }>;
      }
    ).rpc("app_auth_probe");
    probe = data ?? null;
  } catch {
    probe = null;
  }

  const members: TeamMember[] = (
    (appUsers ?? []) as Array<{
      user_id: string;
      display_name: string | null;
      email: string | null;
    }>
  ).map((u) => ({
    userId: u.user_id,
    displayName: u.display_name,
    email: u.email,
    devmgmtRole: rolesByUser[u.user_id]?.devmgmt ?? null,
    underwritingRole: rolesByUser[u.user_id]?.underwriting ?? null,
    diligenceRole: rolesByUser[u.user_id]?.diligence ?? null,
  }));

  const invites = (
    (inviteRows ?? []) as Array<{
      email: string;
      display_name: string | null;
      devmgmt_role: string | null;
      underwriting_role: string | null;
      diligence_role: string | null;
    }>
  ).map((i) => ({
    email: i.email,
    displayName: i.display_name,
    devmgmtRole: i.devmgmt_role,
    underwritingRole: i.underwriting_role,
    diligenceRole: i.diligence_role,
  }));

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center gap-3">
        <Users className="w-6 h-6 text-nurock-navy" />
        <div>
          <h1 className="font-display text-2xl tracking-wider text-nurock-navy">
            Users &amp; Access
          </h1>
          <p className="text-sm text-nurock-slate-light">
            Assign each user a role per module. Roles apply across both the
            Underwriting and Development apps.
          </p>
        </div>
      </div>

      <Card className="p-0 overflow-hidden">
        <TeamList members={members} invites={invites} currentUserId={access.userId} />
      </Card>

      <div className="text-xs text-nurock-slate-light leading-relaxed">
        <span className="font-medium text-nurock-slate">Roles:</span>{" "}
        Admin (full + manage users) · Manager (edit, approve, export) ·
        Contributor (create &amp; edit) · Viewer (read-only). Users must sign up
        through the normal login first; add them by their auth user ID, then
        assign roles.
      </div>

      {/* RLS readiness diagnostic (Phase 9 r4) */}
      <Card className="p-4 bg-white">
        <h2 className="font-display text-sm uppercase tracking-wider text-nurock-navy font-semibold mb-2">
          RLS Diagnostic
        </h2>
        {!probe ? (
          <p className="text-xs text-nurock-slate-light">
            Probe unavailable — apply migration{" "}
            <code className="font-mono">0075_rls_helpers_and_probe.sql</code> to
            enable it.
          </p>
        ) : (
          <div className="space-y-1.5 text-[13px]">
            <DiagRow
              label="auth.uid() resolves in-app"
              ok={probe.rls_ready === true}
              value={probe.auth_uid ? probe.auth_uid.slice(0, 8) + "…" : "null"}
            />
            <DiagRow label="auth role" ok={probe.auth_role === "authenticated"} value={probe.auth_role ?? "—"} />
            <DiagRow label="has devmgmt view" ok={!!probe.has_devmgmt_view} value={probe.has_devmgmt_view ? "yes" : "no"} />
            <DiagRow label="org admin" ok={!!probe.is_org_admin} value={probe.is_org_admin ? "yes" : "no"} />
            <p
              className={`mt-2 text-xs rounded-md px-3 py-2 ${
                probe.rls_ready
                  ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                  : "bg-amber-50 text-amber-800 border border-amber-200"
              }`}
            >
              {probe.rls_ready
                ? "Ready: auth.uid() resolves on this (devmgmt SSR) path — the RLS pilot (0076) is safe to apply, then verify before the rollout (0077)."
                : "Not ready: auth.uid() did not resolve. Do NOT apply the RLS rollout (0076/0077) — it would block data access. Resolve auth propagation first."}
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}

function DiagRow({ label, ok, value }: { label: string; ok: boolean; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-nurock-slate">{label}</span>
      <span
        className={`font-mono text-xs px-1.5 py-0.5 rounded ${
          ok ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
