// =============================================================================
// settings-nav — single source of truth for the Settings information architecture
// =============================================================================
// Consumed by BOTH:
//   - the Settings sidebar  (src/app/(app)/settings/layout.tsx), and
//   - the top-bar account-menu dropdown (src/components/account-menu.tsx).
//
// Add, remove, or rename a settings section HERE and both surfaces update
// together. That is the contract: the account dropdown must always mirror the
// sections of the settings page, so they can never drift apart.
//
// Diligence owns only three settings routes locally: Diligence Templates, Users
// & Access (/settings/team), and Admin (/settings/admin). The org-wide cost +
// reporting configuration (Report Formats, GL mappings, Vendors) physically
// lives in the Development app, so those entries are CROSS-APP links to
// devmgmt's /settings/* — keeping the unified "one platform" settings menu
// while pointing each link at the app that actually hosts the page (no 404s).
//
// Plain module (no "use client"): it only holds strings + lucide icon
// component references, so it folds cleanly into the client bundle of whichever
// client component imports it (Next 16 server/client component rules).
// =============================================================================

import type { ComponentType } from "react";
import {
  Calendar,
  ArrowRightLeft,
  Network,
  Building2,
  ClipboardList,
  Users,
  Shield,
} from "lucide-react";

// Development app base — where the org-wide config sections live. Override via
// NEXT_PUBLIC_DEVMGMT_URL on Vercel.
const DEVMGMT_BASE =
  process.env.NEXT_PUBLIC_DEVMGMT_URL ?? "https://nurock-devmgmt.vercel.app";

export interface SettingsNavItem {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  badge?: { label: string; tone: "navy" | "tan" };
  /** True when href points to another app (devmgmt) rather than a local route. */
  external?: boolean;
  /**
   * Administration sections are surfaced in the account-menu dropdown only to
   * org admins (the settings sidebar still lists them for everyone; the pages
   * themselves enforce access). Keeps a non-admin's account menu uncluttered.
   */
  adminOnly?: boolean;
}

export interface SettingsNavGroup {
  label: string;
  items: SettingsNavItem[];
}

export const SETTINGS_NAV: SettingsNavGroup[] = [
  {
    label: "Configuration",
    items: [
      {
        href: `${DEVMGMT_BASE}/settings/standard-schedule`,
        label: "Report Formats",
        icon: Calendar,
        external: true,
      },
      {
        href: `${DEVMGMT_BASE}/settings/mappings/underwriting-lines`,
        label: "Underwriting Line → GL",
        icon: ArrowRightLeft,
        external: true,
      },
      {
        href: `${DEVMGMT_BASE}/settings/mappings/gl-to-standard`,
        label: "Chart of Accounts & Groupings",
        icon: Network,
        external: true,
      },
      {
        href: `${DEVMGMT_BASE}/settings/vendors`,
        label: "Vendors & Subs",
        icon: Building2,
        external: true,
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
        adminOnly: true,
      },
      {
        href: "/settings/admin",
        label: "Admin",
        icon: Shield,
        adminOnly: true,
      },
    ],
  },
];
