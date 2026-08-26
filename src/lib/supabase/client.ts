import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";

// Shared cookie domain for cross-subdomain SSO. Unset -> host-only cookie
// (current per-origin behaviour, so nothing changes today). Set to ".nurock.com"
// at domain cutover so the session is shared with the underwriting and development
// apps and one sign-in covers all three.
//
// THIS APP WAS THE ONE STILL MISSING IT — underwriting and devmgmt were already
// wired. Without it, cutover would have shared a session between those two and
// left diligence out: two sign-ins instead of three, which looks fixed and is not.
//
// A shared cookie CANNOT work on the current *.vercel.app hostnames: vercel.app is
// on the Public Suffix List, so no cookie may be scoped to a parent domain across
// them. Hence an env var waiting on DNS rather than code waiting to be written.
const cookieDomain = process.env.NEXT_PUBLIC_AUTH_COOKIE_DOMAIN || undefined;

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookieOptions: { domain: cookieDomain } }
  );
}
