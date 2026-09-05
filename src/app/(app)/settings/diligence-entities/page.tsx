import { getEntityCatalog } from "@/lib/data/diligence-entities";
import { canDiligence } from "@/lib/auth/access";
import { EntitiesAdmin } from "./_components/entities-admin";

// ============================================================================
// /settings/diligence-entities — the org-level catalog of named parties
// ============================================================================
// GP entities, developers, guarantors, loans: the parties typed into a deal's
// org chart, shared across every deal so the same three guarantors are not
// retyped each time.
//
// force-dynamic: usage counts come from live deal data, and a cached page would
// offer to delete a party that has since been named on a deal — which the
// database would then refuse.
// ============================================================================

export const dynamic = "force-dynamic";

export default async function DiligenceEntitiesPage() {
  const [{ roles, entities }, canEdit] = await Promise.all([
    getEntityCatalog(),
    canDiligence("edit"),
  ]);

  return (
    <div className="px-8 py-6 max-w-[1100px] space-y-6">
      <div>
        <h1 className="font-display text-2xl text-nurock-black">
          Diligence Parties
        </h1>
        <p className="text-xs text-nurock-slate-light mt-1">
          The GP entities, developers, guarantors and financing sources named in
          deal org charts. Shared across every deal, so the same party is
          entered once and reused.
        </p>
      </div>
      <EntitiesAdmin roles={roles} entities={entities} canEdit={canEdit} />
    </div>
  );
}
