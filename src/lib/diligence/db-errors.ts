// =============================================================================
// Database write failures, translated once.
// =============================================================================
// THE LIVE SESSION HAS NOW CAUGHT THIS TWICE, and named it the same defect class
// both times: a raw driver string surfaced straight to the end user.
//
//   2026-09-03  "permission denied for table nurock_diligence_items"
//               — a missing GRANT, on the delete path.
//   2026-09-04  "Could not find the table 'public.nurock_diligence_crosswalk'
//               in the schema cache"
//               — a missing or unexposed TABLE, on the mapping path.
//
// Both read as a crash rather than a refusal, and both name internal tables to
// whoever happens to be looking. This module exists so the third instance is
// impossible: there was already one copy of this logic in item-actions.ts and a
// second in group-actions.ts, and a third was about to be written for the
// crosswalk. Three near-identical copies of one rule is how they drift, and the
// one that drifts is always the one nobody remembers to update.
//
// ANYTHING UNRECOGNISED PASSES THROUGH UNCHANGED. Inventing friendly copy for an
// unknown fault hides the information the next investigation needs — the point
// is to translate the shapes whose cause is KNOWN, not to muffle the database.
// =============================================================================

export interface DbErrorLike {
  message?: string;
  code?: string;
}

export function describeDbError(error: DbErrorLike): string {
  const raw = error.message ?? "Unknown database error.";

  // PostgREST cannot see the table. Three causes, and the message deliberately
  // does not guess between them: the table may not exist, it may exist with a
  // stale PostgREST schema cache (wants NOTIFY pgrst, 'reload schema'), or it
  // may live in a schema that is not exposed. All three are a deployment fault,
  // none is fixed by the user retrying.
  if (/schema cache|could not find the table/i.test(raw)) {
    return (
      "This feature's database table isn't reachable, so nothing was saved. " +
      "That's a setup problem, not something a retry will fix — please report it."
    );
  }

  // RLS filters rows; a GRANT decides reachability. "permission denied for
  // table X" is ALWAYS a privilege and never a policy — a policy denial shows up
  // as zero rows and a silent no-op instead.
  if (/permission denied for table/i.test(raw)) {
    return (
      "The database refused this change — the app is missing a privilege on that " +
      "table. Nothing was changed. Please report this; it needs a grant, not a retry."
    );
  }

  if (error.code === "23505" || /duplicate key|unique constraint/i.test(raw)) {
    return "That already exists — reload and try again.";
  }

  if (error.code === "23503" || /foreign key/i.test(raw)) {
    return "Something this refers to no longer exists — reload and try again.";
  }

  return raw;
}
