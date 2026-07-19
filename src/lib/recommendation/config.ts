const defaultEnabled = ["youtube", "bilibili", "library"];

const defaultAllowedDomains = [
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "bilibili.com",
  "www.bilibili.com",
  "vimeo.com",
  "www.vimeo.com",
  "dailymotion.com",
  "www.dailymotion.com",
  "douyin.com",
  "www.douyin.com",
  "kuaishou.com",
  "www.kuaishou.com",
];

function parseEnabledProviders() {
  const raw = process.env.VIDEO_PROVIDERS_ENABLED;
  if (!raw) return new Set(defaultEnabled);
  return new Set(
    raw
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  );
}

function parseAllowedDomains() {
  const raw = process.env.VIDEO_ALLOWED_DOMAINS;
  if (!raw) return new Set(defaultAllowedDomains);
  return new Set(
    raw
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  );
}

const enabledProviders = parseEnabledProviders();
const allowedDomains = parseAllowedDomains();

export const recommendationConfig = {
  enabledProviders,
  allowedDomains,
  defaultProviderTimeoutMs: Number(process.env.VIDEO_PROVIDER_TIMEOUT_MS || 900),
  validateAccessibility:
    process.env.VIDEO_VALIDATE_ACCESSIBILITY != null
      ? process.env.VIDEO_VALIDATE_ACCESSIBILITY !== "false"
      : process.env.NODE_ENV !== "test",
  validateMetadataStrict: process.env.VIDEO_VALIDATE_METADATA_STRICT !== "false",
  cacheTtlMs: Number(process.env.VIDEO_RECOMMEND_CACHE_TTL_MS || 30000),
  maxCandidatesPerProvider: Number(process.env.VIDEO_PROVIDER_MAX_CANDIDATES || 12),
  maxCandidatesForValidation: Number(process.env.VIDEO_VALIDATE_MAX_CANDIDATES || 10),
  maxConversationChars: Number(process.env.VIDEO_RECOMMEND_CONTEXT_CHARS || 2400),
  topN: Number(process.env.VIDEO_RECOMMEND_TOP_N || 3),
  minQualityScore: Number(process.env.VIDEO_RECOMMEND_MIN_QUALITY || 0.58),
  minMatchScore: Number(process.env.VIDEO_RECOMMEND_MIN_MATCH || 0.5),
  recentHistoryWindow: Number(process.env.VIDEO_RECENT_HISTORY_WINDOW || 9),
  providerFailureFallbackMin: Number(process.env.VIDEO_PROVIDER_FALLBACK_MIN || 1),
  weights: {
    youtube: Number(process.env.VIDEO_PROVIDER_WEIGHT_YOUTUBE || 1.3),
    bilibili: Number(process.env.VIDEO_PROVIDER_WEIGHT_BILIBILI || 0.6),
    vimeo: Number(process.env.VIDEO_PROVIDER_WEIGHT_VIMEO || 0.8),
    dailymotion: Number(process.env.VIDEO_PROVIDER_WEIGHT_DAILYMOTION || 0.55),
    douyin: Number(process.env.VIDEO_PROVIDER_WEIGHT_DOUYIN || 0.86),
    kuaishou: Number(process.env.VIDEO_PROVIDER_WEIGHT_KUAISHOU || 0.86),
    library: Number(process.env.VIDEO_PROVIDER_WEIGHT_LIBRARY || 1.1),
  },
  endpoints: {
    youtube: process.env.YOUTUBE_API_BASE_URL || "https://www.googleapis.com/youtube/v3/search",
    bilibili: process.env.BILIBILI_API_BASE_URL || "https://api.bilibili.com/x/web-interface/search/type",
    vimeo: process.env.VIMEO_API_BASE_URL || "https://api.vimeo.com/videos",
    dailymotion:
      process.env.DAILYMOTION_API_BASE_URL ||
      "https://api.dailymotion.com/videos",
    douyin: process.env.DOUYIN_API_BASE_URL || "",
    kuaishou: process.env.KUAISHOU_API_BASE_URL || "",
  },
  apiKeys: {
    youtube: process.env.YOUTUBE_API_KEY || "",
    bilibili: process.env.BILIBILI_API_KEY || "",
    vimeo: process.env.VIMEO_API_KEY || "",
    dailymotion: process.env.DAILYMOTION_API_KEY || "",
    douyin: process.env.DOUYIN_API_KEY || "",
    kuaishou: process.env.KUAISHOU_API_KEY || "",
  },
};

export function isProviderEnabled(id: string) {
  return enabledProviders.has(id.toLowerCase());
}
