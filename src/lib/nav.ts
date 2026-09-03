import { ClipboardList, FolderOpen } from "lucide-react";

// =============================================================================
// Single source of truth for the deal-shell navigation. Shared by the sidebar
// (renders the full tree) and the breadcrumb (looks up the active node from
// the current pathname).
// =============================================================================

export interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: { label: string; tone: "navy" | "tan" };
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export function buildNav(dealId: string): NavGroup[] {
  const base = `/deals/${dealId}`;
  return [
    {
      label: "Diligence",
      items: [
        {
          href: `${base}/diligence`,
          label: "Due Diligence",
          icon: ClipboardList,
        },
        // ASK 4. The library used to be a section at the BOTTOM of the diligence
        // page — below the checklist, the deadlines and the financier packets —
        // so it was reachable only by scrolling past everything and could not be
        // linked to. It is a place people go directly, so it gets a route.
        //
        // The rail deliberately stays a SHORT fixed list. The live session's own
        // recommendation was Overview / Checklist / Documents, and entity or
        // packet structure belongs inside a page as filters and groups, never as
        // more rail entries.
        {
          href: `${base}/documents`,
          label: "Documents",
          icon: FolderOpen,
        },
      ],
    },
  ];
}

export interface NavMatch {
  group: NavGroup;
  item: NavItem;
}

// Same matching logic the sidebar uses for active-link highlighting: exact
// match or prefix with trailing slash. Returns the first match (nav items
// don't nest, so order within a group only matters if two share a prefix).
export function findActiveNav(
  pathname: string,
  dealId: string
): NavMatch | null {
  const groups = buildNav(dealId);
  for (const group of groups) {
    for (const item of group.items) {
      if (pathname === item.href || pathname.startsWith(item.href + "/")) {
        return { group, item };
      }
    }
  }
  return null;
}
