"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Check, ChevronsUpDown, Plus } from "lucide-react";

export interface VendorOption {
  id: string;
  name: string;
  dba_name: string | null;
  payment_terms_days: number;
  status: string;
}

interface VendorComboboxProps {
  value: string | null;
  onChange: (vendorId: string | null, vendor: VendorOption | null) => void;
  options: VendorOption[];
  onCreateNew?: () => void;
  placeholder?: string;
  disabled?: boolean;
}

export default function VendorCombobox({
  value,
  onChange,
  options,
  onCreateNew,
  placeholder = "Select vendor…",
  disabled,
}: VendorComboboxProps) {
  const [open, setOpen] = useState(false);

  const selected = options.find((v) => v.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          {selected ? (
            <span className="truncate">
              {selected.name}
              {selected.dba_name && (
                <span className="text-nurock-slate-light text-xs ml-1">
                  · DBA {selected.dba_name}
                </span>
              )}
            </span>
          ) : (
            <span className="text-nurock-slate-light">{placeholder}</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
        <Command>
          <CommandInput placeholder="Search vendors…" />
          <CommandList>
            <CommandEmpty>No vendors found.</CommandEmpty>
            <CommandGroup>
              {options
                .filter((v) => v.status === "active")
                .map((v) => (
                  <CommandItem
                    key={v.id}
                    value={`${v.name} ${v.dba_name ?? ""}`}
                    onSelect={() => {
                      onChange(v.id, v);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={`mr-2 h-4 w-4 ${
                        value === v.id ? "opacity-100" : "opacity-0"
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="truncate text-sm">{v.name}</div>
                      {v.dba_name && (
                        <div className="text-[11px] text-nurock-slate-light truncate">
                          DBA {v.dba_name}
                        </div>
                      )}
                    </div>
                    <span className="text-[10px] text-nurock-slate-light ml-2 shrink-0">
                      Net {v.payment_terms_days}
                    </span>
                  </CommandItem>
                ))}
              {onCreateNew && (
                <CommandItem
                  onSelect={() => {
                    setOpen(false);
                    onCreateNew();
                  }}
                  className="border-t border-nurock-border mt-1 pt-2 text-nurock-navy"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Create new vendor…
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
