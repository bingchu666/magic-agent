import OpenAI from "openai";
import type { ChatHistoryMessage, Locale } from "@/lib/domain/types";

export type KnowledgeCandidate = Record<string, unknown>;

type CandidateEnvelope = {
  candidateId: string;
  row: KnowledgeCandidate;
};

const RELEVANCE_TIMEOUT_MS = Number(
  process.env.KNOWLEDGE_RELEVANCE_TIMEOUT_MS || 6500
);
const MAX_CANDIDATES = 8;
const MAX_RELEVANT_CANDIDATES = 3;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timer: NodeJS.Timeout | undefined;
  return new Promise<T>((resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`KNOWLEDGE_RELEVANCE_TIMEOUT_${timeoutMs}`)),
      timeoutMs
    );
    promise
      .then(resolve)
      .catch(reject)
      .finally(() => {
        if (timer) clearTimeout(timer);
      });
  });
}

function candidateText(row: KnowledgeCandidate) {
  const title = typeof row.title === "string" ? row.title.trim() : "";
  const content = typeof row.content === "string" ? row.content.trim() : "";
  return { title, content };
}

function candidateEnvelopes(rows: KnowledgeCandidate[]): CandidateEnvelope[] {
  return rows.slice(0, MAX_CANDIDATES).map((row, index) => ({
    candidateId: `candidate_${index + 1}`,
    row,
  }));
}

export function buildKnowledgeRelevancePrompt(params: {
  question: string;
  history: ChatHistoryMessage[];
  candidates: KnowledgeCandidate[];
  locale: Locale;
}) {
  const history = params.history
    .slice(-8)
    .map((message) => `${message.role}: ${message.content.slice(0, 1600)}`)
    .join("\n");
  const candidates = candidateEnvelopes(params.candidates).map(({ candidateId, row }) => {
    const { title, content } = candidateText(row);
    return {
      id: candidateId,
      title,
      content: content.slice(0, 2600),
    };
  });

  return [
    "You are a strict evidence relevance gate for retrieval-augmented answers.",
    "Select a candidate only when its text directly supports the user's actual request in the conversation.",
    "Semantic similarity, shared words, or both being about magic are not sufficient.",
    "For claims that a named person created, performed, invented, owned, or is known for a work, the candidate itself must explicitly support that relationship.",
    "Reject a different trick, a different person, a generic template, or any candidate that would require bridging or inventing a relationship.",
    "Natural or indirect wording is valid: judge the user's meaning, not whether they used a database title or keyword.",
    "Do not answer the user and do not use outside knowledge. Return JSON only in this exact shape: {\"relevant_ids\":[\"candidate_1\"]}.",
    "Return an empty array when no candidate is directly supported.",
    params.locale === "zh"
      ? "请结合完整对话理解用户意图，但证据关系必须由候选条目正文明确支持。"
      : "Use the conversation to understand intent, but require the candidate text itself to support factual relationships.",
    "",
    "Conversation:",
    history || "(no previous turns)",
    "",
    `Current request: ${params.question.trim()}`,
    "",
    `Candidates: ${JSON.stringify(candidates)}`,
  ].join("\n");
}

export function parseKnowledgeRelevanceIds(raw: string, candidateCount: number) {
  const json = raw.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as { relevant_ids?: unknown };
    if (!Array.isArray(parsed.relevant_ids)) return [];
    const allowed = new Set(
      Array.from({ length: Math.min(candidateCount, MAX_CANDIDATES) }, (_, index) =>
        `candidate_${index + 1}`
      )
    );
    return [...new Set(parsed.relevant_ids)]
      .filter((value): value is string => typeof value === "string" && allowed.has(value))
      .slice(0, MAX_RELEVANT_CANDIDATES);
  } catch {
    return [];
  }
}

async function callRelevanceModel(prompt: string) {
  const useDeepSeek = Boolean(process.env.DEEPSEEK_API_KEY);
  const useOpenAi =
    !useDeepSeek &&
    process.env.OPENAI_FALLBACK_ENABLED === "true" &&
    Boolean(process.env.OPENAI_API_KEY);
  if (!useDeepSeek && !useOpenAi) return null;

  const client = useDeepSeek
    ? new OpenAI({
        apiKey: process.env.DEEPSEEK_API_KEY,
        baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
      })
    : new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = useDeepSeek
    ? (process.env.KNOWLEDGE_RELEVANCE_MODEL || process.env.DEEPSEEK_MODEL || "deepseek-flash")
        .split(",")[0]
        .trim()
    : (process.env.KNOWLEDGE_RELEVANCE_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini")
        .split(",")[0]
        .trim();

  const completion = await withTimeout(
    client.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      max_tokens: 180,
      ...(useDeepSeek ? { reasoning_effort: "none" as const } : {}),
    }),
    RELEVANCE_TIMEOUT_MS
  );
  return completion.choices?.[0]?.message?.content?.trim() || "";
}

/**
 * Precision stage after high-recall vector/keyword search. If the judge is
 * unavailable or its output cannot be validated, fail closed: returning no
 * database context is safer than attaching an unrelated method to a person.
 */
export async function selectDirectlyRelevantKnowledge(params: {
  question: string;
  history: ChatHistoryMessage[];
  candidates: KnowledgeCandidate[];
  locale: Locale;
}) {
  if (params.candidates.length === 0) return [];
  const candidates = params.candidates.slice(0, MAX_CANDIDATES);
  try {
    const prompt = buildKnowledgeRelevancePrompt({ ...params, candidates });
    const raw = await callRelevanceModel(prompt);
    if (raw === null) {
      console.warn("Knowledge relevance judge unavailable; dropping candidates");
      return [];
    }
    const acceptedIds = parseKnowledgeRelevanceIds(raw, candidates.length);
    const acceptedIndexes = new Set(
      acceptedIds.map((id) => Number(id.replace("candidate_", "")) - 1)
    );
    return candidates.filter((_, index) => acceptedIndexes.has(index));
  } catch (error) {
    console.warn("Knowledge relevance judge failed; dropping candidates", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}
