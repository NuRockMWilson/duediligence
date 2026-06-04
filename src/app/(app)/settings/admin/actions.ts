"use server";

import { revalidatePath } from "next/cache";
import {
  setProRataDiagnosticMode,
  type ProRataDiagnosticMode,
} from "@/lib/data/admin-settings";

export async function saveProRataDiagnosticMode(
  mode: ProRataDiagnosticMode
): Promise<{ error: string | undefined }> {
  const result = await setProRataDiagnosticMode(mode);
  if (result.error) return result;
  revalidatePath("/settings/admin");
  // Invalidate every active-draw page since the diagnostic mode affects submit logic
  revalidatePath("/deals", "layout");
  return { error: undefined };
}
