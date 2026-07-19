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

type BilibiliResponse = {
  data?: {
    result?: Array<{
      bvid?: string;
      title?: string;
      description?: string;
      duration?: string;
      pic?: string;
      pubdate?: number;
      tag?: string;
    }>;
  };
};

function stripHtml(input: string) {
  return input.replace(/<[^>]+>/g, " ").replace(/&[^;]+;/g, " ");
}

function parsePubDate(value?: number) {
  if (!value || Number.isNaN(value)) return undefined;
  return new Date(value * 1000).toISOString();
}

export function createBilibiliProvider(): VideoProvider {
  const enabled = isProviderEnabled("bilibili");

  return {
    id: "bilibili",
    enabled,
    timeoutMs: recommendationConfig.defaultProviderTimeoutMs,
    weight: recommendationConfig.weights.bilibili,
    async search(context) {
      if (!enabled) return [];
      const query = buildQueryFromContext(context);
      if (!query) return [];

      const url = new URL(recommendationConfig.endpoints.bilibili);
      url.searchParams.set("search_type", "video");
      url.searchParams.set("keyword", query);
      url.searchParams.set("page", "1");
      url.searchParams.set("page_size", String(recommendationConfig.maxCandidatesPerProvider));

      const data = await fetchJsonWithTimeout<BilibiliResponse>(url.toString(), recommendationConfig.defaultProviderTimeoutMs);
      const items = Array.isArray(data?.data?.result) ? data.data.result : [];

      return items
        .map((item) => {
          const bvid = String(item.bvid || "").trim();
          if (!bvid) return null;

          const title = normalizeText(stripHtml(item.title || ""));
          if (!title) return null;
          const description = normalizeText(stripHtml(item.description || ""));
          const baseTags = item.tag
            ? item.tag
                .split(",")
                .map((part) => part.trim())
                .filter(Boolean)
            : [];

          const pic = String(item.pic || "").trim();
          const thumbnail = pic ? (pic.startsWith("http") ? pic : `https:${pic}`) : undefined;

          return {
            id: `bilibili:${bvid}`,
            source: "bilibili",
            title,
            description,
            url: `https://www.bilibili.com/video/${bvid}`,
            tags: pickTags(title, description, baseTags),
            difficulty: inferDifficulty(`${title} ${description}`),
            language: context.locale,
            thumbnail,
            duration: item.duration,
            publishedAt: parsePubDate(item.pubdate),
            rawScore: 0.33,
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
        .filter((item) => isMagicRelevant(item.title, item.description, item.tags));
    },
  };
}
