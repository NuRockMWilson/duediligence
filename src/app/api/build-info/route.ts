import { NextResponse } from "next/server";
import { connection } from "next/server";

/**
 * GET /api/build-info — which commit is this deployment serving?
 *
 * PORTED 2026-08-21, third of three. The browser session confirmed underwriting
 * and devmgmt from this route and reported diligence as a 404 — so the ONLY app
 * whose deployed commit could not be verified was the one that had just received
 * a security migration. Verifying two of three apps is the shape of a check that
 * looks complete and is not.
 *
 * *** UNAUTHENTICATED. KEEP THE PAYLOAD MINIMAL. ***
 * SHA and environment only. The underwriting original shipped with commit
 * message, branch and region and removed them the same day: commit messages in
 * these repositories describe internal findings, specific dollar exposures and
 * which controls are unapplied, and this endpoint answers to anyone. A SHA is a
 * public fact about a deployment of a private repository — it identifies a build
 * without describing it. Do not add fields without asking what an
 * unauthenticated caller learns from them.
 *
 * NEXT 16: `await connection()` rather than `export const dynamic =
 * "force-dynamic"`. Per node_modules/next/dist/docs, connection() replaces
 * unstable_noStore, and its documented case is exactly this — a handler that
 * reads no request-time API but calls new Date() and must not be prerendered. A
 * prerendered answer would report the SHA of whichever build prerendered it,
 * which is the one failure this route exists to prevent.
 */
export async function GET() {
  await connection();
  const sha = process.env.VERCEL_GIT_COMMIT_SHA ?? null;
  return NextResponse.json({
    commit: sha,
    commitShort: sha ? sha.slice(0, 7) : null,
    environment: process.env.VERCEL_ENV ?? "local",
    servedAt: new Date().toISOString(),
  });
}
