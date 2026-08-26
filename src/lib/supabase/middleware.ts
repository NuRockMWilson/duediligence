import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
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

const PUBLIC_PATHS = ["/login", "/auth"];

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: { domain: cookieDomain },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: avoid logic between createServerClient and getUser.
  // A simple mistake could cause hard-to-debug session refresh issues.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path.startsWith(p));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
