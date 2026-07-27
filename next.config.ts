import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Pin Turbopack's project root to THIS app.
//
// Root is lockfile-detected (see node_modules/next/dist/docs/.../turbopack.md
// "Root directory"), and there is a package-lock.json in the user's HOME
// directory above this workspace. Next picked that one, resolved the root above
// "Underwriting Model", and then `next dev` died with
//   Error: Can't resolve 'tailwindcss' in '<workspace>'
// so the dev server could not serve a single page locally. Production builds on
// Vercel were unaffected (only this repo is checked out there, so detection
// finds this app's own lockfile) — which is exactly why it went unnoticed.
// Setting it explicitly is a no-op on Vercel and makes local dev work.
const appDir = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: {
    root: appDir,
  },
  // Ensure Vercel bundles the FHFC FCC template with the cost cert export
  // serverless function. Without this, the API route reads from
  // public/templates/fhfc-fcc-template.xlsx via fs.readFile, but the file
  // isn't included in the function's traced files and we get ENOENT at
  // runtime.
  outputFileTracingIncludes: {
    "/api/deals/[dealId]/cert-prep/export-fhfc": ["./public/templates/**"],
  },
  // Invoice PDFs / import workbooks are uploaded through Server Actions, whose
  // request body defaults to a 1 MB cap — multi-page scanned invoices are
  // commonly 2–15 MB. Raise the ceiling so they upload. (In this Next version
  // the option lives under `experimental`.)
  experimental: {
    serverActions: {
      bodySizeLimit: "25mb",
    },
  },
};

export default nextConfig;
