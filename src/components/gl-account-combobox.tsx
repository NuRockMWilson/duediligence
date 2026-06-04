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
import { Check, ChevronsUpDown } from "lucide-react";

export interface GLAccount {
  gl_account: string;
  account_description: string;
}

interface GLAccountComboboxProps {
  value: string;
  onChange: (value: string) => void;
  options: GLAccount[];
  placeholder?: string;
  disabled?: boolean;
}

export default function GLAccountCombobox({
  value,
  onChange,
  options,
  placeholder = "Select GL account…",
  disabled,
}: GLAccountComboboxProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find((a) => a.gl_account === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-mono text-xs h-9 bg-white"
        >
          <span className="truncate text-left flex-1">
            {selected ? (
              <>
                <span className="font-semibold">{selected.gl_account}</span>
                <span className="ml-2 font-sans text-nurock-slate">
                  {selected.account_description}
                </span>
              </>
            ) : (
              <span className="text-nurock-slate-light font-sans">
                {placeholder}
              </span>
            )}
          </span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 opacity-50 flex-shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0"
        align="start"
      >
        <Command
          filter={(value, search) => {
            // value here is the CommandItem's value (gl_account + description),
            // search is what the user typed
            return value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0;
          }}
        >
          <CommandInput placeholder="Search GL or description…" className="h-9" />
          <CommandList className="max-h-[280px]">
            <CommandEmpty>No GL account found.</CommandEmpty>
            <CommandGroup>
              {options.map((acct) => (
                <CommandItem
                  key={acct.gl_account}
                  value={`${acct.gl_account} ${acct.account_description}`}
                  onSelect={() => {
                    onChange(acct.gl_account);
                    setOpen(false);
                  }}
                  className="cursor-pointer"
                >
                  <Check
                    className={`mr-2 h-3.5 w-3.5 ${
                      value === acct.gl_account ? "opacity-100" : "opacity-0"
                    }`}
                  />
                  <span className="font-mono font-semibold text-xs">
                    {acct.gl_account}
                  </span>
                  <span className="ml-2 text-xs text-nurock-slate truncate">
                    {acct.account_description}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
