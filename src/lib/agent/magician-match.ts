// Scans free-form chat text for mentions of magicians already collected from
// Who's Who in Magic. Mirrors magic-term-match.ts's approach (plain
// whole-word substring matching, not semantic search -- see that file for
// why semantic search doesn't fit a per-message scan against thousands of
// candidates), but adapted for names: the dictionary stores headwords as
// "Lastname, Firstname" (its own indexing convention), while a chat message
// almost always says the natural "Firstname Lastname" order instead, so each
// record needs its natural-order form derived before matching.

export type MagicianRecord = {
  name: string;
  bio: string;
};

export type MagicianMatch = {
  name: string;
  bio: string;
};

// Same idea as magic-term-match.ts's MIN_SINGLE_WORD_LENGTH, but a lower
// floor: most single-word stage names in this dictionary are invented or
// foreign proper nouns (Cardini, Kellar, Dante, Slydini), not ordinary
// English words, so they carry much less false-hit risk than a short term
// headword does even at this length. A handful of single-word entries are
// still risky common words/names ("Victor", "Fox") -- accepted as a known
// limitation, same as magic-term-match.ts's "reading"/"conjuring" caveat.
// Multi-word names ("Harry Houdini") are always exempt from this floor.
const MIN_SINGLE_WORD_LENGTH = 5;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Strip bracketed alternate-spelling/optional-part notes and quote marks
 * that the dictionary embeds in headwords, e.g. `David P [helps] "Dave"` ->
 * `David P Dave`, `Ian [Hugh]` -> `Ian`. Not meant to be a display string,
 * only a matchable candidate. */
function stripAnnotations(value: string) {
  return value
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/["“”]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const GENERATIONAL_SUFFIX_RE = /\b(?:Jr|Sr|II|III|IV)\.?$/i;

/** Build the natural "Firstname [Middle] Lastname" reading order from a
 * dictionary headword, plus the original form, as candidate strings to
 * search for. Returns [] if nothing usable remains after cleanup (e.g. a
 * headword that was pure punctuation once stripped).
 *
 * Also adds a colloquial "... Sr" variant when the name has no generational
 * suffix of its own: this dictionary distinguishes a father/son pair by
 * marking only the son ("Blackstone Jr, Harry"), leaving the father as a
 * plain "Blackstone, Harry" -- but people (and models) commonly refer to the
 * father as "Harry Blackstone Sr." once a same-named son is known, and that
 * phrase would otherwise never match. */
export function nameVariants(rawName: string): string[] {
  const variants = new Set<string>();
  const cleanedOriginal = stripAnnotations(rawName);
  if (cleanedOriginal) variants.add(cleanedOriginal);

  const commaIndex = rawName.indexOf(",");
  if (commaIndex > 0) {
    const last = stripAnnotations(rawName.slice(0, commaIndex));
    const rest = stripAnnotations(rawName.slice(commaIndex + 1));
    if (last && rest) {
      const natural = `${rest} ${last}`.replace(/\s+/g, " ").trim();
      variants.add(natural);
      if (natural && !GENERATIONAL_SUFFIX_RE.test(natural)) {
        variants.add(`${natural} Sr`);
      }
    }
  }

  return [...variants].filter(Boolean);
}

function candidateVariants(name: string): string[] {
  return nameVariants(name).filter(
    (variant) => variant.includes(" ") || variant.length >= MIN_SINGLE_WORD_LENGTH
  );
}

export function findMagicianMentions(
  text: string,
  records: MagicianRecord[],
  maxMatches = 2
): MagicianMatch[] {
  const haystack = text.trim();
  if (!haystack) return [];

  const scored: Array<MagicianMatch & { matchedLength: number }> = [];

  for (const record of records) {
    let matchedLength = 0;
    for (const variant of candidateVariants(record.name)) {
      const pattern = new RegExp(`\\b${escapeRegExp(variant)}\\b`, "i");
      if (pattern.test(haystack)) {
        matchedLength = Math.max(matchedLength, variant.length);
      }
    }
    if (matchedLength > 0) {
      scored.push({ name: record.name, bio: record.bio, matchedLength });
    }
  }

  return scored
    .sort((a, b) => b.matchedLength - a.matchedLength)
    .slice(0, maxMatches)
    .map(({ name, bio }) => ({ name, bio }));
}
