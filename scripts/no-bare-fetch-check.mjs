/**
 * no-bare-fetch-check — fail the build on a bare absolute fetch().
 *
 * Next's basePath prefixes next/link, the router and next/image. IT DOES NOT PREFIX
 * fetch(). Under path-based mounting (app.nurock.com/duediligence) a bare
 * fetch("/api/thing") resolves against the ORIGIN and hits the SHELL app's route
 * namespace instead of this module's.
 *
 * Why this is a build gate and not a convention: in the underwriting module one of
 * the sixteen offending call sites sat inside a FAIL-OPEN staleness probe, so a bare
 * path there produced no error, no banner and no failing test — it silently switched
 * off a write guard. A grep that fails the build is the only reliable stop.
 *
 * Use apiUrl() / assetUrl() from src/lib/url.ts.
 *
 *   node scripts/no-bare-fetch-check.mjs
 *
 * Comments are stripped before matching, which is load-bearing: src/lib/url.ts's own
 * documentation quotes fetch("/api/thing") as the counter-example, and a naive
 * matcher flags the file that exists to fix the problem. Strings are NOT stripped —
 * the string is the thing being checked.
 *
 * SCOPE: fetch() only. Absolute asset paths have the same problem and the same fix,
 * but they fail visibly (a missing image), so they are not worth the false-positive
 * rate of a string-literal-wide pattern.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const SCAN = ["src"];
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "__testutils__"]);

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const PATTERN = /fetch\(\s*(?:"\/|`\/|'\/)/;

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\./.test(name)) out.push(p);
  }
}

const files = [];
for (const d of SCAN) {
  try { walk(join(ROOT, d), files); } catch { /* absent — fine */ }
}

const offenders = [];
for (const f of files) {
  stripComments(readFileSync(f, "utf8")).split("\n").forEach((line, i) => {
    if (PATTERN.test(line)) {
      offenders.push({ file: relative(ROOT, f).split(sep).join("/"), line: i + 1, text: line.trim().slice(0, 100) });
    }
  });
}

console.log(`no-bare-fetch-check — scanned ${files.length} source files under ${SCAN.join(", ")}`);

if (offenders.length === 0) {
  console.log("PASS — every absolute fetch() goes through apiUrl()/assetUrl().");
  process.exit(0);
}

console.error(`\nFAIL — ${offenders.length} bare absolute fetch(${offenders.length === 1 ? "" : "es"}):\n`);
for (const o of offenders) console.error(`  ${o.file}:${o.line}\n    ${o.text}`);
console.error(
  `\nWrap the path: fetch(apiUrl("/api/thing")) for route handlers, ` +
  `fetch(assetUrl("/thing.png")) for public/ assets. See src/lib/url.ts.\n` +
  `basePath does not prefix fetch(), so a bare path resolves against the origin — ` +
  `which under path-based mounting is the shell app, not this one.`,
);
process.exit(1);
