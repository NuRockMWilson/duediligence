"use server";

import { revalidatePath } from "next/cache";
import {
  setProRataDiagnosticMode,
  type ProRataDiagnosticMode,
} from "@/lib/data/admin-settings";
import { requireOrgAdmin } from "@/lib/auth/access";

export async function saveProRataDiagnosticMode(
  mode: ProRataDiagnosticMode
): Promise<{ error: string | undefined }> {
  // ORG ADMIN, not "edit". This flips a platform-wide diagnostic mode that
  // changes draw SUBMIT logic on every deal, and it lives on /settings/admin -
  // a page whose own gate is org-admin. The action must not be weaker than the
  // page that hosts it, or the page gate is decoration.
  await requireOrgAdmin();
  const result = await setProRataDiagnosticMode(mode);
  if (result.error) return result;
  revalidatePath("/settings/admin");
  // Invalidate every active-draw page since the diagnostic mode affects submit logic
  revalidatePath("/deals", "layout");
  return { error: undefined };
}
