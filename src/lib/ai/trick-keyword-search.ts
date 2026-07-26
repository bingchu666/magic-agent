type TrickKeywordRow = {
  id?: unknown;
  title?: unknown;
  method_summary?: unknown;
  difficulty?: unknown;
  props_needed?: unknown;
  tags?: unknown;
};

const ENGLISH_STOP_WORDS = new Set([
  "act",
  "about",
  "beginner",
  "easy",
  "do",
  "from",
  "gary",
  "help",
  "how",
  "kurtz",
  "learn",
  "magic",
  "please",
  "show",
  "teach",
  "trick",
  "unexplainable",
  "what",
  "when",
  "where",
  "which",
  "with",
]);

const DOMAIN_TERMS: Array<{ pattern: RegExp; terms: string[] }> = [
  { pattern: /(纸牌|扑克牌|牌组|选牌|card|deck)/i, terms: ["card", "deck"] },
  { pattern: /(硬币|钱币|coin)/i, terms: ["coin", "quarter", "penny"] },
  { pattern: /(戒指|ring)/i, terms: ["ring"] },
  { pattern: /(绳子|绳结|rope|string)/i, terms: ["rope", "string"] },
  { pattern: /(橡皮筋|rubber\s*band)/i, terms: ["rubber band"] },
  { pattern: /(信封|envelope)/i, terms: ["envelope"] },
  { pattern: /(铅笔|pencil)/i, terms: ["pencil"] },
  { pattern: /(杯子|杯球|cup)/i, terms: ["cup"] },
  { pattern: /(预言|prediction)/i, terms: ["prediction"] },
  { pattern: /(读心|心灵感应|mind.?read|mental)/i, terms: ["mind", "thought", "mental"] },
  { pattern: /(消失|不见|vanish|disappear)/i, terms: ["vanish", "disappear"] },
  { pattern: /(变出|出现|appear|produce)/i, terms: ["appear", "produce"] },
  { pattern: /(漂浮|悬浮|levitat|float)/i, terms: ["levitate", "float"] },
  { pattern: /(交换|互换|transpos|exchange)/i, terms: ["exchange", "transpose"] },
  { pattern: /(签名|signed|signature)/i, terms: ["signed", "signature"] },
  { pattern: /(蒙眼|blindfold)/i, terms: ["blindfold"] },
  { pattern: /(扑克|赌博|gambling|poker)/i, terms: ["gambling", "poker"] },
  { pattern: /(四张a|四个a|ace)/i, terms: ["ace"] },
  { pattern: /(橙子|橘子|orange)/i, terms: ["orange"] },
  { pattern: /(柠檬|lemon)/i, terms: ["lemon"] },
];

function normalizeTerm(term: string) {
  return term.toLowerCase().replace(/[^a-z0-9 -]/g, "").trim();
}

/** Whether the text names a concrete magic prop/effect (card, coin, vanish, ...). */
export function containsDomainKeyword(text: string): boolean {
  return DOMAIN_TERMS.some((concept) => concept.pattern.test(text));
}

export function buildTrickKeywordPlan(query: string) {
  const terms = new Set<string>();
  const lower = query.toLowerCase();

  for (const concept of DOMAIN_TERMS) {
    if (!concept.pattern.test(query)) continue;
    concept.terms.forEach((term) => terms.add(term));
  }

  for (const word of lower.match(/[a-z][a-z0-9-]{2,}/g) || []) {
    if (!ENGLISH_STOP_WORDS.has(word)) terms.add(word);
  }

  const normalizedTerms = [...terms]
    .map(normalizeTerm)
    .filter(Boolean)
    .slice(0, 10);
  const broadMagicRequest = normalizedTerms.length === 0 && /(魔术|magic|trick)/i.test(query);

  return { terms: normalizedTerms, broadMagicRequest };
}

export function rankKeywordTricks(
  rows: TrickKeywordRow[],
  terms: string[],
  matchCount: number
): Record<string, unknown>[] {
  return rows
    .map((row, index) => {
      const title = String(row.title || "");
      const content = String(row.method_summary || "").trim();
      const tags = Array.isArray(row.tags) ? row.tags.map(String) : [];
      const titleText = title.toLowerCase();
      const corpus = `${title} ${tags.join(" ")} ${content}`.toLowerCase();
      const hits = terms.filter((term) => corpus.includes(term)).length;
      const titleHits = terms.filter((term) => titleText.includes(term)).length;
      const broadScore = row.difficulty === "beginner" ? 0.46 : 0.4;
      const similarity = terms.length > 0
        ? Math.min(0.9, 0.48 + hits * 0.07 + titleHits * 0.12)
        : broadScore - index * 0.005;

      return {
        id: `keyword:${String(row.id || index)}`,
        trickId: String(row.id || ""),
        title,
        content,
        similarity,
        searchMode: "keyword",
      };
    })
    .filter((row) => row.content && (terms.length === 0 || Number(row.similarity) > 0.48))
    .sort((a, b) => Number(b.similarity) - Number(a.similarity))
    .slice(0, Math.max(1, matchCount));
}
