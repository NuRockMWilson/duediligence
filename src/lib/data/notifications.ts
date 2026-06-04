import { createClient } from "@/lib/supabase/server";

export interface NotificationRow {
  id: string;
  deal_id: string | null;
  kind: string;
  subject: string;
  body: string | null;
  href: string | null;
  read_at: string | null;
  created_at: string;
}

/**
 * Returns the current user's most recent notifications (newest first). Used to
 * hydrate the notifications bell on initial render.
 */
export async function getMyNotifications(
  limit = 20
): Promise<NotificationRow[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
    .from("dm_notifications")
    .select("id, deal_id, kind, subject, body, href, read_at, created_at")
    .eq("recipient_user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data ?? []) as NotificationRow[];
}
