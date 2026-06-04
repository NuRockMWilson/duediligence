// =============================================================================
// CSV builder (Phase 7) — server-side
// =============================================================================
// Minimal, dependency-free CSV generation. RFC-4180 quoting: fields are
// wrapped in double-quotes when they contain a comma, quote, or newline, and
// embedded quotes are doubled. Values are stringified; null/undefined → "".
//
// Returns a base64 string (with a leading UTF-8 BOM so Excel opens UTF-8
// correctly) for the standard { base64, filename, mime } export envelope.
// =============================================================================

export type CsvCell = string | number | boolean | null | undefined;

function escapeCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Build a CSV from a header row + data rows. Returns base64-encoded UTF-8
 * (BOM-prefixed) so the standard export download path can stream it.
 */
export function buildCsvBase64(headers: string[], rows: CsvCell[][]): string {
  const lines: string[] = [];
  lines.push(headers.map(escapeCell).join(","));
  for (const row of rows) {
    lines.push(row.map(escapeCell).join(","));
  }
  // \r\n line endings + UTF-8 BOM for maximum Excel compatibility.
  const csv = "﻿" + lines.join("\r\n");
  return Buffer.from(csv, "utf-8").toString("base64");
}
