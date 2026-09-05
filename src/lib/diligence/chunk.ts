// =============================================================================
// Chunked `.in(...)` — because a packet is now hundreds of items, not twenty
// =============================================================================
// supabase-js puts an `.in()` list in the QUERY STRING of a GET. Every id costs
// ~37 characters, so 242 template items is roughly a 9KB URL before the base
// path and the other parameters — at or past the ~8KB cap that proxies and
// servers commonly enforce, where the failure is a 414 rather than a slow
// request.
//
// This was harmless for as long as the only packets in the system were 19-item
// checklists. Round 57 adopted a 242-item packet producing 274 tracked rows,
// which puts three separate call sites over the line at once.
//
// WORSE THAN FAILING: several of those sites discard the error. A read whose
// error is dropped returns `data: null`, which reads as "no rows", which reads
// as "nothing to do" — so an unadopt that could not query would report success
// and leave every row behind. The chunking below is only half the fix; the
// callers have to check errors too, and now do.
// =============================================================================

/** Ids per request. 100 x ~37 chars keeps the URL near 4KB, well under any cap. */
export const IN_CHUNK = 100;

export function chunk<T>(items: T[], size = IN_CHUNK): T[][] {
  if (items.length === 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Run `fn` over each chunk and concatenate the rows, stopping at the FIRST
 * error and surfacing it.
 *
 * Stopping rather than continuing is deliberate: a partial result here is
 * indistinguishable from a complete one at the call site, and that is exactly
 * how a half-finished cleanup would look like a finished one.
 */
export async function selectInChunks<TRow, TId>(
  ids: TId[],
  fn: (batch: TId[]) => Promise<{ data: TRow[] | null; error: { message: string } | null }>
): Promise<{ rows: TRow[]; error: string | null }> {
  const rows: TRow[] = [];
  for (const batch of chunk(ids)) {
    const { data, error } = await fn(batch);
    if (error) return { rows, error: error.message };
    if (data) rows.push(...data);
  }
  return { rows, error: null };
}
