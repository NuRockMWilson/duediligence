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
        <h1 className="font-display text-2xl text-nurock-black">
          No access to this module
        </h1>
        <p className="mt-2 text-sm text-nurock-slate leading-relaxed">
          Your account{user?.email ? ` (${user.email})` : ""} isn&apos;t assigned
          a role in the Development module yet. Ask an administrator to grant you
          access under <span className="font-medium">Settings → Users &amp; Access</span>.
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
