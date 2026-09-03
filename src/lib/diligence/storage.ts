// =============================================================================
// Diligence document storage — provider abstraction.
// =============================================================================
// The chosen storage target is SharePoint/OneDrive, but it needs an app
// registration (a queued external input). So we ship behind a provider
// interface: today the SUPABASE provider persists files to the private
// `diligence-attachments` bucket (same pattern as invoices/lien-waivers); when
// the SharePoint app registration lands, a SharePointProvider implements the
// same interface and `getStorageProvider()` flips — call sites don't change.
//
// The auto-rename convention (display name) is provider-agnostic: it's what the
// file is shown as in-app and what the eventual SharePoint filename will be.
// The on-disk storage KEY stays UUID-safe to avoid path collisions when the
// same item holds several files or two files share a human name.
// =============================================================================

import { createClient } from "@/lib/supabase/server";

export const DILIGENCE_BUCKET = "diligence-attachments";

/**
 * Path segment used in place of a deal-item id for a document uploaded to the
 * deal's library WITHOUT being attached to a checklist item (ASK 3).
 *
 * WHY A SENTINEL RATHER THAN A TWO-SEGMENT KEY. The storage policies in
 * 20260831_diligence_storage_policies.sql authorize on
 * `dm_user_has_access((storage.foldername(name))[1])` — the FIRST segment, the
 * deal id, and nothing else. So segment 2 is free, and keeping the key shape at
 * exactly three segments means an unfiled upload lands inside the same
 * deal-scoped access check as every other file, with no policy change at all. A
 * shorter key would still be authorized, but it would make `foldername()[1]`
 * mean two different things depending on the file, which is how a storage policy
 * quietly stops matching.
 *
 * The leading underscore keeps it un-collidable with a uuid.
 */
export const UNFILED_SEGMENT = "_unfiled";

export interface UploadArgs {
  dealId: string;
  /** A deal-item id, or UNFILED_SEGMENT for a library-only upload. */
  dealItemId: string;
  file: File;
}

export interface UploadResult {
  filePath: string; // storage key
  byteSize: number;
  mimeType: string;
}

export interface DiligenceStorageProvider {
  readonly kind: "supabase" | "sharepoint";
  upload(args: UploadArgs): Promise<UploadResult>;
  remove(filePath: string): Promise<void>;
  signedUrl(filePath: string, expiresInSeconds?: number): Promise<string>;
}

// -----------------------------------------------------------------------------
// Naming helpers
// -----------------------------------------------------------------------------

/** Lowercase file extension incl. dot ("report.PDF" → ".pdf"); "" if none. */
export function fileExtension(filename: string): string {
  const i = filename.lastIndexOf(".");
  if (i <= 0 || i === filename.length - 1) return "";
  return filename.slice(i).toLowerCase();
}

