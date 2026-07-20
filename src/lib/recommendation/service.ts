import { supabaseDb } from "@/lib/data/supabase-db";
import { Locale, VideoRecommendation } from "@/lib/domain/types";
import { recommendationCache } from "@/lib/recommendation/cache";
import { recommendationConfig } from "@/lib/recommendation/config";
import { rankAndFuseRecommendations } from "@/lib/recommendation/fusion-ranker";
import { isMagicRelevant, pickTags } from "@/lib/recommendation/providers/common";
import { getActiveProviders } from "@/lib/recommendation/providers";
import { scoreCandidatesWithSemanticModel } from "@/lib/recommendation/semantic-reranker";
import { RecommendationContext, ProviderResult, VideoCandidate, VideoProvider } from "@/lib/recommendation/types";
import { validateCandidates } from "@/lib/recommendation/validator";

function safeKey(input: string) {
  return input.replace(/\s+/g, " ").trim().slice(0, 256);
}

function buildCacheKey(context: RecommendationContext) {
  return [
    context.threadId,
    context.locale,
    safeKey(context.userMessage),
    safeKey(context.conversationText),
    String(context.limit),
  ].join("|");
}

async function runWithTimeout(provider: VideoProvider, context: RecommendationContext): Promise<ProviderResult> {
  const startedAt = Date.now();

  const fallback = new Promise<VideoCandidate[]>((resolve) => {
    setTimeout(() => resolve([]), provider.timeoutMs);
  });

  try {
    const result = await Promise.race([provider.search(context), fallback]);
    const items = Array.isArray(result) ? result : [];

    return {
      provider: provider.id,
      items,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      provider: provider.id,
      items: [],
      error: error instanceof Error ? error.message : "unknown_error",
      elapsedMs: Date.now() - startedAt,
    };
  }
}

function providerWeights() {
  return {
    youtube: recommendationConfig.weights.youtube,
    bilibili: recommendationConfig.weights.bilibili,
    vimeo: recommendationConfig.weights.vimeo,
    dailymotion: recommendationConfig.weights.dailymotion,
    douyin: recommendationConfig.weights.douyin,
    kuaishou: recommendationConfig.weights.kuaishou,
    library: recommendationConfig.weights.library,
  };
}

function ensureLimit(limit?: number) {
  if (!limit || Number.isNaN(limit)) return recommendationConfig.topN;
  return Math.min(Math.max(1, limit), 8);
}

function normalizeLocale(locale: Locale) {
  return locale === "en" ? "en" : "zh";
}

function prefilterCandidates(context: RecommendationContext, candidates: VideoCandidate[]) {
  if (!candidates.length) return [];
  const relevantCandidates = candidates.filter((candidate) =>
    isMagicRelevant(candidate.title, candidate.description, candidate.tags)
  );
  if (!relevantCandidates.length) return [];

  const queryTags = pickTags(context.userMessage, context.conversationText);
  const topicalTags = queryTags.filter((tag) =>
    ["cards", "coin", "stage", "mentalism", "kids"].includes(tag)
  );
  const queryText = `${context.userMessage} ${context.conversationText}`.toLowerCase();

  const scored = relevantCandidates
    .filter((candidate) => {
      if (!topicalTags.length) return true;
      return topicalTags.some((tag) => candidate.tags.includes(tag));
    })
    .map((candidate) => {
    const text = `${candidate.title} ${candidate.description} ${candidate.tags.join(" ")}`.toLowerCase();
    const overlap = queryTags.filter((tag) => candidate.tags.includes(tag)).length;
    const tagScore = queryTags.length ? overlap / queryTags.length : 0;
    const textHit = queryText
      .split(/\s+/)
      .filter((part) => part.length >= 2)
      .some((part) => text.includes(part))
      ? 0.12
      : 0;
    const base = candidate.rawScore ?? 0.3;
    return {
      candidate,
      score: base + tagScore * 0.45 + textHit,
    };
    });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(context.limit * 4, recommendationConfig.maxCandidatesForValidation))
    .map((item) => item.candidate);
}

