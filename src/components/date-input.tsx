"use client";

import * as React from "react";
import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";

export interface DateInputProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "value" | "onChange" | "type"
  > {
  /** Canonical value as YYYY-MM-DD (ISO) or empty string. */
  value: string;
  /** Called with the canonical YYYY-MM-DD value (or "" if cleared). */
  onChange: (value: string) => void;
}

function pad(n: number, w: number): string {
  return n.toString().padStart(w, "0");
}

function isoToUS(iso: string): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return `${m}/${d}/${y}`;
}

/**
 * Parse a flexible date string into ISO YYYY-MM-DD.
 * Accepts: 2/15/24, 02/15/2024, 2-15-2024, 2.15.2024, 2024-02-15, etc.
 * Returns null if not parseable or not a real date.
 */
function parseFlexibleDate(input: string): string | null {
  const s = input.trim();
  if (!s) return null;

  let year: number, month: number, day: number;

  // ISO format (YYYY-MM-DD)
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    year = parseInt(iso[1], 10);
    month = parseInt(iso[2], 10);
    day = parseInt(iso[3], 10);
  } else {
    // US format: M/D/Y or M-D-Y or M.D.Y, with 2 or 4 digit year
    const us = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})$/);
    if (!us) return null;
    month = parseInt(us[1], 10);
    day = parseInt(us[2], 10);
    year = parseInt(us[3], 10);
    // Two-digit year rule: <70 → 20YY, ≥70 → 19YY (matches Excel/Sage convention)
    if (year < 100) year += year < 70 ? 2000 : 1900;
  }

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  // Validate it's a real calendar date (rejects e.g. Feb 30)
  const d = new Date(year, month - 1, day);
  if (
    d.getFullYear() !== year ||
    d.getMonth() !== month - 1 ||
    d.getDate() !== day
  ) {
    return null;
  }

  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

export default function DateInput({
  value,
  onChange,
  placeholder = "M/D/YYYY",
  ...rest
}: DateInputProps) {
  const [display, setDisplay] = useState(isoToUS(value));

  // Keep display synced with the canonical value when it changes externally
  useEffect(() => {
    setDisplay(isoToUS(value));
  }, [value]);

  function handleBlur() {
    const trimmed = display.trim();
    if (!trimmed) {
      onChange("");
      setDisplay("");
      return;
    }
    const iso = parseFlexibleDate(trimmed);
    if (iso) {
      onChange(iso);
      setDisplay(isoToUS(iso));
    } else {
      // Invalid input — revert to the last canonical value
      setDisplay(isoToUS(value));
    }
  }

  return (
    <Input
      type="text"
      inputMode="numeric"
      placeholder={placeholder}
      value={display}
      onChange={(e) => setDisplay(e.target.value)}
      onBlur={handleBlur}
      {...rest}
    />
  );
}
