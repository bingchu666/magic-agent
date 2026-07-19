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

type VimeoResponse = {
  data?: Array<{
    uri?: string;
    name?: string;
    description?: string;
    duration?: number;
    created_time?: string;
    pictures?: {
      sizes?: Array<{ link?: string }>;
    };
  }>;
};

function formatDuration(seconds?: number) {
  if (!seconds || seconds <= 0) return undefined;
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

function idFromUri(uri?: string) {
  if (!uri) return "";
  const matched = uri.match(/\/(\d+)$/);
  return matched?.[1] || "";
}

export function createVimeoProvider(): VideoProvider {
  const enabled = isProviderEnabled("vimeo") && Boolean(recommendationConfig.apiKeys.vimeo);

  return {
    id: "vimeo",
    enabled,
    timeoutMs: recommendationConfig.defaultProviderTimeoutMs,
    weight: recommendationConfig.weights.vimeo,
    async search(context) {
      if (!enabled) return [];
      const query = buildQueryFromContext(context);
      if (!query) return [];

      const url = new URL(recommendationConfig.endpoints.vimeo);
      url.searchParams.set("query", query);
      url.searchParams.set("per_page", String(recommendationConfig.maxCandidatesPerProvider));
      url.searchParams.set("direction", "desc");
      url.searchParams.set("sort", "relevant");

      const data = await fetchJsonWithTimeout<VimeoResponse>(url.toString(), recommendationConfig.defaultProviderTimeoutMs, {
        headers: {
          Authorization: `Bearer ${recommendationConfig.apiKeys.vimeo}`,
        },
      });

      const items = Array.isArray(data?.data) ? data.data : [];

      return items
        .map((item) => {
          const videoId = idFromUri(item.uri);
          if (!videoId) return null;

          const title = normalizeText(item.name || "");
          if (!title) return null;
          const description = normalizeText(item.description || "");
          const pictureSizes = Array.isArray(item.pictures?.sizes) ? item.pictures?.sizes : [];
          const thumbnail = pictureSizes.length ? pictureSizes[pictureSizes.length - 1]?.link : undefined;

          return {
            id: `vimeo:${videoId}`,
            source: "vimeo",
            title,
            description,
            url: `https://vimeo.com/${videoId}`,
            tags: pickTags(title, description),
            difficulty: inferDifficulty(`${title} ${description}`),
            language: context.locale,
            thumbnail,
            duration: formatDuration(item.duration),
            publishedAt: item.created_time,
            rawScore: 0.32,
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
        .filter((item) => isMagicRelevant(item.title, item.description, item.tags));
    },
  };
}
