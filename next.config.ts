import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
