import { recommendationConfig } from "@/lib/recommendation/config";
import { VerifiedCandidate, VideoCandidate } from "@/lib/recommendation/types";

const TRACKING_QUERY_PREFIXES = ["utm_", "spm", "si", "from", "feature", "fbclid", "gclid"];

function isAllowedDomain(hostname: string) {
  const host = hostname.toLowerCase();
  if (recommendationConfig.allowedDomains.has(host)) return true;
  for (const allowed of Array.from(recommendationConfig.allowedDomains)) {
    if (host.endsWith(`.${allowed}`)) return true;
  }
  return false;
}

function parseUrl(raw: string) {
  const input = raw.trim();
  if (!input) return null;

  try {
    return new URL(input);
  } catch {
    try {
      return new URL(`https://${input}`);
    } catch {
      return null;
    }
  }
}

function normalizeYoutubeUrl(url: URL) {
  const host = url.hostname.toLowerCase();
  let videoId = "";

  if (host === "youtu.be") {
    videoId = url.pathname.replace(/^\//, "").trim();
  } else if (url.pathname.startsWith("/shorts/")) {
    videoId = url.pathname.split("/")[2] || "";
  } else {
    videoId = url.searchParams.get("v") || "";
  }

  if (!videoId) return null;
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function normalizeBilibiliUrl(url: URL) {
  const matched = url.pathname.match(/\/video\/(BV[0-9A-Za-z]+)/i);
  if (!matched?.[1]) return null;
  return `https://www.bilibili.com/video/${matched[1]}`;
}

function normalizeVimeoUrl(url: URL) {
  const matched = url.pathname.match(/\/(\d+)(?:\/)?$/);
  if (!matched?.[1]) return null;
  return `https://vimeo.com/${matched[1]}`;
}

function normalizeDailymotionUrl(url: URL) {
  const matched = url.pathname.match(/\/video\/([0-9A-Za-z]+)/);
  if (!matched?.[1]) return null;
  return `https://www.dailymotion.com/video/${matched[1]}`;
}

function stripTrackingQueries(url: URL) {
  const kept = new URL(url.toString());
  const keys = Array.from(kept.searchParams.keys());
  for (const key of keys) {
    const lowered = key.toLowerCase();
    if (TRACKING_QUERY_PREFIXES.some((prefix) => lowered === prefix || lowered.startsWith(prefix))) {
      kept.searchParams.delete(key);
    }
  }
  kept.hash = "";
  return kept;
}

export function normalizeVideoUrl(raw: string) {
  const url = parseUrl(raw);
  if (!url || !/^https?:$/.test(url.protocol)) return null;
  const host = url.hostname.toLowerCase();

  if (!isAllowedDomain(host)) return null;

  const stripped = stripTrackingQueries(url);

  if (host.includes("youtube.com") || host === "youtu.be") {
    return normalizeYoutubeUrl(stripped);
  }
  if (host.includes("bilibili.com")) {
    return normalizeBilibiliUrl(stripped);
  }
  if (host.includes("vimeo.com")) {
    return normalizeVimeoUrl(stripped);
  }
  if (host.includes("dailymotion.com")) {
    return normalizeDailymotionUrl(stripped);
  }

  return stripped.toString();
}

async function checkAccessible(url: string) {
  if (!recommendationConfig.validateAccessibility) return true;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const head = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      redirect: "follow",
      cache: "no-store",
    });
    if (head.ok) return true;

    const getRes = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      redirect: "follow",
      cache: "no-store",
    });
    return getRes.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function checkYoutubePlayable(url: string) {
  try {
    const endpoint = new URL("https://www.youtube.com/oembed");
    endpoint.searchParams.set("url", url);
    endpoint.searchParams.set("format", "json");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1200);
    try {
      const res = await fetch(endpoint.toString(), {
        method: "GET",
        signal: controller.signal,
        cache: "no-store",
      });
      return res.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return true;
  }
}

async function checkBilibiliPlayable(url: string) {
  const matched = url.match(/\/video\/(BV[0-9A-Za-z]+)/i);
  const bvid = matched?.[1];
  if (!bvid) return false;

  try {
    const endpoint = new URL("https://api.bilibili.com/x/web-interface/view");
    endpoint.searchParams.set("bvid", bvid);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1200);
    try {
      const res = await fetch(endpoint.toString(), {
        method: "GET",
        signal: controller.signal,
        cache: "no-store",
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { code?: number };
      return data?.code === 0;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return true;
  }
}

function hasValidMetadata(candidate: VideoCandidate) {
  if (candidate.title.trim().length < 2) return false;
  if (!Array.isArray(candidate.tags) || candidate.tags.length === 0) return false;
  if (!recommendationConfig.validateMetadataStrict) return true;
  return candidate.description.trim().length > 0;
}

export async function validateCandidate(candidate: VideoCandidate): Promise<VerifiedCandidate | null> {
  if (!hasValidMetadata(candidate)) return null;

  const normalized = normalizeVideoUrl(candidate.url);
  if (!normalized) return null;

  if (normalized.includes("youtube.com/watch")) {
    const playable = await checkYoutubePlayable(normalized);
    if (!playable) return null;
  }

  if (normalized.includes("bilibili.com/video/")) {
    const playable = await checkBilibiliPlayable(normalized);
    if (!playable) return null;
  }

  const ok = await checkAccessible(normalized);
  if (!ok) return null;

  return {
    ...candidate,
    verified: true,
    normalizedUrl: normalized,
    playableCheckedAt: new Date().toISOString(),
  };
}

export async function validateCandidates(
  candidates: VideoCandidate[],
  options?: { maxToCheck?: number }
) {
  const maxToCheck =
    typeof options?.maxToCheck === "number" && options.maxToCheck > 0
      ? Math.floor(options.maxToCheck)
      : candidates.length;
  const scoped = candidates.slice(0, maxToCheck);
  const verified = await Promise.all(scoped.map((item) => validateCandidate(item)));
  return verified.filter((item): item is VerifiedCandidate => Boolean(item));
}
