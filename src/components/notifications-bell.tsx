import { getMyNotifications } from "@/lib/data/notifications";
import { createClient } from "@/lib/supabase/server";
import NotificationsBellClient from "./notifications-bell-client";

// Server entry — hydrates the bell with the current user's recent notifications
// and passes the user's id to the client so it can subscribe to realtime row
// pushes filtered by recipient_user_id.
// Mounted in the (app) layout so it's visible across every authenticated page.
export async function NotificationsBell() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const items = await getMyNotifications();
  return (
    <NotificationsBellClient
      initialItems={items}
      userId={user?.id ?? null}
    />
  );
}
