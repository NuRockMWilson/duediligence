// ============================================================================
// EVERY "use server" EXPORT IS A PUBLIC POST ENDPOINT — INVENTORY IT
// ============================================================================
// Run: node scripts/server-action-guard-check.mjs   (part of `npm run check`)
// Regenerate the baseline: node scripts/server-action-guard-check.mjs --write-baseline
//
// WHY THIS GATE EXISTS. Next's docs are explicit: "even if a Server Action or
// utility function is not imported elsewhere in your code, it can still be
// called externally", and "a page-level authentication check does not extend to
// the Server Actions defined within it. Always re-verify inside the action."
// There is no service-role client in this repo — every call uses the anon key
// plus the user's cookie session — so RLS governs everything and an unguarded
// export is directly invokable by any authenticated user regardless of what the
// UI renders.
//
// PORTED TO THIS REPO 2026-09-01, and the reason is specific. Every unguarded
// devmgmt write the 2026-08-31 audit found was already on devmgmt's baseline —
// that gate works. The gap was that it covered ONE repo. nudgeDiligenceAssignee
// lived here, unguarded, taking a caller-supplied recipient id, and survived a
// 25-action guarding sweep purely because nothing in this repo was looking.
//
// The comment that made it possible is in this repo's own diligence/actions.ts:
// "access is gated at the module route + the UI hides write controls for
// non-editors". Both halves are false. A server action is a POST endpoint that
// does not pass through the (app) route gate, and hiding a control gates
// nothing — Next's docs say so directly: "even if a Server Action is not
// imported elsewhere in your code, it can still be called externally", and "a
// page-level authentication check does not extend to the Server Actions defined
// within it."
//
// FALSE NEGATIVES ARE THE KNOWN LIMIT, stated rather than hidden. This matches
// guard CALLS textually. An action that calls a guard on an unreachable branch,
// or guards the wrong thing, counts as guarded here. It cannot tell you a guard
// is CORRECT — only that one is absent, which is the failure mode that produced
// all 25.
// ============================================================================

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");
const WRITE_BASELINE = process.argv.includes("--write-baseline");

// A call to any of these counts as an authorization check.
//
// ⚠️ assertDevmgmtCan IS DELIBERATELY ABSENT FROM THIS LIST IN THIS REPO.
//
// It exists here (lib/auth/access.ts, ported verbatim from devmgmt) and it tests
// the `devmgmt` role, failing OPEN when the caller holds none. On a DILIGENCE
// surface that enforces nothing for precisely the people who use it: this app's
// route gate admits `diligence OR devmgmt OR org admin`, so a diligence-only
// user has no devmgmt role, hits the fail-open, and passes. Counting it as a
// guard would let an inert check register as protection — the worst outcome for
// a gate whose entire job is to distinguish those two states.
//
// Use assertDiligenceCan() instead. It accepts either module's role, mirroring
// both the route gate and the shape of the RLS policies applied 2026-08-31, so
// the app and the database agree.
//
// If a diligence file legitimately guards a devmgmt-only operation with
// assertDevmgmtCan, add it here WITH A COMMENT saying which action and why —
// don't re-add it wholesale.
const GUARD_CALLS = [
  "assertDiligenceCan(",
  "requireOrgAdmin(",
  "requirePermission(",
];

// …as does an explicit role-flag test, which is how the draw ladder gates: the
// app_users.is_pm / is_cfo booleans, which are the SAME two columns the
// dm_draws approval trigger reads. Deliberately not RBAC — see the message at
// the bottom of this file for why the two must not diverge.
const ROLE_FLAG_TESTS = [
  "ctx.isCfo",
  "ctx.isPm",
  "appUser?.is_cfo",
  "appUser?.is_pm",
  "access.isOrgAdmin",
];

// ----------------------------------------------------------------------------
// THE BASELINE — the unguarded set as of 2026-08-31.
// ----------------------------------------------------------------------------
// WHY A BASELINE RATHER THAN 84 MORE GUARDS. Brief 07 covered the 25 actions the
// database now polices. Running this gate for the first time showed the whole
// population: 158 exported actions, 74 guarded, 84 not. Guarding the rest is not
// a mechanical edit — each is a decision about who may do that thing, several
// would change what people can do today, and a guard added on a guess is worse
// than a tracked gap because it looks settled. Those are the CFO's calls.
//
// So the number is written down instead of being rediscovered in six months. The
// gate fails on anything NEW, and every entry removed from the JSON is a real
// reduction visible in a diff. An audit whose result nothing preserves decays
// back to where it started; that is the whole point of this file.
const BASELINE_PATH = join(ROOT, "scripts", "server-action-guard-baseline.json");

