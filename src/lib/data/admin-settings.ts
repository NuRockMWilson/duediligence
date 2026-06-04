import { createClient } from "@/lib/supabase/server";

// ============================================================================
// Admin Settings (org-wide key-value)
// ----------------------------------------------------------------------------
// Backs dm_app_settings. Each key holds a JSONB value plus a description.
// Currently used by: pro-rata diagnostic mode.
//
// dm_app_settings is new in migration 0034 — until Database types are
// regenerated to include it, queries go through an untyped escape hatch.
// ============================================================================

// Untyped client cast — Database types don't yet include dm_app_settings.
// Regenerate types after migration 0034 lands to remove this.
type UntypedSupabase = {
  from: (table: string) => {
    select: (cols: string) => Promise<{
      data: unknown;
      error: { message: string } | null;
    }>;
    upsert: (
      payload: object,
      options?: { onConflict?: string }
    ) => Promise<{
      data: unknown;
      error: { message: string } | null;
    }>;
  };
};

export type ProRataDiagnosticMode = "soft_warn" | "hard_block";

export interface AdminSettings {
  proRataDiagnosticMode: ProRataDiagnosticMode;
}

const DEFAULT_SETTINGS: AdminSettings = {
  proRataDiagnosticMode: "soft_warn",
};

/**
 * Fetch all admin settings, falling back to defaults for any missing keys.
 * Never throws — returns defaults on error so the UI always renders.
 */
export async function getAdminSettings(): Promise<AdminSettings> {
  const supabase = (await createClient()) as unknown as UntypedSupabase;
  const { data, error } = await supabase
    .from("dm_app_settings")
    .select("key, value");

  if (error) {
    console.error("[admin-settings] fetch:", error);
    return DEFAULT_SETTINGS;
  }

  const rows = (data ?? []) as Array<{ key: string; value: unknown }>;
  const byKey = new Map<string, unknown>();
  for (const row of rows) {
    byKey.set(row.key, row.value);
  }

  const proRataDiagnosticMode = parseProRataDiagnosticMode(
    byKey.get("pro_rata_diagnostic_mode")
  );

  return {
    proRataDiagnosticMode,
  };
}

function parseProRataDiagnosticMode(raw: unknown): ProRataDiagnosticMode {
  if (raw === "soft_warn" || raw === "hard_block") return raw;
  // jsonb might wrap it in quotes — also handle that
  if (typeof raw === "string") {
    const trimmed = raw.replace(/^"|"$/g, "");
    if (trimmed === "soft_warn" || trimmed === "hard_block") return trimmed;
  }
  return DEFAULT_SETTINGS.proRataDiagnosticMode;
}

/**
 * Set the pro-rata diagnostic mode.
 *
 * Returns a single-shape `{ error: string | undefined }` so callers don't
 * have to narrow a discriminated union.
 */
export async function setProRataDiagnosticMode(
  mode: ProRataDiagnosticMode
): Promise<{ error: string | undefined }> {
  const supabase = (await createClient()) as unknown as UntypedSupabase;
  const { error } = await supabase.from("dm_app_settings").upsert(
    {
      key: "pro_rata_diagnostic_mode",
      value: mode,
      description:
        "How draw submit handles deviation from pro-rata target. soft_warn = show warning but allow; hard_block = require re-apply or explicit override.",
    },
    { onConflict: "key" }
  );
  if (error) {
    console.error("[admin-settings] update:", error);
    return { error: error.message };
  }
  return { error: undefined };
}
