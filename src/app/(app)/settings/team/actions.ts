"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { getCurrentUserAccess } from "@/lib/auth/access";

// =============================================================================
// Users & Access — server actions (Phase 9 r2)
// =============================================================================
// Manages the user registry (app_users) and per-module role assignments
// (app_user_roles). Org-admin gated. Roles drive access in BOTH apps via the
// shared RBAC tables from migration 0074.
//
// Users must already have a Supabase Auth account; an admin registers them
// here (by user_id) and assigns a role per module.
// =============================================================================

const MODULES = new Set(["devmgmt", "underwriting", "diligence"]);
const ROLES = new Set(["admin", "manager", "contributor", "viewer"]);

type UntypedSb = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (t: string) => any;
};

/** Org-admin gate. Org admin = `admin` role in any module; legacy is_cfo is a
 *  fallback so the original CFO can never be locked out of administration. */
async function requireAdmin() {
  const supabase = await createClient();
  const access = await getCurrentUserAccess();
  if (!access) return { error: "Not authenticated" } as const;
  if (access.isOrgAdmin) return { supabase, access } as const;

  const { data: me } = await supabase
    .from("app_users")
    .select("is_cfo")
    .eq("user_id", access.userId)
    .maybeSingle();
  if (me?.is_cfo) return { supabase, access } as const;

  return { error: "Only administrators can manage users and roles." } as const;
}

/** Count of distinct users holding the admin role anywhere. */
async function adminCount(sb: UntypedSb): Promise<number> {
  const { data } = await sb
    .from("app_user_roles")
    .select("user_id")
    .eq("role_key", "admin");
  const ids = new Set(
    ((data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id)
  );
  return ids.size;
}

/**
 * Register an existing auth.users record in the app_users directory. Roles are
 * assigned separately via setModuleRole. FK violation → user hasn't signed up.
 */
export async function addTeamMember(input: {
  userId: string;
  displayName: string;
  email: string;
}) {
  const ctx = await requireAdmin();
  if ("error" in ctx) return ctx;

  const { error } = await ctx.supabase.from("app_users").insert({
    user_id: input.userId.trim(),
    display_name: input.displayName.trim(),
    email: input.email.trim(),
    is_pm: false,
    is_cfo: false,
  });

  if (error) {
    if (error.code === "23503")
      return {
        error:
          "That user_id doesn't exist in auth.users — the user must sign up first.",
      };
    if (error.code === "23505")
      return { error: "That user is already in the directory." };
    return { error: error.message };
  }

  revalidatePath("/settings/team");
  return { success: true };
}

/**
 * Assign (or clear) a user's role within a module. roleKey null removes the
 * assignment. Blocks removing/downgrading the last remaining admin.
 */
export async function setModuleRole(input: {
  userId: string;
  module: string;
  roleKey: string | null;
}) {
  const ctx = await requireAdmin();
  if ("error" in ctx) return ctx;
  if (!MODULES.has(input.module)) return { error: "Unknown module." };
  if (input.roleKey !== null && !ROLES.has(input.roleKey))
    return { error: "Unknown role." };

  const sb = ctx.supabase as unknown as UntypedSb;

  // Last-admin guard: if this change would drop the user out of the admin role
  // and they're the only admin left, block it.
  if (input.roleKey !== "admin") {
    const { data: current } = await sb
      .from("app_user_roles")
      .select("role_key")
      .eq("user_id", input.userId)
      .eq("module", input.module)
      .maybeSingle();
    const wasAdmin = (current as { role_key?: string } | null)?.role_key === "admin";
    if (wasAdmin && (await adminCount(sb)) <= 1) {
      // Is this their only admin assignment?
      const { data: adminRows } = await sb
        .from("app_user_roles")
        .select("module")
        .eq("user_id", input.userId)
        .eq("role_key", "admin");
      const adminModules = (adminRows ?? []) as Array<{ module: string }>;
      if (adminModules.length <= 1) {
        return {
          error:
            "Can't remove the last administrator. Assign Admin to another user first.",
        };
      }
    }
  }

  // Through the RPCs — see applyModuleRole for why the direct write cannot
  // succeed. This site DID check its error, so the refusal was at least
  // reportable here; the dropdown path below was the silent one.
  const gridRpc = sb as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
  };
  const { error } =
    input.roleKey === null
      ? await gridRpc.rpc("app_remove_module_role", {
          p_user_id: input.userId,
          p_module: input.module,
        })
      : await gridRpc.rpc("app_set_module_role", {
          p_user_id: input.userId,
          p_module: input.module,
          p_role: input.roleKey,
        });
  if (error) return { error: error.message };

  // READ THE ROW BACK. `{ success: true }` was a claim that the RPC did not
  // return an error, and the UI spends it on a stronger claim than that: the
  // toast says "Role updated". The two are not the same statement. The RPCs are
  // SECURITY DEFINER and do their own authorisation inside the function body, so
  // a refusal there, or a write that lands somewhere other than intended, comes
  // back with no error at all.
  //
  // MEASURED, WHICH IS WHY THIS IS NOT THEORETICAL: this route returns HTTP 503
  // on every role write while the row commits anyway. Anything that depends on
  // the response's render leg — including revalidatePath below and the client's
  // router.refresh() — is unreliable here, so the returned value is the only
  // thing the screen can trust. Re-reading makes it a report instead of a hope.
  const { data: after } = await sb
    .from("app_user_roles")
    .select("role_key")
    .eq("user_id", input.userId)
    .eq("module", input.module)
    .maybeSingle();
  const persisted = (after as { role_key?: string } | null)?.role_key ?? null;
  if (persisted !== input.roleKey) {
    return {
      error:
        `The change did not stick — ${input.module} now reads ` +
        `"${persisted ?? "no access"}", not "${input.roleKey ?? "no access"}". ` +
        "Nothing reported a failure, so this is a silent refusal inside " +
        "app_set_module_role or a policy on app_user_roles. Do not retry until " +
        "that is explained.",
    };
  }

  revalidatePath("/settings/team");
  return { success: true, persisted };
}

