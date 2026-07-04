"use client";

// =============================================================================
// ConfirmDialog — the app's standard confirmation modal (brief item 7)
// =============================================================================
// Replaces native window.confirm() popups (retire template, remove packet,
// unlink document, …) with the same dialog pattern the rest of the app uses.
// Controlled: the caller holds `open` state and passes onConfirm; the dialog
// closes itself on either choice.
// =============================================================================

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  pending = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button for destructive actions. */
  destructive?: boolean;
  /** Disables both buttons while the action runs. */
  pending?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="font-display text-nurock-black">
            {title}
          </DialogTitle>
          {description ? (
            <DialogDescription className="text-[13px] leading-relaxed">
              {description}
            </DialogDescription>
          ) : null}
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            {cancelLabel}
          </Button>
          <Button
            disabled={pending}
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
            className={
              destructive
                ? "bg-red-600 hover:bg-red-700 text-white"
                : "bg-nurock-navy hover:bg-nurock-navy-dark text-white"
            }
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
