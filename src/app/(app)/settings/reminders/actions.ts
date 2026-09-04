"use server";

// =============================================================================
// Reminder preferences — the caller's OWN row only
// =============================================================================
// One export, and it never takes a user id. The row it writes is always
// auth.uid()'s, so there is no parameter a caller could point at somebody else.
// The RLS policy on dm_diligence_reminder_prefs enforces the same rule
// (user_id = auth.uid() OR org admin), so the app and the database agree — but
// not accepting the id in the first place means the app layer cannot be the one
// that gets it wrong.
//
// assertDiligenceCan("view"), not "edit": changing your own notification
// cadence is not editing diligence data. A viewer who is assigned items has
// every reason to want reminders about them, and gating this at "edit" would
// deny exactly the people most likely to need it.
// =============================================================================

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { assertDiligenceCan } from "@/lib/auth/access";
import { describeDbError } from "@/lib/diligence/db-errors";

export type ReminderCadence = "off" | "daily" | "weekly" | "monthly";
export type ReminderScope = "mine" | "all";

export async function saveReminderPrefs(input: {
  cadence: ReminderCadence;
  scope: ReminderScope;
}): Promise<{ error?: string }> {
  await assertDiligenceCan("view");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  const { data, error } = await sb
    .from("dm_diligence_reminder_prefs")
    .upsert(
      {
        user_id: user.id,
        cadence: input.cadence,
        scope: input.scope,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    )
    .select("user_id");
  if (error) return { error: describeDbError(error) };
  // .select() so a zero-row upsert fails loudly rather than toasting success
  // without persisting — the guard this codebase uses everywhere a write could
  // be silently filtered by RLS.
  if (!data || (data as unknown[]).length === 0) {
    return {
      error:
        "The change didn't persist — no row was written. Check row-level security on dm_diligence_reminder_prefs.",
    };
  }

  // NOTE: last_sent_at is deliberately NOT touched. Switching from weekly to
  // daily should not reset someone's clock and fire an immediate extra email;
  // the SQL function compares against last_sent_at, so the new interval simply
  // applies from the last real send.
  revalidatePath("/settings/reminders");
  return {};
}
