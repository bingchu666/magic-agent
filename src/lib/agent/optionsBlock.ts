export type QuickOptionsBlock = {
  question: string;
  options: string[];
};

export type ExtractedQuickOptions = {
  cleanedContent: string;
  quickOptions: QuickOptionsBlock | null;
};

// Matches a fenced ```options ... ``` block. Anchored to the literal "options"
// info-string so unrelated code fences (e.g. a trick's script) are never touched.
const OPTIONS_BLOCK_PATTERN = /```options[ \t]*\r?\n([\s\S]*?)```/;

const MIN_OPTIONS = 2;

/**
 * Pulls the model's optional ```options fenced block out of an assistant
 * message so it can be rendered as clickable buttons instead of raw JSON.
 *
 * Any failure (missing block, invalid JSON, wrong shape) is treated as "no
 * quick options" rather than an error — the caller should fall back to
 * displaying `content` unchanged.
 */
export function extractQuickOptions(content: string): ExtractedQuickOptions {
  const match = content.match(OPTIONS_BLOCK_PATTERN);
  if (!match) {
    return { cleanedContent: content, quickOptions: null };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1].trim());
  } catch {
    return { cleanedContent: content, quickOptions: null };
  }

  const quickOptions = normalizeQuickOptions(parsed);
  if (!quickOptions) {
    return { cleanedContent: content, quickOptions: null };
  }

  const cleanedContent = content.replace(match[0], "").trim();
  return { cleanedContent, quickOptions };
}

function normalizeQuickOptions(value: unknown): QuickOptionsBlock | null {
  if (!value || typeof value !== "object") return null;

  const question = (value as Record<string, unknown>).question;
  const options = (value as Record<string, unknown>).options;
  if (typeof question !== "string" || !question.trim()) return null;
  if (!Array.isArray(options)) return null;

  const cleanOptions = options
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);

  if (cleanOptions.length < MIN_OPTIONS) return null;

  return { question: question.trim(), options: cleanOptions };
}