/**
 * Remove a user entirely — deletes their role assignments + directory row.
 * Their Supabase Auth account is untouched. Blocks removing the last admin.
 */
export async function removeTeamMember(userId: string) {
  const ctx = await requireAdmin();
  if ("error" in ctx) return ctx;
  const sb = ctx.supabase as unknown as UntypedSb;

  // Last-admin guard.
  const { data: theirAdmin } = await sb
    .from("app_user_roles")
    .select("module")
    .eq("user_id", userId)
    .eq("role_key", "admin");
  if (((theirAdmin ?? []) as unknown[]).length > 0 && (await adminCount(sb)) <= 1) {
    return {
      error:
        "Can't remove the last administrator. Assign Admin to another user first.",
    };
  }

  // ALL MODULES IN ONE CALL, and this also retires the partial-delete hazard.
  // The direct `delete().eq("user_id", ...)` here was unchecked, so under any
  // per-module restriction it would half-complete and report success. Passing a
  // null module removes every role, and the function's own last-admin guard runs
  // as well — a second layer under the app-side check above.
  const rmRpc = sb as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
  };
  const { error: rolesErr } = await rmRpc.rpc("app_remove_module_role", {
    p_user_id: userId,
    p_module: null,
  });
  if (rolesErr) return { error: rolesErr.message };
  const { error } = await ctx.supabase
    .from("app_users")
    .delete()
    .eq("user_id", userId);
  if (error) return { error: error.message };

  revalidatePath("/settings/team");
  return { success: true };
}

/**
 * Grant or revoke a user's access to a single project (deal). Org-admin gated.
 * Visibility/edit reachability is enforced by the deal_access-aware RLS on
 * `deals` (migration 0097); the user's module role still governs what they can
 * actually do. Owners and org admins always have access implicitly and are not
 * stored here. The deal_access table is shared with devmgmt, so a grant made in
 * either app is the same grant.
 */
