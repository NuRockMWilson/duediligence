"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Upload, FileCheck2, X } from "lucide-react";
import { toast } from "sonner";

interface FileDropZoneProps {
  file: File | null;
  onFileChange: (file: File | null) => void;
  accept?: string; // mime type or comma-separated list, e.g. "application/pdf"
  maxBytes?: number;
  acceptLabel?: string; // e.g. "PDF only"
}

export default function FileDropZone({
  file,
  onFileChange,
  accept = "application/pdf",
  maxBytes = 25 * 1024 * 1024,
  acceptLabel = "PDF only",
}: FileDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function validateAndSet(f: File | null) {
    if (!f) return;

    // Mime type or extension check
    const accepted = accept.split(",").map((s) => s.trim());
    const okMime = accepted.some((a) => f.type === a || f.type.startsWith(a));
    const okExt = accepted.some((a) =>
      a.startsWith(".")
        ? f.name.toLowerCase().endsWith(a.toLowerCase())
        : false
    );
    if (!okMime && !okExt) {
      toast.error(`File must be ${acceptLabel}`);
      return;
    }

    if (f.size > maxBytes) {
      toast.error(
        `File is ${(f.size / 1024 / 1024).toFixed(1)} MB — must be under ${(
          maxBytes /
          1024 /
          1024
        ).toFixed(0)} MB`
      );
      return;
    }

    onFileChange(f);
  }

  function clear() {
    onFileChange(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  if (file) {
    return (
      <div className="flex items-center gap-3 p-4 rounded-lg border border-emerald-200 bg-emerald-50">
        <FileCheck2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-emerald-900 truncate">
            {file.name}
          </div>
          <div className="text-xs text-emerald-700">
            {(file.size / 1024).toFixed(0)} KB
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={clear}
          className="h-8 w-8 p-0 text-emerald-700 hover:bg-emerald-100"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>
    );
  }

  return (
    <div
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
        const f = e.dataTransfer.files?.[0] ?? null;
        validateAndSet(f);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!isDragging) setIsDragging(true);
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        e.stopPropagation();
        // Only clear when leaving the actual zone — relatedTarget can fire
        // on inner elements
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setIsDragging(false);
      }}
      onClick={() => inputRef.current?.click()}
      className={`flex items-center justify-center gap-3 w-full p-6 rounded-lg border-2 border-dashed transition cursor-pointer ${
        isDragging
          ? "border-nurock-navy bg-nurock-navy/5"
          : "border-nurock-border hover:border-nurock-navy/40 hover:bg-nurock-gray/30"
      }`}
    >
      <Upload
        className={`w-5 h-5 ${
          isDragging ? "text-nurock-navy" : "text-nurock-slate-light"
        }`}
      />
      <div className="text-sm">
        <span className="font-medium text-nurock-navy">Click to upload</span>
        <span className="text-nurock-slate-light"> or drag a file here</span>
      </div>
      <span className="text-xs text-nurock-slate-light">
        {acceptLabel} · {(maxBytes / 1024 / 1024).toFixed(0)} MB max
      </span>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={(e) => validateAndSet(e.target.files?.[0] ?? null)}
        className="sr-only"
      />
    </div>
  );
}
