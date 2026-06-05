import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DealHeader from "@/components/deal-shell/header";
import DealSidebar from "@/components/deal-shell/sidebar";
import { NotificationsBell } from "@/components/notifications-bell";
import { getCurrentUserAccess } from "@/lib/auth/access";

export default async function DealLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getCurrentUserAccess();

  const [{ data: deal, error }, { data: allDeals }] = await Promise.all([
    supabase.from("deals").select("id, name, stage").eq("id", dealId).single(),
    // Full deal list for the in-header switcher dropdown — sorted by most
    // recently updated so the active project + likely-next-target sit at the
    // top. Limit 50 to keep the popover navigable. `stage` powers the
    // colored dot on each row so the cross-app visual matches UW.
    supabase
      .from("deals")
      .select("id, name, stage")
      .order("updated_at", { ascending: false })
      .limit(50),
  ]);

  if (error || !deal) notFound();

  // Diligence app: no draw-budget chip in the header.
  const totalDevCost = 0;

  return (
    <div className="min-h-screen bg-[#F7F8FA]">
      <DealHeader
        dealId={dealId}
        dealName={deal.name}
        dealStage={deal.stage}
        totalDevCost={totalDevCost}
        userEmail={access?.email ?? user.email ?? "unknown"}
        userDisplayName={access?.displayName ?? null}
        isOrgAdmin={access?.isOrgAdmin ?? false}
        deals={allDeals ?? []}
        savedAt={Date.now()}
        notificationsBell={<NotificationsBell />}
      />
      {/* Bumped from max-w-[1600px] to 1920 so main content extends further
          right on wide monitors (sidebar 200px + ~1720px main). Keeps parity
          with UW where the same canvas without a sidebar uses full width.
          See docs/shell.md §6. */}
      <div className="flex max-w-[1600px] mx-auto">
        <DealSidebar dealId={dealId} />
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}
