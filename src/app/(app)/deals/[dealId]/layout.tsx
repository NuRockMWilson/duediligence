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
    // Item 5: pull the UW construction budget (JSON sub-path — not the whole
    // model) so the header's TDC chip shows the deal's REAL total development
    // cost instead of a fabricated $0.
    supabase
      .from("deals")
      .select("id, name, stage, constructionBudget:model->constructionBudget")
      .eq("id", dealId)
      .single(),
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

  // TDC = sum of the UW model's construction-budget lines — the same source
  // of truth the Underwriting model and Dev-module dashboard report.
  const cbLines = (deal as { constructionBudget?: Array<{ amount?: number }> })
    .constructionBudget;
  const totalDevCost = Array.isArray(cbLines)
    ? cbLines.reduce((s, l) => s + (Number(l?.amount) || 0), 0)
    : 0;

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
      {/* Shell row width (see nurock-devmgmt/docs/shell.md §1 / §6): the SAME
          max-w-[1600px] mx-auto container as the header above, which is what
          puts the navy rail's left edge on the logo's. Development now matches
          this; Underwriting's DEAL view is deliberately full-bleed instead (its
          Pro Forma is 2404px wide, so the cap there evicts year columns) and
          aligns at x=0 on both. NB: a previous comment here claimed this had
          been bumped to 1920 — it never was, and the measured rail position
          (x=472 in a 2560px window) is this 1600px cap. */}
      <div className="flex max-w-[1600px] mx-auto">
        <DealSidebar dealId={dealId} />
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}
