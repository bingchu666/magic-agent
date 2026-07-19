import OpenAI from "openai";
import { cosineSimilarity, embedText } from "@/lib/ai/embedding";
import { VerifiedCandidate } from "@/lib/recommendation/types";

const MAX_TEXT_LEN = 360;
const SEMANTIC_TIMEOUT_MS = Number(process.env.VIDEO_SEMANTIC_TIMEOUT_MS || 1800);
const SEMANTIC_MODEL = process.env.VIDEO_SEMANTIC_MODEL || "text-embedding-3-large";
const USE_REMOTE_EMBEDDING = process.env.VIDEO_SEMANTIC_USE_OPENAI === "true";

function trimText(input: string) {
  return input.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_LEN);
}

function localScore(query: string, candidate: VerifiedCandidate) {
  const queryVector = embedText(query);
  const target = `${candidate.title} ${candidate.description} ${candidate.tags.join(" ")}`;
  const targetVector = embedText(target);
  return (cosineSimilarity(queryVector, targetVector) + 1) / 2;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`SEMANTIC_TIMEOUT_${timeoutMs}`)), timeoutMs);
    promise
      .then(resolve)
      .catch(reject)
      .finally(() => clearTimeout(timer));
  });
}

export async function scoreCandidatesWithSemanticModel(
  query: string,
  candidates: VerifiedCandidate[]
): Promise<Map<string, number>> {
  const scores = new Map<string, number>();
  if (!candidates.length) return scores;

  const cleanQuery = trimText(query);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !USE_REMOTE_EMBEDDING) {
    for (const candidate of candidates) {
      scores.set(candidate.id, Number(localScore(cleanQuery, candidate).toFixed(4)));
    }
    return scores;
  }

  try {
    const inputs = [
      cleanQuery,
      ...candidates.map((item) => trimText(`${item.title}\n${item.description}\n${item.tags.join(" ")}`)),
    ];

    const client = new OpenAI({ apiKey });
    const response = await withTimeout(
      client.embeddings.create({
        model: SEMANTIC_MODEL,
        input: inputs,
      }),
      SEMANTIC_TIMEOUT_MS
    );

    const data = response.data || [];
    const queryEmbedding = data[0]?.embedding;
    if (!Array.isArray(queryEmbedding)) {
      throw new Error("SEMANTIC_QUERY_EMBEDDING_MISSING");
    }

    for (let i = 0; i < candidates.length; i += 1) {
      const emb = data[i + 1]?.embedding;
      if (!Array.isArray(emb)) {
        scores.set(candidates[i].id, Number(localScore(cleanQuery, candidates[i]).toFixed(4)));
        continue;
      }

      const cosine = cosineSimilarity(queryEmbedding, emb);
      const normalized = Math.max(0, Math.min(1, (cosine + 1) / 2));
      scores.set(candidates[i].id, Number(normalized.toFixed(4)));
    }

    return scores;
  } catch {
    for (const candidate of candidates) {
      scores.set(candidate.id, Number(localScore(cleanQuery, candidate).toFixed(4)));
    }
    return scores;
  }
}
