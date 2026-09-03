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

  // -------------------------------------------------------------------------
  // BUILD MARKER — so a verification session can tell WHICH build it tested.
  // -------------------------------------------------------------------------
  // MEASURED PROBLEM, 2026-09-03: the live session found an entire new
  // "Investor & Lender Packets" section on the Westview deal page that had been
  // absent from its round-39 read of the same page. It could establish that the
  // app changed underneath it but not WHICH build it had measured, because this
  // app stamped nothing — [data-build] was null on every deal page and on
  // /settings/diligence-templates, with no meta fallback. That cost a real
  // attribution: a deploy landed mid-round and could not be tied to a commit.
  //
  // devmgmt has carried this marker since 2026-08-25 for the same reason. This
  // is the port, deliberately identical so one DOM query works in both apps:
  //     document.querySelector("[data-build]").dataset.build
  //
  // A DATA ATTRIBUTE, NOT VISIBLE CHROME. Nothing renders, nothing moves, no
  // design decision is implied.
  //
  // NO NEW ENVIRONMENT VARIABLE, deliberately — env changes are out of scope on
  // this project. VERCEL_GIT_COMMIT_SHA is already injected by the platform and
  // is read HERE, in a server component, so it never needs the NEXT_PUBLIC_
  // prefix that would make it a config change. Locally it is absent and the
  // marker reads "dev", which is itself the correct answer.
  // -------------------------------------------------------------------------
  const buildSha = (process.env.VERCEL_GIT_COMMIT_SHA ?? "dev").slice(0, 7);

  return <div data-build={buildSha}>{children}</div>;
}
