// =============================================================================
// Access & Roles — access library (Phase 9 r1)
// =============================================================================
// One source of truth for "what can the current user do," read from the shared
// RBAC tables (app_user_roles → app_role_permissions). Mirrors the SQL
// functions in migration 0074 so the app layer and future RLS agree.
//
// Server-side only (uses the server Supabase client). The same file is ported
// into nurock-underwriting in r3.
//
// Enforcement is added in r2 — this module just exposes the checks. It fails
// CLOSED: an unauthenticated user, a user with no role, or a query error all
// yield "no access."
// =============================================================================

import { createClient } from "@/lib/supabase/server";

export type ModuleKey = "underwriting" | "devmgmt";
export type ActionKey = "view" | "edit" | "approve" | "export" | "manage_users";

export interface UserAccess {
  userId: string;
  email: string;
  displayName: string | null;
  /** Holds the admin role in at least one module → can manage users. */
  isOrgAdmin: boolean;
  /** module → role key (admin/manager/contributor/viewer). */
  roles: Record<string, string>;
  /** Set of "module:action" the user holds (e.g. "devmgmt:approve"). */
  actions: Set<string>;
}

// Untyped accessor — the app_* tables/functions aren't in the generated types.
type UntypedSb = {
  from: (t: string) => {
    select: (c: string) => {
      eq: (c: string, v: string) => {
        maybeSingle: () => Promise<{ data: Record<string, unknown> | null }>;
      } & Promise<{ data: Record<string, unknown>[] | null }>;
    };
  };
  rpc: (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ data: { module: string; action: string }[] | null }>;
};

export async function getCurrentUserAccess(): Promise<UserAccess | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const sb = supabase as unknown as UntypedSb;
  try {
    const [profileRes, roleRes, actionRes] = await Promise.all([
      sb.from("app_users").select("display_name, email").eq("user_id", user.id).maybeSingle(),
      sb.from("app_user_roles").select("module, role_key").eq("user_id", user.id),
      sb.rpc("app_user_actions", { p_uid: user.id }),
    ]);

    const profile = profileRes.data as
      | { display_name: string | null; email: string | null }
      | null;

    const roles: Record<string, string> = {};
    for (const r of (roleRes.data ?? []) as Array<{ module: string; role_key: string }>) {
      roles[r.module] = r.role_key;
    }

    const actions = new Set<string>();
    for (const a of actionRes.data ?? []) {
      actions.add(`${a.module}:${a.action}`);
    }

    return {
      userId: user.id,
      email: profile?.email ?? user.email ?? "",
      displayName: profile?.display_name ?? null,
      isOrgAdmin: Object.values(roles).includes("admin"),
      roles,
      actions,
    };
  } catch {
    // Fail closed — no access on any error.
    return {
      userId: user.id,
      email: user.email ?? "",
      displayName: null,
      isOrgAdmin: false,
      roles: {},
      actions: new Set(),
    };
  }
}

/** True if the user holds `action` within `module`. */
export function hasPermission(
  access: UserAccess | null,
  module: ModuleKey,
  action: ActionKey
): boolean {
  return !!access && access.actions.has(`${module}:${action}`);
}

/** True if the user has any role in the module (i.e. can open it at all). */
export function canAccessModule(
  access: UserAccess | null,
  module: ModuleKey
): boolean {
  return !!access && access.roles[module] != null;
}

/** The user's role key within a module, or null. */
export function moduleRole(
  access: UserAccess | null,
  module: ModuleKey
): string | null {
  return access?.roles[module] ?? null;
}

/**
 * Server-action guard. Throws when the current user lacks the permission, so
 * the action aborts before mutating. Returns the access object on success.
 */
export async function requirePermission(
  module: ModuleKey,
  action: ActionKey
): Promise<UserAccess> {
  const access = await getCurrentUserAccess();
  if (!hasPermission(access, module, action)) {
    throw new Error(
      `Permission denied — you need "${action}" access in ${module}.`
    );
  }
  return access as UserAccess;
}

/** Server-action guard for org-admin-only operations (user management). */
export async function requireOrgAdmin(): Promise<UserAccess> {
  const access = await getCurrentUserAccess();
  if (!access?.isOrgAdmin) {
    throw new Error("Permission denied — org admin only.");
  }
  return access;
}

/**
 * Claim a pending invite for the signed-in user (matches their auth email to
 * an unclaimed app_user_invites row, server-side via the SECURITY DEFINER
 * function). Returns true if something was claimed (caller should re-fetch
 * access). Safe to call when a user appears to have no access.
 */
export async function claimPendingInvite(): Promise<boolean> {
  const supabase = await createClient();
  try {
    const { data } = await (
      supabase as unknown as {
        rpc: (fn: string) => Promise<{ data: boolean | null }>;
      }
    ).rpc("claim_pending_invite");
    return data === true;
  } catch {
    return false;
  }
}

/**
 * Whether the RBAC system has any role assignments yet. The module gate uses
 * this to stay BOOTSTRAP-SAFE: if nobody has been assigned a role (e.g. the
 * migration/backfill hasn't run), enforcement stays off so the app can't lock
 * everyone out. Once at least one assignment exists, the gate enforces.
 */
export async function isRbacInitialized(): Promise<boolean> {
  const supabase = await createClient();
  try {
    const { count } = await (
      supabase as unknown as {
        from: (t: string) => {
          select: (
            c: string,
            opts: { count: "exact"; head: true }
          ) => Promise<{ count: number | null }>;
        };
      }
    )
      .from("app_user_roles")
      .select("user_id", { count: "exact", head: true });
    return (count ?? 0) > 0;
  } catch {
    return false; // table missing / error → treat as uninitialized (no gate)
  }
}
