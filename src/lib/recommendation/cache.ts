import { VideoRecommendation } from "@/lib/domain/types";
import { recommendationConfig } from "@/lib/recommendation/config";

type CacheValue = {
  expiresAt: number;
  items: VideoRecommendation[];
};

export class RecommendationCache {
  private readonly map = new Map<string, CacheValue>();

  get(key: string) {
    const now = Date.now();
    const entry = this.map.get(key);
    if (!entry) return null;
    if (entry.expiresAt < now) {
      this.map.delete(key);
      return null;
    }
    return entry.items;
  }

  set(key: string, items: VideoRecommendation[]) {
    this.map.set(key, {
      expiresAt: Date.now() + recommendationConfig.cacheTtlMs,
      items,
    });
  }

  cleanup() {
    const now = Date.now();
    for (const [key, value] of Array.from(this.map.entries())) {
      if (value.expiresAt < now) this.map.delete(key);
    }
  }
}

export const recommendationCache = new RecommendationCache();
