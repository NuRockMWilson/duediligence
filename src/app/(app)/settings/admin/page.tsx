import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserAccess } from "@/lib/auth/access";
import { getAdminSettings } from "@/lib/data/admin-settings";
import { AdminSettingsForm } from "./_components/admin-settings-form";

// ============================================================================
// /settings/admin — Org-wide admin settings
// ----------------------------------------------------------------------------
// Server component fetches current settings, hands them to a client form.
// Sibling to /settings/mappings (which holds the GL → Schedule line mappings).
//
// THIS PAGE HAD NO GATE OF ANY KIND UNTIL ROUND 63.
//
// The settings-nav comment stated the contract — "the settings sidebar still
// lists them for everyone; the pages themselves enforce access" — and
// /settings/team holds up its half, redirecting non-admins. This page did not.
// The (app) layout admits anyone with a diligence role, a devmgmt role, or org
// admin, so a CONTRIBUTOR reached it, read the org-wide pro-rata diagnostic
// setting, and was shown live radio controls over how draw submission behaves
// across every NuRock deal.
//
// Same gate as /settings/team, including the legacy is_cfo fallback, so the two
// admin surfaces cannot disagree about who is an admin.
// ============================================================================

export default async function AdminSettingsPage() {
  const supabase = await createClient();
  const access = await getCurrentUserAccess();
  if (!access) redirect("/login");

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

  const settings = await getAdminSettings();

  return (
    <div className="min-h-full px-8 py-6">
      <div className="mb-4">
        <h1 className="font-display text-[28px] leading-tight text-nurock-black">
          Settings
        </h1>
        <p className="mt-1 text-[13px] text-[#667085]">
          Org-wide configuration shared across all NuRock deals and users.
        </p>
      </div>

      <div className="mt-6 max-w-3xl">
        <AdminSettingsForm initialSettings={settings} />
      </div>
    </div>
  );
}
