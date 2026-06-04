"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { findActiveNav } from "@/lib/nav";

// =============================================================================
// Breadcrumb beneath the navy DealHeader. Renders:
//   DEAL NAME › GROUP › ITEM
// Deal name links back to the dashboard. Returns null when the current path
// isn't a known nav route (custom sub-routes, 404 pages, etc.) so the bar
// disappears cleanly rather than rendering an incomplete trail.
// =============================================================================

export default function DealBreadcrumb({
  dealName,
  dealId,
}: {
  dealName: string;
  dealId: string;
}) {
  const pathname = usePathname();
  const match = findActiveNav(pathname ?? "", dealId);
  if (!match) return null;

  return (
    // Sticky directly under the navy DealHeader so the breadcrumb stays
    // anchored while the body scrolls. top-[88px] = sum of header row 1
    // (44px) + row 1 border (1px) + row 2 (44px) = 89px-ish; using 88px
    // ensures a 1px overlap rather than a hairline gap. z-40 sits under the
    // header's z-50 so the navy bar's shadow still falls over the breadcrumb.
    <nav
      aria-label="Breadcrumb"
      className="bg-white border-b border-nurock-border sticky top-[88px] z-40"
    >
      <ol className="flex items-center gap-1.5 px-8 py-2 max-w-[1600px] mx-auto text-[11px] font-display uppercase tracking-wider">
        <li>
          <Link
            href={`/deals/${dealId}/dashboard`}
            className="text-nurock-slate hover:text-nurock-navy transition-colors"
          >
            {dealName}
          </Link>
        </li>
        <li className="flex items-center">
          <ChevronRight className="w-3 h-3 text-nurock-slate-light" />
        </li>
        <li>
          <span className="text-nurock-slate">{match.group.label}</span>
        </li>
        <li className="flex items-center">
          <ChevronRight className="w-3 h-3 text-nurock-slate-light" />
        </li>
        <li>
          <span className="text-nurock-navy font-semibold">
            {match.item.label}
          </span>
        </li>
      </ol>
    </nav>
  );
}
