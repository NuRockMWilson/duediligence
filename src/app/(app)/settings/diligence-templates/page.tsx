import {
  getDiligenceTemplates,
  getCanonicalItems,
} from "@/lib/data/diligence-templates";
import { TemplatesAdmin } from "./_components/templates-admin";

// ============================================================================
// /settings/diligence-templates — org-level DD template catalog (Increment 2)
// ----------------------------------------------------------------------------
// The canonical NuRock checklist plus imported investor/lender/underwriter
// checklists, and the crosswalk that maps external items to canonical ones.
// ============================================================================

export const dynamic = "force-dynamic";

export default async function DiligenceTemplatesPage() {
  const [templates, canonicalItems] = await Promise.all([
    getDiligenceTemplates(),
    getCanonicalItems(),
  ]);

  return (
    <div className="px-8 py-6 max-w-[1400px] mx-auto space-y-6">
      <TemplatesAdmin templates={templates} canonicalItems={canonicalItems} />
    </div>
  );
}
