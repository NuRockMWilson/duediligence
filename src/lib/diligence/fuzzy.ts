// =============================================================================
// Crosswalk suggestion — deterministic fuzzy title matching.
// =============================================================================
// When mapping an imported lender/investor checklist item to the NuRock
// standard items, we suggest the most likely canonical matches by token
// overlap (Jaccard + significant-token boost). No external dependency and no
// API key — runs instantly client- or server-side.
//
// AI HOOK: swap suggestCanonicalMatches() for a Claude-API-backed matcher later
// (the call sites only need {id, score}[]). The fuzzy ranker is a solid default
// and a fallback when no key is configured.
// =============================================================================

const STOPWORDS = new Set([
  "the", "of", "and", "a", "an", "for", "to", "or", "in", "on", "with",
  "agreement", "letter", "report", "document", "documents", "copy", "copies",
  "current", "final", "executed", "signed", "form", "schedule", "statement",
  "statements", "certificate", "certification", "policy", "study", "if",
  "required", "applicable", "per", "each", "all", "any",
]);

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

export interface MatchCandidate {
  id: string;
  title: string;
}

export interface MatchSuggestion {
  id: string;
  score: number; // 0..1
}

/**
 * Rank canonical candidates against an external item title. Returns up to topN
 * suggestions scoring above `minScore`, best first.
 */
export function suggestCanonicalMatches(
  externalTitle: string,
  candidates: MatchCandidate[],
  topN = 3,
  minScore = 0.18
): MatchSuggestion[] {
  const a = new Set(tokens(externalTitle));
  if (a.size === 0) return [];

  const scored = candidates.map((c) => {
    const b = new Set(tokens(c.title));
    if (b.size === 0) return { id: c.id, score: 0 };
    let shared = 0;
    for (const t of a) if (b.has(t)) shared++;
    const union = a.size + b.size - shared;
    const jaccard = union === 0 ? 0 : shared / union;
    // Boost when a large fraction of the SHORTER set is shared (handles
    // "Phase I ESA" ↔ "Phase I Environmental Site Assessment").
    const containment = shared / Math.min(a.size, b.size);
    return { id: c.id, score: 0.5 * jaccard + 0.5 * containment };
  });

  return scored
    .filter((s) => s.score >= minScore)
    .sort((x, y) => y.score - x.score)
    .slice(0, topN);
}
