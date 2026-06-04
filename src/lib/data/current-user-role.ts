import { createClient } from "@/lib/supabase/server";

/**
 * Loads the current user's app_users record. Returns null if not authenticated
 * or if the user has no app_users entry. Server-side only.
 *
 * Used by:
 *   - active-draw page to determine which approval/revert buttons to render
 *   - team management page for current-user context
 *   - any future role-gated UI
 */
export async function getCurrentUserRole(): Promise<{
  userId: string;
  email: string;
  displayName: string | null;
  isPm: boolean;
  isCfo: boolean;
} | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: appUser } = await supabase
    .from("app_users")
    .select("is_pm, is_cfo, display_name, email")
    .eq("user_id", user.id)
    .maybeSingle();

  // No app_users row — user is authenticated but not on the team.
  if (!appUser) {
    return {
      userId: user.id,
      email: user.email ?? "",
      displayName: null,
      isPm: false,
      isCfo: false,
    };
  }

  return {
    userId: user.id,
    email: appUser.email ?? user.email ?? "",
    displayName: appUser.display_name,
    isPm: Boolean(appUser.is_pm),
    isCfo: Boolean(appUser.is_cfo),
  };
}
