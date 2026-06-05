import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  getCurrentUserAccess,
  canAccessModule,
  isRbacInitialized,
  claimPendingInvite,
} from "@/lib/auth/access";

// NotificationsBell is no longer mounted here as a floating overlay. It now
// lives inside each page's navy-bar right cluster (deal-shell header,
// deals/page.tsx, etc.) so the bar's right edge stays aligned across modules.
// See docs/shell.md §5.

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Module gate — a user needs a Diligence role (the finance-team role) OR a
  // Development role (existing staff) OR org admin to enter. Accepting either
  // means existing dev-mgmt users keep access while finance-only users can be
  // granted a diligence-only role (no dev-mgmt permissions). BOOTSTRAP-SAFE: if
  // no role assignments exist yet, enforcement stays off.
  const canEnter = (a: typeof access) =>
    canAccessModule(a, "diligence") ||
    canAccessModule(a, "devmgmt") ||
    !!a?.isOrgAdmin;

  let access = await getCurrentUserAccess();
  let denied = !canEnter(access);
  // If denied, the user may have a pending email invite — claim it and re-check
  // before turning them away (r5 auto-link on first sign-in).
  if (denied) {
    const claimed = await claimPendingInvite();
    if (claimed) {
      access = await getCurrentUserAccess();
      denied = !canEnter(access);
    }
  }
  if (denied && (await isRbacInitialized())) {
    redirect("/no-access");
  }

  return <>{children}</>;
}
