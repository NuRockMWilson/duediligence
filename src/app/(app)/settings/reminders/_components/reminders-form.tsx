"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Mail } from "lucide-react";
import { Card } from "@/components/nurock-ui";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDate } from "@/lib/format";
import {
  saveReminderPrefs,
  type ReminderCadence,
  type ReminderScope,
} from "../actions";

export function RemindersForm({
  initialCadence,
  initialScope,
  lastSentAt,
  emailConfigured,
}: {
  initialCadence: ReminderCadence;
  initialScope: ReminderScope;
  lastSentAt: string | null;
  emailConfigured: boolean;
}) {
  const router = useRouter();
  const [cadence, setCadence] = React.useState<ReminderCadence>(initialCadence);
  const [scope, setScope] = React.useState<ReminderScope>(initialScope);
  const [saving, setSaving] = React.useState(false);

  const dirty = cadence !== initialCadence || scope !== initialScope;

  async function save() {
    setSaving(true);
    const res = await saveReminderPrefs({ cadence, scope });
    setSaving(false);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    toast.success(
      cadence === "off" ? "Reminders turned off." : "Reminder settings saved."
    );
    router.refresh();
  }

  return (
    <>
      {/* ---------------------------------------------------------------
          DELIVERY IS NOT CONFIGURED — SAY SO, PROMINENTLY.
          ---------------------------------------------------------------
          This exact feature reported success while delivering nothing for
          months: the cron could not write, and the route returned ok:true with
          a count of people it INTENDED to notify. dm_notifications still holds
          one row in the whole platform.

          So a settings page that quietly accepts an interval while no email can
          leave the building would repeat that failure at the UI layer. The
          setting still saves — it is real, and it takes effect the moment Resend
          is provisioned — but the page does not let anyone believe mail is
          going out when it cannot.
      --------------------------------------------------------------- */}
      {/* FINDING C (live, round 53): IT RENDERED WHITE, NOT AMBER.
          Card bakes `bg-white` into its own class list, so bg-nurock-tan/[0.07]
          on the SAME element gave two background utilities of equal specificity
          and bg-white won — the computed backgroundColor measured
          rgb(255,255,255) and the tint never rendered at all. Presence passed,
          prominence failed. A warning that does not look like one is precisely
          the failure this notice exists to prevent.

          Now a plain div rather than fighting Card's own utilities: overriding a
          component's baked-in background by class order works right up until
          someone reorders a class list. */}
      {!emailConfigured && (
        <div className="rounded-[10px] border border-nurock-tan-dark/50 bg-[#FDF6EC] p-4 shadow-sm">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-nurock-tan-dark flex-shrink-0 mt-0.5" />
            <div className="text-[12.5px] text-nurock-slate">
              <div className="font-medium text-nurock-black">
                Email delivery is not configured yet
              </div>
              <p className="mt-1">
                Your choice below is saved and will take effect as soon as the
                mail sender is set up, but{" "}
                <strong>no reminders are being sent right now</strong>. This is
                waiting on the Resend domain setup in the platform IT request.
              </p>
            </div>
          </div>
        </div>
      )}

      <Card className="p-5 space-y-5">
        <div className="space-y-1.5">
          <label className="font-display text-[11.5px] uppercase tracking-wider text-nurock-slate">
            How often
          </label>
          <Select
            value={cadence}
            onValueChange={(v) => setCadence(v as ReminderCadence)}
          >
            <SelectTrigger className="h-9 text-[13px] w-full sm:w-[280px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off">Off — no emails</SelectItem>
              <SelectItem value="daily">Every day</SelectItem>
              <SelectItem value="weekly">Every week</SelectItem>
              <SelectItem value="monthly">Every month</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[11.5px] text-nurock-slate-light">
            You will only be emailed when you actually have outstanding items —
            an interval with nothing open sends nothing.
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="font-display text-[11.5px] uppercase tracking-wider text-nurock-slate">
            What to include
          </label>
          <Select
            value={scope}
            onValueChange={(v) => setScope(v as ReminderScope)}
            disabled={cadence === "off"}
          >
            <SelectTrigger className="h-9 text-[13px] w-full sm:w-[280px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mine">
                Only my items that are not complete
              </SelectItem>
              <SelectItem value="all">
                The current status of the whole list
              </SelectItem>
            </SelectContent>
          </Select>
          {/* "My items" means BOTH senses on purpose. Assignee and responsible
              party answer different questions — who is working it, and who owes
              it — and a reminder that covered only one would miss real work. */}
          <p className="text-[11.5px] text-nurock-slate-light">
            &ldquo;My items&rdquo; covers anything you are the assignee for{" "}
            <em>or</em> the responsible party for.
          </p>
        </div>

        <div className="flex items-center gap-3 pt-1">
          <Button onClick={save} disabled={saving || !dirty} className="h-9">
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Mail className="w-4 h-4" />
            )}
            Save settings
          </Button>
          {lastSentAt && (
            <span className="text-[11.5px] text-nurock-slate-light">
              Last reminder sent {formatDate(lastSentAt)}
            </span>
          )}
          {!lastSentAt && cadence !== "off" && (
            <span className="text-[11.5px] text-nurock-slate-light">
              No reminder sent yet
            </span>
          )}
        </div>
      </Card>
    </>
  );
}
