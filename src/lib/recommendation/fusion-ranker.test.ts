import { describe, expect, it } from "vitest";
import { resetMemoryDbForTests } from "@/lib/data/memory-db";
import { rankAndFuseRecommendations } from "@/lib/recommendation/fusion-ranker";

describe("rankAndFuseRecommendations", () => {
  it("dedupes by normalized url and keeps diversified sources", async () => {
    resetMemoryDbForTests();

    const items = await rankAndFuseRecommendations({
      locale: "zh",
      userId: "u1",
      threadId: "t1",
      userMessage: "我想练纸牌开场",
      conversationText: "user: 我想练纸牌",
      providerWeights: {
        youtube: 1,
        bilibili: 1,
        library: 1,
      },
      limit: 3,
      candidates: [
        {
          id: "youtube:a",
          source: "youtube",
          title: "Card opener basics",
          description: "card opener routine",
          url: "https://www.youtube.com/watch?v=a",
          normalizedUrl: "https://www.youtube.com/watch?v=a",
          tags: ["cards", "opener"],
          difficulty: "beginner",
          language: "en",
          verified: true,
          playableCheckedAt: "2026-01-01T00:00:00.000Z",
          rawScore: 0.8,
        },
        {
          id: "bilibili:same",
          source: "bilibili",
          title: "Card opener basics mirror",
          description: "same clip mirrored",
          url: "https://www.youtube.com/watch?v=a",
          normalizedUrl: "https://www.youtube.com/watch?v=a",
          tags: ["cards", "opener"],
          difficulty: "beginner",
          language: "zh",
          verified: true,
          playableCheckedAt: "2026-01-01T00:00:00.000Z",
          rawScore: 0.79,
        },
        {
          id: "youtube:b",
          source: "youtube",
          title: "Card pacing drill",
          description: "practice card routine",
          url: "https://www.youtube.com/watch?v=b",
          normalizedUrl: "https://www.youtube.com/watch?v=b",
          tags: ["cards", "practice"],
          difficulty: "beginner",
          language: "en",
          verified: true,
          playableCheckedAt: "2026-01-01T00:00:00.000Z",
          rawScore: 0.75,
        },
        {
          id: "library:c",
          source: "library",
          title: "纸牌开场控场训练",
          description: "中文纸牌练习",
          url: "https://www.bilibili.com/video/BV1bV41117qv",
          normalizedUrl: "https://www.bilibili.com/video/BV1bV41117qv",
          tags: ["cards", "opener", "practice"],
          difficulty: "beginner",
          language: "zh",
          verified: true,
          playableCheckedAt: "2026-01-01T00:00:00.000Z",
          rawScore: 0.7,
        },
      ],
    });

    expect(items.length).toBeGreaterThan(0);
    const sources = new Set(items.map((item) => item.source));
    expect(sources.size).toBeGreaterThan(1);
    expect(items.filter((item) => item.url === "https://www.youtube.com/watch?v=a").length).toBe(1);
  });
});
