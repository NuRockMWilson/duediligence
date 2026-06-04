import { getDiligenceChecklist } from "@/lib/data/diligence";
import { getDiligenceFinancierCoverage } from "@/lib/data/diligence-rollup";
import { getDiligenceDeadlines } from "@/lib/data/diligence-deadlines";
import { getAdoptableTemplates } from "@/lib/data/diligence-templates";
import {
  getCurrentUserAccess,
  hasPermission,
  isRbacInitialized,
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

  return (
    <DiligenceShell
      checklist={checklist}
      financiers={financiers}
      deadlines={deadlines}
      availableTemplates={adoptable.available}
      canEdit={canEdit}
      canApprove={canApprove}
    />
  );
}
