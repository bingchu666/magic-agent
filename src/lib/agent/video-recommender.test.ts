import { describe, expect, it } from "vitest";
import { recommendVideos } from "@/lib/agent/video-recommender";
import { memoryDb, resetMemoryDbForTests } from "@/lib/data/memory-db";

function seedVerifiedVideo() {
  memoryDb.ensureUser({
    id: "admin_seed",
    name: "Admin Seed",
    role: "admin",
    locale: "en",
  });
  const video = memoryDb.createVideo({
    createdBy: "admin_seed",
    title: "Card double lift timing drill",
    description: "Beginner card training with rhythm checkpoints.",
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    language: "en",
    difficulty: "beginner",
    tags: ["cards", "practice", "double-lift"],
  });
  memoryDb.publishVideo(video.id);
}

describe("recommendVideos", () => {
  it("returns up to 3 recommendations", async () => {
    resetMemoryDbForTests();
    seedVerifiedVideo();
    const items = await recommendVideos({
      userMessage: "I want a beginner card opener",
      locale: "en",
      topK: 20,
    });

    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThanOrEqual(3);
  });

  it("prefers beginner when explicitly requested", async () => {
    resetMemoryDbForTests();
    seedVerifiedVideo();
    const items = await recommendVideos({
      userMessage: "beginner cards practice",
      locale: "en",
      topK: 20,
    });

    expect(items[0]?.difficulty).toBe("beginner");
  });
});
