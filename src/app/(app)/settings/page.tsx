import { redirect } from "next/navigation";

/**
 * Phase 5 — Settings hub. Currently has only one section so we redirect
 * straight to it. When more sections appear (Reporting Templates, Vendor
 * Master, etc.) this can become a landing card grid.
 */
export default function SettingsPage() {
  redirect("/settings/diligence-templates");
}
