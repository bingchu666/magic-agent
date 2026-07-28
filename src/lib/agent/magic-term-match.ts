export type MagicTermRecord = {
  term: string;
  definition: string;
};

export type MagicTermMatch = {
  term: string;
  definition: string;
};

// Single-word dictionary headwords below this length are almost always
// plain English words too ("bit", "key", "out", "tip") and would false-hit
// on unrelated chat messages. Multi-word phrases ("story magic", "false
// shuffle") are far less likely to appear by coincidence, so they're exempt.
// This is a heuristic, not a precise filter — even above this floor, a few
// headwords (e.g. "reading", "conjuring") double as common English words
// and can still fire on unrelated text. Tune based on real usage.
const MIN_SINGLE_WORD_LENGTH = 8;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function candidateVariants(term: string): string[] {
  return term
    .split(";")
    .map((variant) => variant.trim())
    .filter((variant) => variant.length > 0)
    .filter((variant) => variant.includes(" ") || variant.length >= MIN_SINGLE_WORD_LENGTH);
}

/**
 * Scans free-form chat text for whole-word, case-insensitive mentions of any
 * magic_terms headword. Deliberately plain substring/word-boundary matching,
 * not semantic search: semantic similarity fits a single candidate phrase
 * (see findSimilarMagicTerm), not scanning one message against ~2500
 * possible terms on every chat turn.
 */
export function findMagicTermMentions(
  text: string,
  records: MagicTermRecord[],
  maxMatches = 3
): MagicTermMatch[] {
  const haystack = text.trim();
  if (!haystack) return [];

  const scored: Array<MagicTermMatch & { matchedLength: number }> = [];

  for (const record of records) {
    let matchedLength = 0;
    for (const variant of candidateVariants(record.term)) {
      const pattern = new RegExp(`\\b${escapeRegExp(variant)}\\b`, "i");
      if (pattern.test(haystack)) {
        matchedLength = Math.max(matchedLength, variant.length);
      }
    }
    if (matchedLength > 0) {
      scored.push({ term: record.term, definition: record.definition, matchedLength });
    }
  }

  return scored
    .sort((a, b) => b.matchedLength - a.matchedLength)
    .slice(0, maxMatches)
    .map(({ term, definition }) => ({ term, definition }));
}
