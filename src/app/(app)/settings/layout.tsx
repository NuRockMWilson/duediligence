import { getCurrentUserAccess } from "@/lib/auth/access";
import { visibleSettingsNav } from "@/lib/settings-nav";
import { SettingsSidebar } from "./_components/settings-sidebar";

// ============================================================================
// Settings shell — resolves WHO IS LOOKING, once
// ============================================================================
// This was a client component reading SETTINGS_NAV directly, which meant it had
// no way to know whether the viewer is an org admin and therefore rendered
// every section to everyone. The account-menu dropdown filtered `adminOnly`;
// this did not. Live round 63 measured the split: a contributor saw all nine
// sections in the sidebar and seven in the dropdown, with live links to
// /settings/team and /settings/admin.
//
// Now the server resolves visibility and the client sidebar just draws what it
// is given. HIDING IS CONVENIENCE, NOT SECURITY — every admin page enforces its
// own access, which is the control. Removing the link only stops inviting a
// click that ends at /no-access.
// ============================================================================

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const access = await getCurrentUserAccess();
  const nav = visibleSettingsNav(access?.isOrgAdmin ?? false);

  return <SettingsSidebar nav={nav}>{children}</SettingsSidebar>;
}
