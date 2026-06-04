"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, Calendar, ArrowRightLeft, Network, Users, Shield, Building2, ClipboardList } from "lucide-react";

/**
 * Phase 5 — Settings shell. Org-level configuration that flows through to
 * every deal. Layout intentionally mirrors the per-deal sidebar in
 * deal-shell/sidebar.tsx so navigating between a deal and Settings feels
 * the same: 220px sidebar, top-block with Portfolio back-link, group
 * headers, identical nav item styling with active state.
 *
 * Sections will grow in subsequent rounds (Reporting Templates, Vendor
 * Master, Standard Milestones, etc.). Each lives at /settings/<section>.
 */

interface SettingsNavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: { label: string; tone: "navy" | "tan" };
}

interface SettingsNavGroup {
  label: string;
  items: SettingsNavItem[];
}

const NAV: SettingsNavGroup[] = [
  {
    label: "Configuration",
    items: [
      {
        href: "/settings/standard-schedule",
        label: "Report Formats",
        icon: Calendar,
      },
      {
        href: "/settings/mappings/underwriting-lines",
        label: "Underwriting Line → GL",
        icon: ArrowRightLeft,
      },
      {
        href: "/settings/mappings/gl-to-standard",
        label: "Chart of Accounts & Groupings",
        icon: Network,
      },
      {
        href: "/settings/vendors",
        label: "Vendors & Subs",
        icon: Building2,
      },
      {
        href: "/settings/diligence-templates",
        label: "Diligence Templates",
        icon: ClipboardList,
      },
    ],
  },
  {
    label: "Administration",
    items: [
      {
        href: "/settings/team",
        label: "Users & Access",
        icon: Users,
      },
      {
        href: "/settings/admin",
        label: "Admin",
        icon: Shield,
      },
    ],
  },
];

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="flex">
      <aside className="w-[220px] shrink-0 bg-white border-r border-nurock-border min-h-[calc(100vh-56px)] py-4 sticky top-[56px] self-start">
        {/* Cross-app navigation — back to the model's portfolio dashboard.
            Same pattern as the per-deal sidebar so the two shells feel
            identical when jumping between them. */}
        <div className="px-5 pb-3 mb-2 border-b border-nurock-border">
          <a
            href={
              process.env.NEXT_PUBLIC_MODEL_URL ??
              "https://nurockmodel.vercel.app"
            }
            className="flex items-center gap-2 text-[12px] font-display uppercase tracking-wider text-nurock-slate hover:text-nurock-navy transition-colors group"
            title="Back to the portfolio dashboard in the underwriting model"
          >
            <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" />
            <span>Portfolio</span>
          </a>
        </div>

        <nav className="space-y-0.5 text-[13px]">
          {NAV.map((group, idx) => (
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

      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