export async function setDealAccess(input: {
  dealId: string;
  userId: string;
  grant: boolean;
}) {
  const ctx = await requireAdmin();
  if ("error" in ctx) return ctx;
  const sb = ctx.supabase as unknown as UntypedSb;

  if (input.grant) {
    const { error } = await sb.from("deal_access").upsert(
      {
        deal_id: input.dealId,
        user_id: input.userId,
        granted_by: ctx.access.userId,
        granted_at: new Date().toISOString(),
      },
      { onConflict: "deal_id,user_id" }
    );
    if (error) {
      if (error.code === "42P01")
        return { error: "Run migration 0097_deal_access.sql first to enable Project Access." };
      return { error: error.message };
    }
  } else {
    const { error } = await sb
      .from("deal_access")
      .delete()
      .eq("deal_id", input.dealId)
      .eq("user_id", input.userId);
    if (error) return { error: error.message };
  }

  revalidatePath("/settings/team");
  return { success: true };
}

// ---- Invite by email (auto-links on first sign-in) -------------------------

async function applyModuleRole(
  sb: UntypedSb,
  userId: string,
  module: string,
  roleKey: string | null,
  grantedBy: string
) {
  // ROUTED THROUGH THE RPCs, AND THE ERROR IS CHECKED. Both changes matter.
  //
  // WHY THE DIRECT WRITE CANNOT WORK: 20260804_app_user_roles_privileges_reconcile
  // revoked INSERT/UPDATE/DELETE/TRUNCATE on app_user_roles from `authenticated`
  // — its own heading reads "authenticated reads only". So this upsert had been
  // refused at the PRIVILEGE layer for every module since that migration ran, and
  // the refusal was invisible because the result was never inspected. The role
  // dropdown appeared to work and changed nothing. Diligence had zero role rows
  // because no one could ever grant one.
  //
  // 20260807_restore_role_management provides the legal path: app_set_module_role
  // and app_remove_module_role, SECURITY DEFINER so they may write the table, with
  // the org-admin check INSIDE the body. They also validate the module against a
  // whitelist, validate the role against app_roles, require the user to exist in
  // auth.users, and stamp granted_by from auth.uid() rather than accepting it —
  // so attribution through this path cannot be forged.
  //
  // app_remove_module_role additionally refuses to remove the LAST admin, which a
  // policy cannot express and which is unrecoverable through the UI.
  //
  // RETURNING THE ERROR instead of swallowing it is the other half. A silent
  // refusal is what let this go unnoticed for three weeks; the caller now surfaces
  // it, and the last-admin guard's message is worth showing rather than dropping.
  const rpc = sb as unknown as {
    rpc: (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ error: { message: string } | null }>;
  };
  const { error } =
    roleKey === null
      ? await rpc.rpc("app_remove_module_role", { p_user_id: userId, p_module: module })
      : await rpc.rpc("app_set_module_role", {
          p_user_id: userId,
          p_module: module,
          p_role: roleKey,
        });
  // grantedBy is no longer passed: the function takes it from auth.uid(), which is
  // the point. Kept in the signature so callers do not all have to change, and
  // referenced here so it is not an unused parameter.
  void grantedBy;
  if (error) throw new Error(error.message);
}

/**
 * Invite a user by email + per-module roles. No auth UUID needed — the invite
 * is claimed automatically on their first sign-in (claim_pending_invite). If
 * the email is already in the directory, roles apply immediately.
 */
