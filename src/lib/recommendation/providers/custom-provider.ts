import { recommendationConfig, isProviderEnabled } from "@/lib/recommendation/config";
import {
  buildQueryFromContext,
  fetchJsonWithTimeout,
  inferDifficulty,
  isMagicRelevant,
  normalizeText,
  pickTags,
} from "@/lib/recommendation/providers/common";
import { VideoProvider } from "@/lib/recommendation/types";

type GenericResponse = {
  items?: Array<{
    id?: string;
    title?: string;
    description?: string;
    url?: string;
    tags?: string[];
    difficulty?: "beginner" | "intermediate" | "advanced";
    thumbnail?: string;
    duration?: string;
    language?: "zh" | "en" | "multi";
    publishedAt?: string;
  }>;
};

export function createCustomHttpProvider(id: "douyin" | "kuaishou"): VideoProvider {
  const endpoint = recommendationConfig.endpoints[id];
  const key = recommendationConfig.apiKeys[id];
  const enabled = isProviderEnabled(id) && Boolean(endpoint);

  return {
    id,
    enabled,
    timeoutMs: recommendationConfig.defaultProviderTimeoutMs,
    weight: recommendationConfig.weights[id],
    async search(context) {
      if (!enabled) return [];

      const query = buildQueryFromContext(context);
      if (!query) return [];

      const url = new URL(endpoint);
      url.searchParams.set("q", query);
      url.searchParams.set("locale", context.locale);
      url.searchParams.set("limit", String(recommendationConfig.maxCandidatesPerProvider));

      const data = await fetchJsonWithTimeout<GenericResponse>(url.toString(), recommendationConfig.defaultProviderTimeoutMs, {
        headers: key
          ? {
              Authorization: `Bearer ${key}`,
            }
          : undefined,
      });

      const items = Array.isArray(data?.items) ? data.items : [];

      return items
        .map((item, index) => {
          const title = normalizeText(item.title || "");
          const targetUrl = normalizeText(item.url || "");
          if (!title || !targetUrl) return null;
          const description = normalizeText(item.description || "");

          return {
            id: item.id ? `${id}:${item.id}` : `${id}:auto-${index}`,
            source: id,
            title,
            description,
            url: targetUrl,
            tags: pickTags(title, description, Array.isArray(item.tags) ? item.tags : []),
            difficulty: item.difficulty || inferDifficulty(`${title} ${description}`),
            language: item.language || context.locale,
            thumbnail: item.thumbnail,
            duration: item.duration,
            publishedAt: item.publishedAt,
            rawScore: 0.28,
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
        .filter((item) => isMagicRelevant(item.title, item.description, item.tags));
    },
  };
}
