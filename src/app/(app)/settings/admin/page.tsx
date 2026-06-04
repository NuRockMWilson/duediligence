import { getAdminSettings } from "@/lib/data/admin-settings";
import { AdminSettingsForm } from "./_components/admin-settings-form";

// ============================================================================
// /settings/admin — Org-wide admin settings
// ----------------------------------------------------------------------------
// Server component fetches current settings, hands them to a client form.
// Sibling to /settings/mappings (which holds the GL → Schedule line mappings).
// Shared nav lives in ../_components/settings-nav.tsx.
// ============================================================================

export default async function AdminSettingsPage() {
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