async function enrichWithModelScore(context: RecommendationContext, candidates: Awaited<ReturnType<typeof validateCandidates>>) {
  if (!candidates.length) return candidates;

  const query = `${context.userMessage}\n${context.conversationText}`.trim();
  const scoped = candidates.slice(0, 24);
  const modelScores = await scoreCandidatesWithSemanticModel(query, scoped);

  return candidates.map((candidate) => {
    const modelScore = modelScores.get(candidate.id);
    if (typeof modelScore !== "number") return candidate;
    const merged = (candidate.rawScore ?? 0.32) * 0.35 + modelScore * 0.65;
    return {
      ...candidate,
      rawScore: Number(merged.toFixed(4)),
    };
  });
}

export async function recommendVideosDynamic(input: {
  locale: Locale;
  userId: string;
  threadId: string;
  userMessage: string;
  conversationText: string;
  limit?: number;
  bypassCache?: boolean;
}): Promise<VideoRecommendation[]> {
  const context: RecommendationContext = {
    locale: normalizeLocale(input.locale),
    userId: input.userId,
    threadId: input.threadId,
    userMessage: input.userMessage,
    conversationText: input.conversationText,
    limit: ensureLimit(input.limit),
    now: new Date().toISOString(),
  };

  const key = buildCacheKey(context);
  if (!input.bypassCache) {
    const cached = recommendationCache.get(key);
    if (cached?.length) {
      return cached;
    }
  }

  const providers = getActiveProviders();
  const results = await Promise.all(providers.map((provider) => runWithTimeout(provider, context)));

  const merged = results.flatMap((result) => result.items);
  const prefiltered = prefilterCandidates(context, merged);
  const validated = await validateCandidates(prefiltered, {
    maxToCheck: recommendationConfig.maxCandidatesForValidation,
  });
  const rescored = await enrichWithModelScore(context, validated);

  let picked = await rankAndFuseRecommendations({
    locale: context.locale,
    userId: context.userId,
    threadId: context.threadId,
    userMessage: context.userMessage,
    conversationText: context.conversationText,
    goalTopic: context.userMessage,
    candidates: rescored,
    providerWeights: providerWeights(),
    limit: context.limit,
  });

  if (picked.length < recommendationConfig.providerFailureFallbackMin) {
    const libraryProvider = providers.find((provider) => provider.id === "library");
    if (libraryProvider) {
      const fallback = await runWithTimeout(libraryProvider, context);
      const fallbackValidated = await validateCandidates(
        prefilterCandidates(context, fallback.items),
        {
          maxToCheck: recommendationConfig.maxCandidatesForValidation,
        }
      );
      const fallbackRescored = await enrichWithModelScore(context, fallbackValidated);
      const fallbackPicked = await rankAndFuseRecommendations({
        locale: context.locale,
        userId: context.userId,
        threadId: context.threadId,
        userMessage: context.userMessage,
        conversationText: context.conversationText,
        goalTopic: context.userMessage,
        candidates: fallbackRescored,
        providerWeights: providerWeights(),
        limit: context.limit,
      });
      if (fallbackPicked.length > picked.length) {
        picked = fallbackPicked;
      }
    }
  }

  recommendationCache.set(key, picked);
  recommendationCache.cleanup();

  await supabaseDb.createEvent({
    userId: context.userId,
    name: "video_recommendation_fused",
    payload: {
      threadId: context.threadId,
      query: context.userMessage,
      providers: results.map((item) => ({
        provider: item.provider,
        count: item.items.length,
        error: item.error || null,
        elapsedMs: item.elapsedMs,
      })),
      finalCount: picked.length,
      recommendationIds: picked.map((item) => item.id),
      semanticModel: process.env.VIDEO_SEMANTIC_MODEL || "text-embedding-3-large",
    },
  });

  return picked;
}
