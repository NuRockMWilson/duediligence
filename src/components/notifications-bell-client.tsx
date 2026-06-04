"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell, Check } from "lucide-react";
import { formatDateLong } from "@/lib/format";
import {
  markNotificationRead,
  markAllNotificationsRead,
} from "@/lib/notification-actions";
import { createClient } from "@/lib/supabase/client";

interface Item {
  id: string;
  deal_id: string | null;
  kind: string;
  subject: string;
  body: string | null;
  href: string | null;
  read_at: string | null;
  created_at: string;
}

export default function NotificationsBellClient({
  initialItems,
  userId,
}: {
  initialItems: Item[];
  /** auth.users.id for the current user. Null when signed-out (no subscription). */
  userId: string | null;
}) {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>(initialItems);
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Keep state in sync with server props (router.refresh re-runs the server
  // entry and feeds new initialItems in).
  useEffect(() => {
    setItems(initialItems);
  }, [initialItems]);

  // ---------------------------------------------------------------------------
  // Realtime subscription — push notifications without a navigation/refresh.
  //
  // Subscribes to Supabase Postgres Changes on dm_notifications filtered to
  // THIS user's recipient_user_id. Migration 0069 adds the table to the
  // supabase_realtime publication and sets REPLICA IDENTITY FULL so UPDATE
  // events include the full row (needed for the filter and for merging).
  //
  // Events handled:
  //   INSERT — prepend to items (dedup by id in case the server initial fetch
  //            races a fresh insert)
  //   UPDATE — merge changed fields into the matching item (e.g., read_at
  //            being set from another tab / device)
  //
  // Cross-app payoff: a notification dispatched from underwriting lands in
  // devmgmt's bell within ~100ms without the user needing to do anything.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`dm_notifications:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "dm_notifications",
          filter: `recipient_user_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as Item;
          setItems((prev) => {
            if (prev.some((i) => i.id === row.id)) return prev;
            return [row, ...prev];
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "dm_notifications",
          filter: `recipient_user_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as Item;
          setItems((prev) =>
            prev.map((i) => (i.id === row.id ? { ...i, ...row } : i))
          );
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  // Close the dropdown on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const unread = items.filter((i) => !i.read_at).length;

  function onMarkRead(id: string) {
    // Optimistic
    setItems((prev) =>
      prev.map((i) =>
        i.id === id ? { ...i, read_at: new Date().toISOString() } : i
      )
    );
    startTransition(async () => {
      await markNotificationRead(id);
      router.refresh();
    });
  }

  function onMarkAllRead() {
    const now = new Date().toISOString();
    setItems((prev) =>
      prev.map((i) => (i.read_at ? i : { ...i, read_at: now }))
    );
    startTransition(async () => {
      await markAllNotificationsRead();
      router.refresh();
    });
  }

  return (
    // Bell now lives INSIDE the navy-bar right cluster (not floating). Wrapper
    // is `relative` so the dropdown can absolute-position to it. Button styled
    // to match the SIGN OUT button (h-8 white/10 bg) so the right cluster
    // visually flows as one piece. See docs/shell.md §5.
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative h-8 w-8 inline-flex items-center justify-center rounded bg-white/10 hover:bg-white/20 transition-colors text-white"
        title="Notifications"
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ""}`}
      >
        <Bell className="w-3.5 h-3.5" />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-600 text-white text-[10px] font-mono rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute top-11 right-0 w-[340px] max-h-[480px] bg-white rounded-md shadow-lg border border-nurock-border overflow-hidden flex flex-col">
          <div className="px-3 py-2 border-b border-nurock-border flex items-center justify-between bg-nurock-gray/40">
            <h3 className="font-display text-xs uppercase tracking-wider text-nurock-navy font-semibold">
              Notifications
            </h3>
            {unread > 0 && (
              <button
                type="button"
                onClick={onMarkAllRead}
                className="text-[11px] text-nurock-slate hover:text-nurock-navy underline"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="overflow-y-auto divide-y divide-nurock-border">
            {items.length === 0 ? (
              <div className="px-3 py-8 text-center text-xs text-nurock-slate-light italic">
                No notifications yet.
              </div>
            ) : (
              items.map((item) => (
                <div
                  key={item.id}
                  className={`px-3 py-2.5 ${item.read_at ? "" : "bg-nurock-navy/[0.03]"}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      {item.href ? (
                        <a
                          href={item.href}
                          onClick={() => {
                            if (!item.read_at) onMarkRead(item.id);
                            setOpen(false);
                          }}
                          className="text-sm text-nurock-black hover:text-nurock-navy hover:underline"
                        >
                          {item.subject}
                        </a>
                      ) : (
                        <div className="text-sm text-nurock-black">
                          {item.subject}
                        </div>
                      )}
                      {item.body && (
                        <div className="text-[11px] text-nurock-slate-light mt-0.5 line-clamp-2">
                          {item.body}
                        </div>
                      )}
                      <div className="text-[10px] text-nurock-slate-light mt-1">
                        {formatDateLong(item.created_at)}
                      </div>
                    </div>
                    {!item.read_at && (
                      <button
                        type="button"
                        onClick={() => onMarkRead(item.id)}
                        className="p-1 text-nurock-slate-light hover:text-nurock-navy"
                        title="Mark read"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
