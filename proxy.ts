import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Next 16 renamed `middleware` → `proxy`. Proxy runs on the Node.js runtime by
// default (Middleware defaulted to Edge), which is what we want: the Supabase
// SSR client + its deps aren't Edge-bundled, so the session-refresh helper runs
// in a full Node runtime. Same logic as before — just the new file convention.
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - image files (svg, png, jpg, jpeg, gif, webp)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
