import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

// =============================================================================
// Test runner — added 2026-09-03
// =============================================================================
// WHY IT LANDED NOW. Two branches shipped in 9005859 cannot be reached from the
// running app, and the live measurement session said so explicitly rather than
// claiming to have covered them:
//
//   1. computeDiligenceRollup's `applicable === 0` branch needs EVERY item on a
//      deal waived or N/A. Westview has 1 waived of 59; the other eleven deals
//      have none. Manufacturing an all-waived deal in production to exercise a
//      display branch is state pollution, not a test.
//   2. isRbacInitialized()'s DENY fallback needs a caller with NO role in any
//      module. No such account exists — the only test account holds Contributor
//      in two modules — and creating accounts or stripping production roles is
//      forbidden by the standing rules of this program.
//
// Both are deliberately unreachable from a browser, so the browser correctly
// refused to call them verified. That is what a unit test is for.
//
// It also gives src/lib/eligibility/eligibility.test.ts somewhere to run. That
// file has carried a @ts-nocheck and the note "vitest isn't installed in this
// project yet" since 2026-05-28 — a spec that has never once executed, which is
// the same "a check that cannot fail is not coverage" shape in a different
// costume.
//
// The version is pinned to ^4.1.9 to match nurock-underwriting, so the two
// repos' runners cannot drift.
// =============================================================================

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  resolve: {
    // Mirrors tsconfig's "@/*" -> "./src/*". Without this, importing a module
    // under test pulls its "@/lib/..." imports and fails to resolve.
    alias: { "@": path.resolve(root, "src") },
  },
});
