#!/usr/bin/env node
// =============================================================================
// check-shared-ui — verify this repo's generated shared-UI copies in isolation
// -----------------------------------------------------------------------------
// Self-contained on purpose: it hashes the local copy and compares against the
// .sha256 sidecar that was committed alongside it, so it needs NO sibling
// checkout and therefore runs inside an isolated Vercel build (unlike the
// canonical repo's sync script, which can only compare when all repos are
// present locally).
//
// Fails the build when someone hand-edits a generated file without going
// through the canonical source + sync.
//
//   node scripts/check-shared-ui.mjs
// =============================================================================

import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Generated files in THIS repo, each paired with a committed .sha256 sidecar. */
const GENERATED = [
  "src/components/shared-ui/sidebar-nav-logic.ts",
  "src/components/shared-ui/SidebarNav.tsx",
];

let failed = 0;
for (const rel of GENERATED) {
  const filePath = join(repoRoot, rel);
  const hashPath = `${filePath}.sha256`;

  if (!existsSync(filePath)) {
    console.error(`✗ missing generated file: ${rel}`);
    failed++;
    continue;
  }
  if (!existsSync(hashPath)) {
    console.error(
      `✗ missing hash sidecar: ${rel}.sha256 — re-run the canonical sync ` +
        `(shared-ui repo: node scripts/sync-shared-ui.mjs)`
    );
    failed++;
    continue;
  }

  // LF-normalized before hashing: git stores LF and checks out CRLF on
  // Windows, so hashing raw bytes makes this gate platform-dependent and fails
  // a Linux (Vercel) build on a file that is byte-identical after normalizing.
  const actual = createHash("sha256")
    .update(readFileSync(filePath, "utf8").split("\r\n").join("\n"), "utf8")
    .digest("hex");
  const expected = readFileSync(hashPath, "utf8").trim();

  if (actual !== expected) {
    console.error(
      `✗ DRIFT: ${rel} does not match its committed hash.\n` +
        `    expected ${expected}\n` +
        `    actual   ${actual}\n` +
        `  This file is AUTO-GENERATED. Edit the canonical source instead:\n` +
        `    nurock-devmgmt/src/src/components/shared-ui/SidebarNav.tsx\n` +
        `  then run (from nurock-devmgmt): npm run sync:shared-ui`
    );
    failed++;
    continue;
  }
  console.log(`= ${rel} matches committed hash`);
}

if (failed > 0) {
  console.error(`\n${failed} shared-UI check(s) failed.`);
  process.exit(1);
}
console.log("\n✓ shared UI verified against committed hashes");