/** Strip characters that are unsafe in SharePoint / Windows filenames. */
function sanitize(part: string): string {
  return part
    .replace(/[\\/:*?"<>|#%]/g, " ") // illegal in SharePoint / Win
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Human display name applied when a file is assigned to a checklist item:
 *   "{Deal} - {Item#} {Item Title} - {YYYY-MM-DD}.ext"
 * e.g. "Foxcroft Apartments - 1200 Construction Contract (AIA) - 2026-06-04.pdf"
 * This is the in-app label and the eventual SharePoint filename.
 */
export function buildDisplayName(opts: {
  dealName: string;
  itemNumber: number | null;
  itemTitle: string;
  originalFilename: string;
  /** ISO yyyy-mm-dd; pass from the caller so the function stays deterministic. */
  dateIso: string;
}): string {
  const ext = fileExtension(opts.originalFilename);
  const num = opts.itemNumber != null ? `${opts.itemNumber} ` : "";
  const base = sanitize(
    `${opts.dealName} - ${num}${opts.itemTitle} - ${opts.dateIso}`
  );
  return `${base}${ext}`;
}

/**
 * Display name for a document uploaded to the library with NO checklist item
 * (ASK 3): "{Deal} - {original base} - {YYYY-MM-DD}.ext".
 *
 * DELIBERATELY NOT buildDisplayName WITH A BLANK ITEM. That function's format
 * is "{Deal} - {Item#} {Item Title} - {date}", and feeding it an empty title
 * produces a name that LOOKS like an item-assigned document with a missing
 * item — the reader cannot tell "unfiled" from "filed under something blank".
 * This keeps the deal and the date (both true) and carries the uploader's own
 * filename instead of implying a checklist position the file does not have.
 *
 * Linking the document to an item later does not rename it. That is intentional:
 * the file already exists under this key and this label in storage and, once
 * the SharePoint provider is live, in SharePoint — renaming on link would mean a
 * move, and a move that fails leaves the row pointing at a path that is gone.
 */
export function buildUnfiledDisplayName(opts: {
  dealName: string;
  originalFilename: string;
  /** ISO yyyy-mm-dd; pass from the caller so the function stays deterministic. */
  dateIso: string;
}): string {
  const ext = fileExtension(opts.originalFilename);
  const base = opts.originalFilename.slice(
    0,
    opts.originalFilename.length - ext.length
  );
  return `${sanitize(`${opts.dealName} - ${base} - ${opts.dateIso}`)}${ext}`;
}

/** Collision-safe storage key: {dealId}/{dealItemId}/{uuid}{ext}. */
export function buildStorageKey(
  dealId: string,
  dealItemId: string,
  originalFilename: string
): string {
  const ext = fileExtension(originalFilename);
  return `${dealId}/${dealItemId}/${crypto.randomUUID()}${ext}`;
}

// -----------------------------------------------------------------------------
// Supabase provider (active default)
// -----------------------------------------------------------------------------

class SupabaseDiligenceStorage implements DiligenceStorageProvider {
  readonly kind = "supabase" as const;

  async upload({ dealId, dealItemId, file }: UploadArgs): Promise<UploadResult> {
    const supabase = await createClient();
    const filePath = buildStorageKey(dealId, dealItemId, file.name);
    const mimeType = file.type || "application/octet-stream";
    const { error } = await supabase.storage
      .from(DILIGENCE_BUCKET)
      .upload(filePath, file, { upsert: false, contentType: mimeType });
    if (error) throw error;
    return { filePath, byteSize: file.size, mimeType };
  }

  async remove(filePath: string): Promise<void> {
    const supabase = await createClient();
    const { error } = await supabase.storage
      .from(DILIGENCE_BUCKET)
      .remove([filePath]);
    if (error) throw error;
  }

  async signedUrl(filePath: string, expiresInSeconds = 3600): Promise<string> {
    const supabase = await createClient();
    const { data, error } = await supabase.storage
      .from(DILIGENCE_BUCKET)
      .createSignedUrl(filePath, expiresInSeconds);
    if (error) throw error;
    if (!data?.signedUrl) throw new Error("Signed URL could not be generated");
    return data.signedUrl;
  }
}

const supabaseProvider = new SupabaseDiligenceStorage();

// -----------------------------------------------------------------------------
// SharePoint / OneDrive provider (Microsoft Graph) — env-gated.
// -----------------------------------------------------------------------------
// Activated when SHAREPOINT_TENANT_ID + _CLIENT_ID + _CLIENT_SECRET + _SITE_ID
// are set (the app registration the roadmap calls out as a pending input).
// Uses Graph client-credentials; no SDK (keeps the bundle slim). Files land at
// `{ROOT}/{dealId}/{dealItemId}/{uuid}{ext}` in the site's default drive.
//
// NOTE: this is the wiring; it requires a real app registration with
// Sites.ReadWrite.All (application) consent to function. Until those envs are
// present, getStorageProvider() returns the Supabase provider.
// -----------------------------------------------------------------------------
interface SharePointEnv {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  siteId: string;
  driveId?: string;
  rootFolder: string;
}

function readSharePointEnv(): SharePointEnv | null {
  const tenantId = process.env.SHAREPOINT_TENANT_ID;
  const clientId = process.env.SHAREPOINT_CLIENT_ID;
  const clientSecret = process.env.SHAREPOINT_CLIENT_SECRET;
  const siteId = process.env.SHAREPOINT_SITE_ID;
  if (!tenantId || !clientId || !clientSecret || !siteId) return null;
  return {
    tenantId,
    clientId,
    clientSecret,
    siteId,
    driveId: process.env.SHAREPOINT_DRIVE_ID,
    rootFolder: process.env.SHAREPOINT_ROOT_FOLDER || "Diligence",
  };
}

class SharePointDiligenceStorage implements DiligenceStorageProvider {
  readonly kind = "sharepoint" as const;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(private env: SharePointEnv) {}

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) {
      return this.token.value;
    }
    const body = new URLSearchParams({
      client_id: this.env.clientId,
      client_secret: this.env.clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    });
    const res = await fetch(
      `https://login.microsoftonline.com/${this.env.tenantId}/oauth2/v2.0/token`,
      { method: "POST", body }
    );
    if (!res.ok) throw new Error(`SharePoint auth failed (${res.status})`);
    const json = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };
    this.token = {
      value: json.access_token,
      expiresAt: Date.now() + json.expires_in * 1000,
    };
    return json.access_token;
  }

  private driveBase(): string {
    return this.env.driveId
      ? `https://graph.microsoft.com/v1.0/drives/${this.env.driveId}`
      : `https://graph.microsoft.com/v1.0/sites/${this.env.siteId}/drive`;
  }

  async upload({ dealId, dealItemId, file }: UploadArgs): Promise<UploadResult> {
    const token = await this.accessToken();
    const filePath = `${this.env.rootFolder}/${buildStorageKey(dealId, dealItemId, file.name)}`;
    const mimeType = file.type || "application/octet-stream";
    const bytes = new Uint8Array(await file.arrayBuffer());
    // Simple upload (<250MB). Larger files would use an upload session.
    const res = await fetch(
      `${this.driveBase()}/root:/${encodeURI(filePath)}:/content`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": mimeType,
        },
        body: bytes,
      }
    );
    if (!res.ok) throw new Error(`SharePoint upload failed (${res.status})`);
    return { filePath, byteSize: file.size, mimeType };
  }

  async remove(filePath: string): Promise<void> {
    const token = await this.accessToken();
    const res = await fetch(
      `${this.driveBase()}/root:/${encodeURI(filePath)}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok && res.status !== 404) {
      throw new Error(`SharePoint delete failed (${res.status})`);
    }
  }

  async signedUrl(filePath: string): Promise<string> {
    const token = await this.accessToken();
    // The driveItem carries a short-lived pre-authenticated download URL.
    const res = await fetch(
      `${this.driveBase()}/root:/${encodeURI(filePath)}?select=@microsoft.graph.downloadUrl`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) throw new Error(`SharePoint link failed (${res.status})`);
    const json = (await res.json()) as Record<string, string>;
    const url = json["@microsoft.graph.downloadUrl"];
    if (!url) throw new Error("SharePoint returned no download URL");
    return url;
  }
}

let sharePointProvider: SharePointDiligenceStorage | null | undefined;

/**
 * Returns the active storage provider. Uses SharePoint when its app
 * registration env is configured; otherwise the Supabase provider. Call sites
 * don't change — the abstraction lets the platform flip storage backends.
 */
export function getStorageProvider(): DiligenceStorageProvider {
  if (sharePointProvider === undefined) {
    const env = readSharePointEnv();
    sharePointProvider = env ? new SharePointDiligenceStorage(env) : null;
  }
  return sharePointProvider ?? supabaseProvider;
}
