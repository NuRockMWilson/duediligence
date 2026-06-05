"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings, ArrowLeft } from "lucide-react";
import { buildNav } from "@/lib/nav";

export default function DealSidebar({ dealId }: { dealId: string }) {
  const pathname = usePathname();
  const groups = buildNav(dealId);

  return (
    // Sticky under the navy header (89px) + the white breadcrumb (~32px) ≈
    // 120px from the viewport top. max-h + overflow-y-auto so the nav stays
    // visible even on short viewports — sidebar scrolls internally rather
    // than running off-screen. self-start prevents flex-stretch from
    // pinning the sidebar to the (potentially very tall) main content.
    <aside className="w-[220px] shrink-0 bg-white border-r border-nurock-border py-4 sticky top-[88px] self-start max-h-[calc(100vh-88px)] overflow-y-auto">
      {/* Cross-app navigation — back to the model's portfolio dashboard.
          Portfolio is the single home for the platform; clicking this
          jumps from dev mgmt back to the deals list in the model.
          Settings opens the org-level configuration area. */}
      <div className="px-5 pb-3 mb-2 border-b border-nurock-border space-y-2">
        <a
          href={
            process.env.NEXT_PUBLIC_MODEL_URL ?? "https://nurockmodel.vercel.app"
          }
          className="flex items-center gap-2 text-[12px] font-display uppercase tracking-wider text-nurock-slate hover:text-nurock-navy transition-colors group"
          title="Back to the portfolio dashboard in the underwriting model"
        >
          <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" />
          <span>Portfolio</span>
        </a>
        <Link
          href="/settings"
          className="flex items-center gap-2 text-[12px] font-display uppercase tracking-wider text-nurock-slate hover:text-nurock-navy transition-colors"
          title="Org-level settings — standard schedule, reporting templates, etc."
        >
          <Settings className="w-3.5 h-3.5" />
          <span>Settings</span>
        </Link>
      </div>

      <nav className="space-y-0.5 text-[13px]">
        {groups.map((group, idx) => (
          <div key={group.label}>
            <div className={`px-5 pb-2 ${idx === 0 ? "pt-1" : "pt-4"}`}>
              <div className="font-display text-[10px] uppercase tracking-[0.12em] text-nurock-slate-light">
                {group.label}
              </div>
            </div>
            {group.items.map((item) => {
              const Icon = item.icon;
              const active =
                pathname === item.href ||
                pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-2.5 px-5 py-2 transition relative ${
                    active
                      ? "bg-nurock-navy/5 text-nurock-navy font-semibold border-l-2 border-nurock-navy -ml-[2px] pl-[18px]"
                      : "text-nurock-slate hover:bg-nurock-gray hover:text-nurock-black"
                  }`}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  <span className="truncate">{item.label}</span>
                  {item.badge && (
                    <span
                      className={`ml-auto text-[8px] px-1.5 py-0.5 rounded-full font-semibold ${
                        item.badge.tone === "tan"
                          ? "bg-nurock-tan text-nurock-navy-dark"
                          : "bg-nurock-navy text-white"
                      }`}
                    >
                      {item.badge.label}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}
