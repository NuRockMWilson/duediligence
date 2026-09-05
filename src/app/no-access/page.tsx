import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ShieldAlert } from "lucide-react";
import SignOutButton from "@/components/sign-out-button";

// ============================================================================
// /no-access — shown when an authenticated user has no role in this module.
// Lives OUTSIDE the (app) route group so the module gate can redirect here
// without re-triggering itself.
// ============================================================================

export default async function NoAccessPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F7F8FA] px-6">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 border border-amber-200">
          <ShieldAlert className="h-6 w-6 text-amber-600" />
        </div>
        {/* -------------------------------------------------------------
            TWO THINGS THIS PAGE USED TO GET WRONG, BOTH FOUND IN ROUND 63
            -------------------------------------------------------------
            1. It said "the Development module" in the DUE DILIGENCE app. The
               string was copied across from devmgmt and never localised, so a
               refused user was told the wrong product name.
            2. It told them to fix it "under Settings → Users & Access" — the
               page that had just refused them. Following the instruction
               returns here. Only an administrator can reach that page, so the
               instruction has to be addressed to a person, not to a route.

            The heading also over-claims: this page is reached both when a user
            has no role at ALL and when they lack access to one specific admin
            page, and "No access to this module" reads as the former in both
            cases. Softened to cover both without asserting the stronger one.
        ------------------------------------------------------------- */}
        <h1 className="font-display text-2xl text-nurock-black">
          You don&apos;t have access to this page
        </h1>
        <p className="mt-2 text-sm text-nurock-slate leading-relaxed">
          Your account{user?.email ? ` (${user.email})` : ""} doesn&apos;t have
          the permissions this page needs. Some pages are limited to
          administrators, and some need a Due Diligence role your account
          hasn&apos;t been granted yet.
        </p>
        <p className="mt-2 text-sm text-nurock-slate leading-relaxed">
          Ask a NuRock administrator to check your access — they can change it in
          Settings, which only they can open.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <Link
            href="/deals"
            className="inline-flex items-center rounded-md border border-nurock-border bg-white px-4 py-2 text-sm font-medium text-nurock-navy hover:bg-nurock-gray"
          >
            Retry
          </Link>
          <SignOutButton />
        </div>
      </div>
    </div>
  );
}
