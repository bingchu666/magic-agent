import { recommendationConfig, isProviderEnabled } from "@/lib/recommendation/config";
import {
  buildQueryFromContext,
  fetchTextWithTimeout,
  fetchJsonWithTimeout,
  inferDifficulty,
  isMagicRelevant,
  normalizeText,
  pickTags,
} from "@/lib/recommendation/providers/common";
import { VideoProvider } from "@/lib/recommendation/types";

type YoutubeSearchResponse = {
  items?: Array<{
    id?: { videoId?: string };
    snippet?: {
      title?: string;
      description?: string;
      publishedAt?: string;
      thumbnails?: {
        medium?: { url?: string };
        high?: { url?: string };
        default?: { url?: string };
      };
    };
  }>;
};

function localeToYoutubeLanguage(locale: "zh" | "en") {
  return locale === "zh" ? "zh-CN" : "en";
}

function parseYoutubeSearchHtml(html: string) {
  const chunks = html.match(/"videoId":"[A-Za-z0-9_-]{11}".{0,900}?"title":\{"runs":\[\{"text":"[^"]+/g) || [];
  const items: Array<{ videoId: string; title: string }> = [];
  const seen = new Set<string>();

  for (const chunk of chunks) {
    const idMatched = chunk.match(/"videoId":"([A-Za-z0-9_-]{11})"/);
    const titleMatched = chunk.match(/"title":\{"runs":\[\{"text":"([^"]+)/);
    const videoId = idMatched?.[1];
    const title = titleMatched?.[1]?.replace(/\\u0026/g, "&").trim();
    if (!videoId || !title || seen.has(videoId)) continue;
    seen.add(videoId);
    items.push({ videoId, title });
    if (items.length >= recommendationConfig.maxCandidatesPerProvider) break;
  }

  return items;
}

export function createYoutubeProvider(): VideoProvider {
  const enabled = isProviderEnabled("youtube");

  return {
    id: "youtube",
    enabled,
    timeoutMs: recommendationConfig.defaultProviderTimeoutMs,
    weight: recommendationConfig.weights.youtube,
    async search(context) {
      if (!enabled) return [];

      const query = buildQueryFromContext(context);
      if (!query) return [];

      if (recommendationConfig.apiKeys.youtube) {
        const url = new URL(recommendationConfig.endpoints.youtube);
        url.searchParams.set("part", "snippet");
        url.searchParams.set("type", "video");
        url.searchParams.set("maxResults", String(recommendationConfig.maxCandidatesPerProvider));
        url.searchParams.set("q", query);
        url.searchParams.set("relevanceLanguage", localeToYoutubeLanguage(context.locale));
        url.searchParams.set("key", recommendationConfig.apiKeys.youtube);

        const data = await fetchJsonWithTimeout<YoutubeSearchResponse>(url.toString(), recommendationConfig.defaultProviderTimeoutMs);
        const items = Array.isArray(data?.items) ? data.items : [];

        return items
          .map((item) => {
            const videoId = item.id?.videoId?.trim();
            if (!videoId) return null;
            const title = normalizeText(item.snippet?.title || "");
            if (!title) return null;
            const description = normalizeText(item.snippet?.description || "");

            return {
              id: `youtube:${videoId}`,
              source: "youtube",
              title,
              description,
              url: `https://www.youtube.com/watch?v=${videoId}`,
              tags: pickTags(title, description),
              difficulty: inferDifficulty(`${title} ${description}`),
              language: context.locale,
              thumbnail:
                item.snippet?.thumbnails?.high?.url ||
                item.snippet?.thumbnails?.medium?.url ||
                item.snippet?.thumbnails?.default?.url,
              publishedAt: item.snippet?.publishedAt,
              rawScore: 0.35,
            };
          })
          .filter((item): item is NonNullable<typeof item> => Boolean(item))
          .filter((item) => isMagicRelevant(item.title, item.description, item.tags));
      }

      const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
      const html = await fetchTextWithTimeout(searchUrl, recommendationConfig.defaultProviderTimeoutMs);
      if (!html) return [];
      const parsed = parseYoutubeSearchHtml(html);

      return parsed
        .map((item) => {
          const title = normalizeText(item.title);
          const description = "";
          return {
            id: `youtube:${item.videoId}`,
            source: "youtube",
            title,
            description,
            url: `https://www.youtube.com/watch?v=${item.videoId}`,
            tags: pickTags(title, description),
            difficulty: inferDifficulty(title),
            language: context.locale,
            rawScore: 0.34,
          };
        })
        .filter((item) => isMagicRelevant(item.title, item.description, item.tags));
    },
  };
}
