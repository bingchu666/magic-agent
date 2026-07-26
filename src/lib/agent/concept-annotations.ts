const MAX_CONCEPTS = 12;
export const CONCEPT_HREF_PREFIX = "#knowledge-concept=";

const DOMAIN_CONCEPT_PATTERNS = [
  /\bfalse shuffle\b/gi,
  /\bribbon spread\b/gi,
  /\bcardboard slide\b/gi,
  /\btop four cards\b/gi,
  /\bcard control\b/gi,
  /\bdouble lift\b/gi,
  /\bclassic palm\b/gi,
  /\bfrench drop\b/gi,
  /\bthumb tip\b/gi,
  /\bforcing technique\b/gi,
  /\bmisdirection\b/gi,
  /\bsleight of hand\b/gi,
  /\bquantum entanglement\b/gi,
  /\bno-communication theorem\b/gi,
  /\bmachine learning\b/gi,
  /\breinforcement learning\b/gi,
  /\bmixture of experts\b/gi,
  /假洗牌/g,
  /丝带展牌/g,
  /双翻/g,
  /控牌/g,
  /迫牌/g,
  /掌藏/g,
  /法式落下/g,
  /错误引导/g,
  /量子纠缠/g,
  /不可通信定理/g,
  /强化学习/g,
  /混合专家模型/g,
];

function normalizeCandidate(value: string) {
  return value
    .replace(/\[\[|\]\]/g, "")
    .replace(/[*_`#]/g, "")
    .replace(/^[\d一二三四五六七八九十]+[.、)\s-]+/, "")
    .replace(/^[“”"'‘’]+|[“”"'‘’：:。.!?？]+$/g, "")
    .replace(/^(?:the|a|an)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isUsefulCandidate(value: string) {
  if (value.length < 2 || value.length > 48) return false;
  if (/https?:\/\/|知识库依据|database grounding/i.test(value)) return false;
  if (/[。！？!?]/.test(value)) return false;
  const words = value.split(/\s+/).filter(Boolean);
  return words.length <= 6;
}

function collectCandidates(text: string) {
  const candidates: string[] = [];
  const add = (value: string) => {
    const normalized = normalizeCandidate(value);
    if (!isUsefulCandidate(normalized)) return;
    if (
      candidates.some(
        (candidate) => candidate.toLocaleLowerCase() === normalized.toLocaleLowerCase()
      )
    ) {
      return;
    }
    candidates.push(normalized);
  };

  for (const match of text.matchAll(/\[\[([^\]]+)\]\]/g)) add(match[1]);

  // Prioritize concrete domain phrases over generic bold section labels.
  for (const pattern of DOMAIN_CONCEPT_PATTERNS) {
    for (const match of text.matchAll(pattern)) add(match[0]);
  }

  for (const match of text.matchAll(/\*\*([^*\n]{2,64})\*\*/g)) add(match[1]);
  for (const match of text.matchAll(/`([^`\n]{2,48})`/g)) add(match[1]);

  for (const line of text.split("\n")) {
    const heading = line.match(/^#{1,4}\s+(.+)$/)?.[1];
    if (heading) {
      heading
        .split(/\s+(?:&|vs\.?|与|和|及)\s+|[：:—–-]\s*/)
        .forEach(add);
    }

    const label = line.match(
      /^(?:[-*]\s+|\d+[.、]\s*)?(?:\*\*)?([^：:\n]{2,28})(?:\*\*)?[：:]/
    )?.[1];
    if (label) add(label);
  }

  return candidates;
}

function markerCount(text: string) {
  return Array.from(text.matchAll(/\[\[([^\]]+)\]\]/g)).length;
}

function wrapFirstUnmarked(text: string, candidate: string) {
  const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(escaped, /[A-Za-z]/.test(candidate) ? "i" : "");
  let remaining = text;
  let offset = 0;

  while (remaining) {
    const match = pattern.exec(remaining);
    if (!match || typeof match.index !== "number") return text;
    const index = offset + match.index;
    const before = text.slice(0, index);
    const insideMarker = before.lastIndexOf("[[") > before.lastIndexOf("]]");
    if (!insideMarker) {
      const end = index + match[0].length;
      return `${text.slice(0, index)}[[${match[0]}]]${text.slice(end)}`;
    }
    const consumed = match.index + match[0].length;
    offset += consumed;
    remaining = remaining.slice(consumed);
  }

  return text;
}

/**
 * Models are asked to mark explorable concepts, but formatting compliance is
 * best-effort. This deterministic pass guarantees useful clickable terms
 * without inventing new wording or changing the answer.
 */
export function ensureConceptAnnotations(text: string) {
  if (!text.trim()) return text;
  let annotated = text;

  for (const candidate of collectCandidates(text)) {
    if (markerCount(annotated) >= MAX_CONCEPTS) break;
    annotated = wrapFirstUnmarked(annotated, candidate);
  }

  return annotated;
}

export function toConceptLinkMarkdown(text: string) {
  return ensureConceptAnnotations(text).replace(
    /\[\[([^\]]+)\]\]/g,
    (_, term: string) =>
      `[${term}](${CONCEPT_HREF_PREFIX}${encodeURIComponent(term)})`
  );
}