export async function inviteUser(input: {
  email: string;
  displayName: string;
  devmgmtRole: string | null;
  underwritingRole: string | null;
  diligenceRole: string | null;
}): Promise<{ success?: true; alreadyActive?: boolean; error?: string }> {
  const ctx = await requireAdmin();
  if ("error" in ctx) return ctx;

  const email = input.email.trim().toLowerCase();
  if (!email || !email.includes("@")) return { error: "A valid email is required." };
  if (input.devmgmtRole && !ROLES.has(input.devmgmtRole))
    return { error: "Unknown Development role." };
  if (input.underwritingRole && !ROLES.has(input.underwritingRole))
    return { error: "Unknown Underwriting role." };
  if (input.diligenceRole && !ROLES.has(input.diligenceRole))
    return { error: "Unknown Diligence role." };
  if (!input.devmgmtRole && !input.underwritingRole && !input.diligenceRole)
    return { error: "Pick a role in at least one module." };

  const sb = ctx.supabase as unknown as UntypedSb;

  // ---- INVITE-CHAIN STEP 2: mint through the gated function -----------------
  // See the identical block in devmgmt's copy for why. In short:
  // app_user_invites is policy-open and client-writable, and
  // claim_pending_invite writes its role columns straight into app_user_roles
  // while running as the table owner — so the one policy that would refuse the
  // write (app_user_roles_wr) is never evaluated. Any signed-in user could self-
  // mint an admin invite and claim it.
  //
  // THIS COPY IS THE THREE-MODULE ONE. diligence 0086 added diligence_role and
  // redefined claim_pending_invite to insert a third app_user_roles row, so the
  // escalation reaches THREE modules here, not two — and create_app_invite has to
  // carry the third role or minting would silently drop it.
  //
  // The 42883 fallback is deliberate: step 1's migration may not have run yet, and
  // a missing function must not take onboarding down. It degrades to exactly
  // today's behaviour and nothing worse. Every other error is surfaced.
  const { error: rpcErr } = await (sb as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: { code?: string; message: string } | null }>;
  }).rpc("create_app_invite", {
    p_email: email,
    p_display_name: input.displayName.trim() || null,
    p_devmgmt_role: input.devmgmtRole,
    p_underwriting_role: input.underwritingRole,
    p_diligence_role: input.diligenceRole,
  });
  if (rpcErr) {
    const missing = rpcErr.code === "42883" || /create_app_invite/i.test(rpcErr.message);
    if (!missing) return { error: rpcErr.message };
    console.warn(
      "[inviteUser] create_app_invite unavailable — falling back to the direct " +
        "insert. Run 20260821_invite_chain_step1_minting_function.sql to close " +
        "the self-invite escalation. Detail:",
      rpcErr.message,
    );
    const { error: invErr } = await sb.from("app_user_invites").upsert(
      {
        email,
        display_name: input.displayName.trim() || null,
        devmgmt_role: input.devmgmtRole,
        underwriting_role: input.underwritingRole,
        diligence_role: input.diligenceRole,
        invited_by: ctx.access.userId,
        claimed_at: null,
        claimed_user_id: null,
      },
      { onConflict: "email" }
    );
    if (invErr) return { error: invErr.message };
  }

  // Already in the directory? Apply roles now and mark the invite claimed.
  const { data: existing } = await sb
    .from("app_users")
    .select("user_id")
    .ilike("email", email)
    .maybeSingle();
  const existingId = (existing as { user_id?: string } | null)?.user_id;
  if (existingId) {
    await applyModuleRole(sb, existingId, "devmgmt", input.devmgmtRole, ctx.access.userId);
    await applyModuleRole(sb, existingId, "underwriting", input.underwritingRole, ctx.access.userId);
    await applyModuleRole(sb, existingId, "diligence", input.diligenceRole, ctx.access.userId);
    await sb
      .from("app_user_invites")
      .update({ claimed_at: new Date().toISOString(), claimed_user_id: existingId })
      .eq("email", email);
  }

  revalidatePath("/settings/team");
  return { success: true, alreadyActive: !!existingId };
}

export async function revokeInvite(email: string) {
  const ctx = await requireAdmin();
  if ("error" in ctx) return ctx;
  const sb = ctx.supabase as unknown as UntypedSb;
  const { error } = await sb
    .from("app_user_invites")
    .delete()
    .eq("email", email.trim().toLowerCase());
  if (error) return { error: error.message };
  revalidatePath("/settings/team");
  return { success: true };
}
