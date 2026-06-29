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

  if (input.roleKey === null) {
    const { error } = await sb
      .from("app_user_roles")
      .delete()
      .eq("user_id", input.userId)
      .eq("module", input.module);
    if (error) return { error: error.message };
  } else {
    const { error } = await sb.from("app_user_roles").upsert(
      {
        user_id: input.userId,
        module: input.module,
        role_key: input.roleKey,
        granted_by: ctx.access.userId,
        granted_at: new Date().toISOString(),
      },
      { onConflict: "user_id,module" }
    );
    if (error) return { error: error.message };
  }

  revalidatePath("/settings/team");
  return { success: true };
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

  await sb.from("app_user_roles").delete().eq("user_id", userId);
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
  if (roleKey === null) {
    await sb.from("app_user_roles").delete().eq("user_id", userId).eq("module", module);
  } else {
    await sb.from("app_user_roles").upsert(
      {
        user_id: userId,
        module,
        role_key: roleKey,
        granted_by: grantedBy,
        granted_at: new Date().toISOString(),
      },
      { onConflict: "user_id,module" }
    );
  }
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
