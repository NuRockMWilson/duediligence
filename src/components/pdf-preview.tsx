"use client";

import { useEffect, useState } from "react";

/**
 * Renders a live preview of a PDF File using the browser's built-in PDF
 * viewer. Works in Chrome, Edge, Firefox, Safari without any external libs.
 */
export default function PdfPreview({
  file,
  height = 600,
}: {
  file: File | null;
  height?: number;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    // Revoke when the file changes or the component unmounts
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  if (!url) return null;

  return (
    <div className="mt-3 border border-nurock-border rounded-lg overflow-hidden bg-nurock-gray/20">
      <div className="px-3 py-1.5 bg-nurock-gray/40 border-b border-nurock-border text-[10px] uppercase tracking-wider font-display text-nurock-slate flex items-center justify-between">
        <span>Preview</span>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-nurock-navy hover:underline normal-case tracking-normal text-xs"
        >
          Open in new tab ↗
        </a>
      </div>
      <iframe
        src={url}
        className="w-full bg-white"
        style={{ height: `${height}px` }}
        title="Invoice PDF preview"
      />
    </div>
  );
}
