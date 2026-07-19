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

type DailymotionResponse = {
  list?: Array<{
    id?: string;
    title?: string;
    description?: string;
    duration?: number;
    url?: string;
    thumbnail_360_url?: string;
    created_time?: number;
  }>;
};

function formatDuration(seconds?: number) {
  if (!seconds || seconds <= 0) return undefined;
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

function parseCreatedTime(ts?: number) {
  if (!ts || Number.isNaN(ts)) return undefined;
  return new Date(ts * 1000).toISOString();
}

export function createDailymotionProvider(): VideoProvider {
  const enabled = isProviderEnabled("dailymotion");

  return {
    id: "dailymotion",
    enabled,
    timeoutMs: recommendationConfig.defaultProviderTimeoutMs,
    weight: recommendationConfig.weights.dailymotion,
    async search(context) {
      if (!enabled) return [];

      const query = buildQueryFromContext(context);
      if (!query) return [];

      const url = new URL(recommendationConfig.endpoints.dailymotion);
      url.searchParams.set("search", query);
      url.searchParams.set("limit", String(recommendationConfig.maxCandidatesPerProvider));
      url.searchParams.set(
        "fields",
        "id,title,description,duration,url,thumbnail_360_url,created_time"
      );

      const data = await fetchJsonWithTimeout<DailymotionResponse>(url.toString(), recommendationConfig.defaultProviderTimeoutMs);
      const items = Array.isArray(data?.list) ? data.list : [];

      return items
        .map((item) => {
          const id = String(item.id || "").trim();
          if (!id) return null;

          const title = normalizeText(item.title || "");
          if (!title) return null;
          const description = normalizeText(item.description || "");

          return {
            id: `dailymotion:${id}`,
            source: "dailymotion",
            title,
            description,
            url: item.url || `https://www.dailymotion.com/video/${id}`,
            tags: pickTags(title, description),
            difficulty: inferDifficulty(`${title} ${description}`),
            language: context.locale,
            thumbnail: item.thumbnail_360_url,
            duration: formatDuration(item.duration),
            publishedAt: parseCreatedTime(item.created_time),
            rawScore: 0.3,
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
        .filter((item) => isMagicRelevant(item.title, item.description, item.tags));
    },
  };
}
