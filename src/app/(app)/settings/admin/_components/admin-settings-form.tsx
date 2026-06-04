"use client";

import * as React from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, ShieldAlert } from "lucide-react";
import type {
  AdminSettings,
  ProRataDiagnosticMode,
} from "@/lib/data/admin-settings";
import { saveProRataDiagnosticMode } from "../actions";

export function AdminSettingsForm({
  initialSettings,
}: {
  initialSettings: AdminSettings;
}) {
  const [mode, setMode] = React.useState<ProRataDiagnosticMode>(
    initialSettings.proRataDiagnosticMode
  );
  const [saving, setSaving] = React.useState(false);
  const dirty = mode !== initialSettings.proRataDiagnosticMode;

  async function handleSave() {
    setSaving(true);
    const result = await saveProRataDiagnosticMode(mode);
    setSaving(false);
    if (result.error) {
      toast.error(result.error);
    } else {
      toast.success("Settings saved");
    }
  }

  return (
    <div className="space-y-4">
      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 bg-nurock-gray/40 border-b border-nurock-border">
          <h2 className="font-display text-sm uppercase tracking-wider text-nurock-navy font-semibold">
            Pro-Rata Diagnostic Mode
          </h2>
          <p className="text-xs text-nurock-slate-light mt-0.5">
            How the draw submit step responds when actual allocations deviate
            from the pro-rata target.
          </p>
        </div>

        <div className="p-4 space-y-3">
          <label className="flex items-start gap-3 p-3 border border-nurock-border rounded-md hover:bg-nurock-gray/10 cursor-pointer">
            <input
              type="radio"
              name="proRataDiagnosticMode"
              value="soft_warn"
              checked={mode === "soft_warn"}
              onChange={() => setMode("soft_warn")}
              className="mt-0.5"
            />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-600" />
                <span className="font-medium text-nurock-black text-sm">
                  Soft warn
                </span>
                <span className="text-[10px] text-nurock-slate-light bg-nurock-gray/40 px-2 py-0.5 rounded">
                  default
                </span>
              </div>
              <p className="text-xs text-nurock-slate mt-1">
                Show a warning banner when actual allocations don&apos;t match
                the pro-rata target, but allow submission. CFO can override
                deliberately when manual adjustments are intentional.
              </p>
            </div>
          </label>

          <label className="flex items-start gap-3 p-3 border border-nurock-border rounded-md hover:bg-nurock-gray/10 cursor-pointer">
            <input
              type="radio"
              name="proRataDiagnosticMode"
              value="hard_block"
              checked={mode === "hard_block"}
              onChange={() => setMode("hard_block")}
              className="mt-0.5"
            />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-red-700" />
                <span className="font-medium text-nurock-black text-sm">
                  Hard block
                </span>
              </div>
              <p className="text-xs text-nurock-slate mt-1">
                Block draw submission while any deviation from the pro-rata
                target exists. User must either re-apply pro-rata (overwriting
                manual edits) or switch the draw to manual mode to submit.
              </p>
            </div>
          </label>
        </div>

        <div className="px-4 py-3 bg-nurock-gray/20 border-t border-nurock-border flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMode(initialSettings.proRataDiagnosticMode)}
            disabled={!dirty || saving}
            className="h-8 text-xs"
          >
            Reset
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!dirty || saving}
            className="h-8 text-xs bg-nurock-navy hover:bg-nurock-navy-dark"
          >
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
