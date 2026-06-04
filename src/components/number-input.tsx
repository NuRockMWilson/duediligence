"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";

/**
 * NumberInput — a controlled input that displays its value with thousands
 * separators (e.g. "1,234,567.89") while storing a clean numeric string
 * (e.g. "1234567.89") in state.
 *
 * Usage:
 *   const [v, setV] = useState("");
 *   <NumberInput value={v} onChange={setV} placeholder="0.00" />
 *
 * The raw value is what you submit to the server. Convert with
 * parseFloat(v) when ready.
 */
export interface NumberInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> {
  value: string;
  onChange: (value: string) => void;
  decimals?: number; // max digits after the decimal point (default 2)
  allowNegative?: boolean;
}

function formatWithCommas(raw: string): string {
  if (!raw) return "";
  const negative = raw.startsWith("-");
  const body = negative ? raw.slice(1) : raw;
  const parts = body.split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (negative ? "-" : "") + parts.join(".");
}

const NumberInput = React.forwardRef<HTMLInputElement, NumberInputProps>(
  function NumberInput(
    { value, onChange, decimals = 2, allowNegative = false, ...rest },
    ref
  ) {
    function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
      let s = e.target.value;

      // Strip everything except digits, decimal, and (optionally) leading minus
      s = s.replace(allowNegative ? /[^-\d.]/g : /[^\d.]/g, "");

      // Only one leading minus
      if (allowNegative) {
        const negative = s.startsWith("-");
        s = (negative ? "-" : "") + s.replace(/-/g, "");
      } else {
        s = s.replace(/-/g, "");
      }

      // Only one decimal point — keep first
      const firstDot = s.indexOf(".");
      if (firstDot !== -1) {
        s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, "");
      }

      // Limit decimal places
      const parts = s.split(".");
      if (parts[1] && parts[1].length > decimals) {
        parts[1] = parts[1].slice(0, decimals);
        s = parts.join(".");
      }

      // Strip leading zeros except for "0." or "0"
      const sign = s.startsWith("-") ? "-" : "";
      let body = sign ? s.slice(1) : s;
      if (body.length > 1 && body.startsWith("0") && !body.startsWith("0.")) {
        body = body.replace(/^0+/, "") || "0";
      }
      s = sign + body;

      onChange(s);
    }

    return (
      <Input
        ref={ref}
        type="text"
        inputMode="decimal"
        value={formatWithCommas(value)}
        onChange={handleChange}
        {...rest}
      />
    );
  }
);

export default NumberInput;
