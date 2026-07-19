import { cosineSimilarity, embedText } from "@/lib/ai/embedding";
import { memoryDb } from "@/lib/data/memory-db";
import { Locale, VideoRecommendation } from "@/lib/domain/types";
import { recommendationConfig } from "@/lib/recommendation/config";
import { inferDifficulty, pickTags } from "@/lib/recommendation/providers/common";
import { VerifiedCandidate } from "@/lib/recommendation/types";

type RankInput = {
  locale: Locale;
  userId: string;
  threadId: string;
  userMessage: string;
  conversationText: string;
  goalTopic?: string | null;
  candidates: VerifiedCandidate[];
  providerWeights: Record<string, number>;
  limit: number;
};

type ScoredCandidate = VerifiedCandidate & {
  matchScore: number;
  score: number;
  qualityScore: number;
  reason: string;
};

function normalizeNumber(value: number) {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function freshnessScore(publishedAt?: string) {
  if (!publishedAt) return 0.32;
  const ts = new Date(publishedAt).getTime();
  if (Number.isNaN(ts)) return 0.32;
  const days = (Date.now() - ts) / (1000 * 60 * 60 * 24);
  if (days <= 30) return 1;
  if (days <= 180) return 0.68;
  if (days <= 365) return 0.42;
  return 0.24;
}

function overlapRatio(a: string[], b: string[]) {
  if (!a.length || !b.length) return 0;
  const setB = new Set(b);
  const overlap = a.filter((item) => setB.has(item)).length;
  return overlap / Math.max(1, Math.min(a.length, b.length));
}

function buildReason(locale: Locale, source: string, topicScore: number, semanticScore: number, isFresh: boolean) {
  if (locale === "zh") {
    const lead = topicScore >= 0.5 ? "和你当前话题高度相关" : "与当前训练方向相关";
    const freshness = isFresh ? "，内容较新" : "";
    return `${lead}（${source}，语义匹配 ${Math.round(semanticScore * 100)}%${freshness}）`;
  }

  const lead = topicScore >= 0.5 ? "High topic alignment" : "Relevant to your current practice";
  const freshness = isFresh ? ", fairly recent" : "";
  return `${lead} (${source}, semantic ${Math.round(semanticScore * 100)}%${freshness})`;
}

function detectTopicShift(currentTags: string[], historyTags: string[]) {
  if (!currentTags.length || !historyTags.length) return false;
  const ratio = overlapRatio(currentTags, historyTags);
  return ratio < 0.2;
}

function dedupeCandidates(candidates: VerifiedCandidate[]) {
  const kept = new Map<string, VerifiedCandidate>();

  for (const candidate of candidates) {
    const keyByUrl = candidate.normalizedUrl.toLowerCase();
    const titleKey = candidate.title.toLowerCase().replace(/\s+/g, " ").trim();
    const fallbackKey = `${titleKey}|${candidate.duration || ""}`;
    const key = keyByUrl || fallbackKey;

    const existing = kept.get(key);
    if (!existing || (candidate.rawScore ?? 0) > (existing.rawScore ?? 0)) {
      kept.set(key, candidate);
    }
  }

  return Array.from(kept.values());
}

function diversify(scored: ScoredCandidate[], topN: number) {
  if (!scored.length) return [];

  const maxPerSource = Math.max(1, Math.floor(topN / 2));
  const selected: ScoredCandidate[] = [];
  const sourceCount = new Map<string, number>();

  for (const item of scored) {
    if (selected.length >= topN) break;
    const count = sourceCount.get(item.source) || 0;
    if (count >= maxPerSource) continue;
    selected.push(item);
    sourceCount.set(item.source, count + 1);
  }

  if (selected.length < topN) {
    for (const item of scored) {
      if (selected.length >= topN) break;
      if (selected.some((picked) => picked.id === item.id)) continue;
      selected.push(item);
    }
  }

  return selected.slice(0, topN);
}

export function rankAndFuseRecommendations(input: RankInput): VideoRecommendation[] {
  const { locale, userId, threadId, userMessage, conversationText, providerWeights, limit, goalTopic } = input;
  const unique = dedupeCandidates(input.candidates);
  if (!unique.length) return [];

  const queryText = `${userMessage}\n${conversationText}`.trim();
  const queryVector = embedText(queryText);
  const queryTags = pickTags(userMessage, conversationText);
  const historyTags = pickTags(conversationText, "");
  const preferredDifficulty = inferDifficulty(queryText);
  const topicShifted = detectTopicShift(queryTags, historyTags);

  const recentIds = new Set(
    memoryDb.listRecentlyRecommendedVideoIdsByThread(
      threadId,
      userId,
      recommendationConfig.recentHistoryWindow
    )
  );

  const scored = unique
    .map<ScoredCandidate>((candidate) => {
      const text = `${candidate.title} ${candidate.description} ${candidate.tags.join(" ")}`;
      const vector = embedText(text);
      const semantic = normalizeNumber((cosineSimilarity(queryVector, vector) + 1) / 2);
      const topic = overlapRatio(queryTags, candidate.tags);
      const difficulty = candidate.difficulty === preferredDifficulty ? 1 : 0;
      const fresh = freshnessScore(candidate.publishedAt);
      const sourceWeight = providerWeights[candidate.source] || 1;
      const raw = normalizeNumber(candidate.rawScore || 0.3);
      const repeated =
        recentIds.has(candidate.id) || recentIds.has(candidate.normalizedUrl);
      const repeatPenalty = repeated ? (topicShifted ? 0.08 : 0.28) : 0;

      const finalScore =
        semantic * 0.48 +
        topic * 0.2 +
        difficulty * 0.12 +
        fresh * 0.1 +
        raw * 0.1 +
        sourceWeight * 0.05 -
        repeatPenalty;

      const clamped = normalizeNumber(finalScore);
      const quality = normalizeNumber(
        semantic * 0.55 +
          topic * 0.25 +
          fresh * 0.1 +
          (candidate.tags.length >= 2 ? 0.05 : 0) +
          0.05
      );

      return {
        ...candidate,
        matchScore: Number(clamped.toFixed(4)),
        score: Number(clamped.toFixed(4)),
        qualityScore: Number(quality.toFixed(4)),
        reason: buildReason(locale, candidate.source, topic, semantic, fresh >= 0.6),
      };
    })
    .sort((a, b) => b.matchScore - a.matchScore);

  const qualityPassed = scored.filter(
    (item) =>
      item.qualityScore >= recommendationConfig.minQualityScore &&
      item.matchScore >= recommendationConfig.minMatchScore
  );
  const rankedPool = qualityPassed.length >= Math.min(2, limit) ? qualityPassed : scored;
  const picked = diversify(rankedPool, limit);

  return picked.map<VideoRecommendation>((item) => ({
    id: item.id,
    title: item.title,
    url: item.normalizedUrl,
    normalizedUrl: item.normalizedUrl,
    source: item.source,
    verified: true,
    tags: item.tags,
    difficulty: item.difficulty,
    reason: item.reason,
    matchScore: item.matchScore,
    score: item.score,
    qualityScore: item.qualityScore,
    playableCheckedAt: item.playableCheckedAt,
    goalTopic: goalTopic ?? null,
    thumbnail: item.thumbnail,
    duration: item.duration,
  }));
}
