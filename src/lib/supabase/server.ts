import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/database.types";

// Shared cookie domain for cross-subdomain SSO. Unset -> host-only cookie
// (current per-origin behaviour, so nothing changes today). Set to ".nurock.com"
// at domain cutover so the session cookie is shared with the underwriting and
// development apps and one sign-in covers all three.
//
// THIS APP WAS THE ONE STILL MISSING IT. underwriting and devmgmt were wired for
// this already; diligence handled cookies but never set a domain — so at cutover
// the other two would have shared a session and this one would not. Two sign-ins
// instead of three: the kind of partial state that looks fixed and is not.
//
// A shared cookie CANNOT work on the current *.vercel.app hostnames — vercel.app
// is on the Public Suffix List, so no cookie may be scoped to a parent domain
// across them. That is why this is an env var waiting on DNS rather than code
// waiting to be written.
const cookieDomain = process.env.NEXT_PUBLIC_AUTH_COOKIE_DOMAIN || undefined;

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: { domain: cookieDomain },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if middleware refreshes user sessions.
          }
        },
      },
    }
  );
}