let BASELINE = new Set();
if (!WRITE_BASELINE) {
  try {
    BASELINE = new Set(JSON.parse(readFileSync(BASELINE_PATH, "utf8")).unguarded);
  } catch (e) {
    // Hard failure, not a skip. A missing baseline would make this gate pass
    // vacuously, which is worse than having no gate at all.
    console.error(
      `server-action-guard-check — cannot read ${BASELINE_PATH} (${e.message}).\n` +
        `  The baseline is REQUIRED: without it this gate would pass vacuously.`
    );
    process.exit(1);
  }
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      walk(p, out);
    } else if (/\.tsx?$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

/**
 * Body of an exported function: from its signature to the next top-level
 * `export ` or EOF. Deliberately coarse — a guard anywhere in the function
 * counts, and over-reading into the NEXT function can only ever produce a false
 * "guarded", which the header already owns as the accepted risk.
 */
function bodyOf(lines, startIdx) {
  const out = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (lines[i].startsWith("export ")) break;
    out.push(lines[i]);
  }
  return out.join("\n");
}

const guarded = [];
const newlyUnguarded = [];
const baselined = [];
const fixedButListed = [];
let serverFiles = 0;

for (const abs of walk(SRC)) {
  const text = readFileSync(abs, "utf8");
  // Only "use server" FILES. A module without the directive exports plain
  // functions that are not themselves POST endpoints (src/lib/data/
  // reset-deal-to-uw.ts is one), so its exposure is different in kind.
  if (!/^\s*["']use server["'];/m.test(text)) continue;
  serverFiles++;

  const rel = relative(ROOT, abs).split(sep).join("/");
  const lines = text.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const m = /^export async function ([A-Za-z0-9_]+)\s*\(/.exec(lines[i]);
    if (!m) continue;
    const key = `${rel}::${m[1]}`;
    const body = bodyOf(lines, i);
    const hasGuard =
      GUARD_CALLS.some((g) => body.includes(g)) ||
      ROLE_FLAG_TESTS.some((g) => body.includes(g));

    if (hasGuard) {
      guarded.push(key);
      // Guarded but still listed → the baseline can shrink. Reported, never
      // failed: nagging about progress is how a gate gets switched off.
      if (BASELINE.has(key)) fixedButListed.push(key);
    } else if (BASELINE.has(key)) {
      baselined.push(key);
    } else {
      newlyUnguarded.push(key);
    }
  }
}

if (WRITE_BASELINE) {
  const all = [...newlyUnguarded, ...baselined].sort();
  writeFileSync(
    BASELINE_PATH,
    JSON.stringify(
      {
        _comment:
          "Unguarded server actions as of 2026-08-31 (brief 07). Each is a POST " +
          "endpoint any authenticated user can call — the route gate does NOT " +
          "cover a server action. This is a SHRINKING list, not an opt-out: " +
          "removing an entry without adding a guard fails the gate. See " +
          "scripts/server-action-guard-check.mjs.",
        capturedAt: "2026-08-31",
        unguarded: all,
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
  console.log(`wrote ${BASELINE_PATH} with ${all.length} entries`);
  process.exit(0);
}

const total = guarded.length + newlyUnguarded.length + baselined.length;
console.log(
  `server-action-guard-check — ${serverFiles} "use server" file(s), ` +
    `${total} exported action(s): ${guarded.length} guarded, ` +
    `${baselined.length} baselined-unguarded, ${newlyUnguarded.length} new`
);
console.log(
  `  The ${baselined.length} baselined entries are POST endpoints any ` +
    `authenticated user can call.\n  Shrinking that list is open work tracked in ` +
    `scripts/server-action-guard-baseline.json —\n  it is a recorded gap, not a ` +
    `clean bill of health.`
);

if (fixedButListed.length > 0) {
  console.log(
    `\n  NOW GUARDED — remove these ${fixedButListed.length} from the baseline:`
  );
  for (const f of fixedButListed) console.log(`    ${f}`);
}

if (newlyUnguarded.length > 0) {
  console.log(
    `\n  NEW UNGUARDED ACTION(S) — not in the baseline. Each is a POST endpoint\n` +
      `  any authenticated user can call, and the (app) route gate does NOT\n` +
      `  cover it:`
  );
  for (const u of newlyUnguarded) console.log(`    ${u}`);
  console.log(
    `\n  Add an authorization check. Do NOT add it to the baseline — that file\n` +
      `  records what already existed on 2026-08-31; it is not an opt-out.\n` +
      `  Guards available:\n` +
      `    assertDiligenceCan("edit") USE THIS ONE. Accepts a diligence OR a\n` +
      `                               devmgmt role, mirroring this app's route\n` +
      `                               gate and the RLS policies. Bootstrap-safe:\n` +
      `                               fails OPEN for a caller holding neither\n` +
      `                               role, so it introduces no lockout.\n` +
      `    requireOrgAdmin()          org-wide configuration only\n` +
      `\n` +
      `  Do NOT use assertDevmgmtCan() on a diligence surface. It tests the\n` +
      `  devmgmt role and fails open without one, so for a diligence-only user —\n` +
      `  who this app admits by design — it enforces nothing. This gate does not\n` +
      `  count it as a guard for that reason.`
  );
  process.exit(1);
}

console.log(`\nPASS — no NEW unguarded server action.`);
