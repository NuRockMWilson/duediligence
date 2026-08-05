/**
 * PATH-AGNOSTIC URL CONSTRUCTION.
 *
 * WHY THIS EXISTS. The platform is consolidating from three separate origins onto
 * one — app.nurock.com — with each module mounted under a path segment:
 * /portfolio, /underwriting, /development, /duediligence. Under Next.js that means
 * each module sets `basePath`.
 *
 * `basePath` prefixes next/link, the router and next/image. IT DOES NOT /duediligence
 * fetch(). A bare fetch("/api/thing") resolves against the ORIGIN, so under a
 * basePath it requests app.nurock.com/api/thing — the SHELL's route namespace, not
 * this module's. It does not fail at build time or at import time; it 404s at
 * runtime.
 *
 * The underwriting module had sixteen such call sites, one of which sat inside a
 * FAIL-OPEN staleness probe — so a bare path there did not break loudly, it
 * silently switched off a write guard. That is why this is enforced by
 * scripts/no-bare-fetch-check.mjs in CI rather than left as a convention.
 *
 * The prefix comes from NEXT_PUBLIC_BASE_PATH, the SAME variable next.config.ts
 * feeds to basePath/assetPrefix, so the two cannot disagree. Unset — today, and in
 * local dev — every function here is the identity transform.
 */

/** The mount prefix, e.g. "" today or "/duediligence" after cutover. Next inlines
 *  NEXT_PUBLIC_ vars at build time, so this is a constant in the bundle. */
const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");

/** Already absolute (scheme-qualified or protocol-relative)? Leave it alone. */
function isAbsolute(path: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith("//");
}

/**
 * Prefix a root-relative path with the module's basePath.
 *
 * Idempotent and safe on every shape a caller can produce: absolute URLs pass
 * through, an already-prefixed path is not double-prefixed, a relative path passes
 * through since basePath applies only to root-relative URLs, and a same-prefix
 * sibling ("/duediligences-report") is still prefixed rather than mistaken for prefixed.
 */
export function withBasePath(path: string): string {
  if (!BASE_PATH) return path;
  if (isAbsolute(path)) return path;
  if (!path.startsWith("/")) return path;
  if (path === BASE_PATH || path.startsWith(`${BASE_PATH}/`)) return path;
  return `${BASE_PATH}${path}`;
}

/** A route-handler URL. Use for every fetch of this module's own /api/* routes. */
export function apiUrl(path: string): string {
  return withBasePath(path);
}

/** A public/ static asset URL. */
export function assetUrl(path: string): string {
  return withBasePath(path);
}

/** The configured prefix, for diagnostics and wiring assertions. */
export function basePath(): string {
  return BASE_PATH;
}
