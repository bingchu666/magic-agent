import { describe, expect, it } from "vitest";
import { normalizeVideoUrl, validateCandidate } from "@/lib/recommendation/validator";

describe("normalizeVideoUrl", () => {
  it("normalizes youtube tracking url", () => {
    const normalized = normalizeVideoUrl(
      "https://www.youtube.com/watch?v=abc123&utm_source=test"
    );

    expect(normalized).toBe("https://www.youtube.com/watch?v=abc123");
  });

  it("rejects unknown domain", () => {
    const normalized = normalizeVideoUrl("https://example.com/video/abc");
    expect(normalized).toBeNull();
  });
});

describe("validateCandidate", () => {
  it("accepts candidate with required metadata", async () => {
    const verified = await validateCandidate({
      id: "youtube:dQw4w9WgXcQ",
      source: "youtube",
      title: "Card control basics",
      description: "Beginner card control drill",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&utm_medium=feed",
      tags: ["cards", "practice"],
      difficulty: "beginner",
      language: "en",
      rawScore: 0.5,
    });

    expect(verified?.verified).toBe(true);
    expect(verified?.normalizedUrl).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });
});
