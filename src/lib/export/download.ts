// =============================================================================
// Client-side download helper (Phase 7)
// =============================================================================
// Server actions return { base64, filename, mime } (base64 keeps the action
// transport JSON-safe). This decodes + triggers a browser download. Mirrors
// the inline triggerDownload in payables-report.tsx, lifted to a shared util
// so every export surface (invoices, schedule, reports) uses one path.
// =============================================================================

export const MIME = {
  csv: "text/csv;charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
} as const;

export interface ExportPayload {
  base64: string;
  filename: string;
  mime: string;
}

/** Decode a base64 server-action result and trigger a browser download. */
export function triggerDownload(payload: ExportPayload): void {
  const bytes = atob(payload.base64);
  const buf = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
  const blob = new Blob([buf], { type: payload.mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = payload.filename;
  a.click();
  URL.revokeObjectURL(url);
}

type CsvCell = string | number | boolean | null | undefined;

function escapeCsvCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Build a CSV from in-memory rows and download it directly — no server
 * round-trip. Use when the data is already on the client (e.g. a rollup
 * passed as a prop). BOM-prefixed UTF-8 + CRLF for Excel compatibility.
 */
export function downloadCsv(
  headers: string[],
  rows: CsvCell[][],
  filename: string
): void {
  const lines = [
    headers.map(escapeCsvCell).join(","),
    ...rows.map((r) => r.map(escapeCsvCell).join(",")),
  ];
  const csv = "﻿" + lines.join("\r\n");
  const blob = new Blob([csv], { type: MIME.csv });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
