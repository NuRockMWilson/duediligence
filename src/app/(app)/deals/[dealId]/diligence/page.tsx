import { getDiligenceChecklist } from "@/lib/data/diligence";
import { getDiligenceFinancierCoverage } from "@/lib/data/diligence-rollup";
import { getDiligenceDeadlines } from "@/lib/data/diligence-deadlines";
import { getAdoptableTemplates } from "@/lib/data/diligence-templates";
import {
  getCurrentUserAccess,
  hasPermission,
  isRbacInitialized,
  canDiligence,
} from "@/lib/auth/access";
import { DiligenceShell } from "./_components/diligence-shell";

// ============================================================================
// /deals/[dealId]/diligence — Due-diligence checklist (Increment 1)
// ----------------------------------------------------------------------------
// Server component: ensures + fetches the canonical checklist, resolves the
// current user's edit/approve permissions (bootstrap-safe — when RBAC has no
// role assignments yet, everything is permitted so the feature isn't locked),
// and hands it all to the client shell.
// ============================================================================

export default async function DiligencePage({
  params,
}: {
  params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await params;

  const [checklist, financiers, deadlines, adoptable, access, rbacOn] =
    await Promise.all([
      getDiligenceChecklist(dealId),
      getDiligenceFinancierCoverage(dealId),
      getDiligenceDeadlines(dealId),
      getAdoptableTemplates(dealId),
      getCurrentUserAccess(),
      isRbacInitialized(),
    ]);

  const canEdit =
    !rbacOn ||
    (access?.isOrgAdmin ?? false) ||
    hasPermission(access, "devmgmt", "edit");
  const canApprove =
    !rbacOn ||
    (access?.isOrgAdmin ?? false) ||
    hasPermission(access, "devmgmt", "approve");
  // ---------------------------------------------------------------------------
  // EXPORT, AND THE BUTTON THAT NEVER ASKED
  // ---------------------------------------------------------------------------
  // Round 63, as a contributor: "Export PDF" was refused by its server action
  // ("Your role doesn't allow exporting from Due Diligence") while "Export CSV"
  // beside it produced a 59-row file. The CSV path is built entirely in the
  // browser from rows already rendered, so it never consults a permission.
  //
  // BE HONEST ABOUT WHAT GATING IT ACHIEVES. The rows are already in that
  // user's browser — they were delivered to draw the table — so hiding the
  // button is not a confidentiality barrier and anyone determined can still
  // copy what is on screen. What it does buy is that the two adjacent controls
  // labelled "Export" stop disagreeing, and that a role without export is not
  // handed a one-click way to take the whole checklist out.
  //
  // A real barrier would mean not delivering rows the viewer may not export,
  // which would break the checklist for the very people meant to work it. That
  // trade is not worth making, and pretending the UI gate is more than it is
  // would be worse than the inconsistency it replaces.
  const canExport = await canDiligence("export");

  return (
    <DiligenceShell
      checklist={checklist}
      financiers={financiers}
      deadlines={deadlines}
      availableTemplates={adoptable.available}
      canEdit={canEdit}
      canApprove={canApprove}
      canExport={canExport}
    />
  );
}
