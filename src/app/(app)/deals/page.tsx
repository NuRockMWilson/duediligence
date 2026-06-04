import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDateLong } from "@/lib/format";
import Logo from "@/components/logo";
import AccountMenu from "@/components/account-menu";
import { NotificationsBell } from "@/components/notifications-bell";
import { getCurrentUserAccess } from "@/lib/auth/access";
import { Receipt } from "lucide-react";
import { PortfolioExportButtons } from "./_components/portfolio-export-buttons";
import { getDiligenceReadinessByDeal } from "@/lib/data/diligence-rollup";
import { coverageTone } from "@/lib/design-tokens";

interface DealModelInfo {
  city?: string;
  state?: string;
  totalUnits?: number;
  creditStructure?: string;
}
interface DealModelBudgetLine {
  amount?: number;
}
interface DealModel {
  info?: DealModelInfo;
  constructionBudget?: DealModelBudgetLine[];
}

export default async function DealsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const access = await getCurrentUserAccess();

  const { data: deals, error } = await supabase
    .from("deals")
    .select("id, name, stage, model, updated_at")
    .order("updated_at", { ascending: false });

  // Per-deal due-diligence readiness, batched into one query.
  const readinessByDeal = await getDiligenceReadinessByDeal();
  const READINESS_BAR: Record<string, string> = {
    ok: "bg-emerald-500",
    warn: "bg-amber-500",
    bad: "bg-red-500",
    muted: "bg-nurock-navy",
  };

  return (
    <div className="min-h-screen bg-[#F7F8FA]">
      {/* Simple top header — just branding + user, no module switcher */}
      <header className="bg-nurock-navy text-white shadow-lg">
        <div className="max-w-[1600px] mx-auto px-5 py-2.5 flex items-center justify-between gap-4 min-h-[56px]">
          <div className="flex items-center gap-3">
            <Logo className="h-9 w-auto" />
            <div>
              <div className="font-display text-sm uppercase tracking-[0.14em] leading-tight">
                NuRock
              </div>
              <div className="text-[10px] text-white/60 tracking-wide leading-tight">
                Development Platform
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <NotificationsBell />
            <AccountMenu
              email={access?.email ?? user?.email ?? ""}
              displayName={access?.displayName}
              isOrgAdmin={access?.isOrgAdmin ?? false}
            />
          </div>
        </div>
      </header>

      <div className="max-w-[1600px] mx-auto px-8 py-8">
        <header className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl text-nurock-black">Deals</h1>
            <p className="text-sm text-nurock-slate-light mt-1">
              {deals?.length ?? 0} active
            </p>
          </div>
          {/* Portfolio-level affordances. Payables (Portfolio) lives here,
              not inside individual deal sidebars — keeps cross-deal views
              at the portfolio level. */}
          <div className="flex items-center gap-2">
            <PortfolioExportButtons />
            <Link
              href="/payables"
              className="inline-flex items-center gap-1.5 rounded-md border border-nurock-border bg-white px-3 py-1.5 text-[12px] font-medium shadow-sm hover:bg-nurock-gray text-nurock-navy"
              title="Cross-deal payables — unpaid invoices, affiliate reimbursements, by-vendor rollup"
            >
              <Receipt className="h-3.5 w-3.5" />
              Payables (Portfolio)
            </Link>
          </div>
        </header>

        {error ? (
          <Card className="p-6 bg-red-50 border-red-200 text-sm text-red-700">
            Error loading deals: {error.message}
          </Card>
        ) : (deals?.length ?? 0) === 0 ? (
          <Card className="p-8 text-center">
            <p className="text-sm text-nurock-slate-light">
              No deals yet. The Foxcroft placeholder seed should have created
              one — check that the migration ran successfully.
            </p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {deals?.map((deal) => {
              const model = (deal.model ?? {}) as DealModel;
              const info = model.info ?? {};
              const budget = model.constructionBudget ?? [];
              const totalBudget = budget.reduce(
                (sum, line) => sum + (line.amount ?? 0),
                0
              );

              return (
                <Link
                  key={deal.id}
                  href={`/deals/${deal.id}/diligence`}
                  className="block"
                >
                  <Card className="p-5 hover:shadow-md hover:border-nurock-navy/20 transition cursor-pointer h-full">
                    <div className="flex items-start justify-between mb-3">
                      <Badge
                        variant="outline"
                        className="text-[10px] uppercase tracking-wider"
                      >
                        {deal.stage}
                      </Badge>
                      <div className="text-[10px] text-nurock-slate-light">
                        {formatDateLong(deal.updated_at)}
                      </div>
                    </div>
                    <h2 className="font-display text-base font-semibold text-nurock-black leading-tight">
                      {deal.name}
                    </h2>
                    {(info.city || info.state) && (
                      <div className="mt-1 text-xs text-nurock-slate-light">
                        {[info.city, info.state].filter(Boolean).join(", ")}
                        {info.totalUnits ? ` · ${info.totalUnits} units` : ""}
                        {info.creditStructure
                          ? ` · ${info.creditStructure}`
                          : ""}
                      </div>
                    )}
                    <div className="mt-4 pt-3 border-t border-nurock-border flex justify-between items-baseline">
                      <span className="text-[10px] uppercase tracking-wider text-nurock-slate-light font-display">
                        Total Dev Cost
                      </span>
                      <span className="font-mono text-sm font-semibold text-nurock-black">
                        {formatCurrency(totalBudget)}
                      </span>
                    </div>
                    {(() => {
                      const dd = readinessByDeal.get(deal.id);
                      if (!dd || dd.total === 0) return null;
                      const tone = coverageTone(dd.coveragePct);
                      return (
                        <div className="mt-2.5">
                          <div className="flex justify-between items-baseline mb-1">
                            <span className="text-[10px] uppercase tracking-wider text-nurock-slate-light font-display">
                              DD Readiness
                            </span>
                            <span className="text-[11px] font-mono font-semibold text-nurock-black">
                              {dd.coveragePct}%
                              {dd.overdueCount > 0 ? (
                                <span className="ml-1.5 text-red-600">
                                  · {dd.overdueCount} overdue
                                </span>
                              ) : null}
                            </span>
                          </div>
                          <div className="relative h-1.5 overflow-hidden rounded-full bg-[#F2F4F7]">
                            <div
                              className={`h-full ${READINESS_BAR[tone]}`}
                              style={{ width: `${dd.coveragePct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })()}
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
