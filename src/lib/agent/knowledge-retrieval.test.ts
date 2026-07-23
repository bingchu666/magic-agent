import { afterEach, describe, expect, it, vi } from "vitest";
import { retrieveOptionalKnowledge } from "@/lib/agent/knowledge-retrieval";

describe("retrieveOptionalKnowledge", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns empty context when retrieval fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(
      retrieveOptionalKnowledge({
        query: "任意用户问题",
        search: async () => {
          throw new Error("embedding provider unavailable");
        },
      })
    ).resolves.toBe("");
  });

  it("does not hold up the answer path when retrieval is slow", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const startedAt = Date.now();

    const result = await retrieveOptionalKnowledge({
      query: "任意用户问题",
      timeoutMs: 10,
      search: () => new Promise(() => undefined),
    });

    expect(result).toBe("");
    expect(Date.now() - startedAt).toBeLessThan(200);
  });

  it("returns empty context when no result is relevant", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const result = await retrieveOptionalKnowledge({
      query: "如何改善舞台节奏",
      minSimilarity: 0.5,
      search: async () => [
        { title: "无关条目", content: "无关内容", similarity: 0.12 },
        { title: "缺少分数", content: "不能证明相关" },
      ],
    });

    expect(result).toBe("");
  });

  it("passes only relevant results into the optional context", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const result = await retrieveOptionalKnowledge({
      query: "硬币消失",
      minSimilarity: 0.5,
      search: async () => [
        { title: "纸牌控制", content: "不相关内容", similarity: 0.2 },
        { title: "法式落下", content: "硬币保留在原手。", similarity: 0.82 },
      ],
    });

    expect(result).toBe("法式落下：\n硬币保留在原手。");
    expect(result).not.toContain("纸牌控制");
    expect(info).toHaveBeenCalledWith(
      "Optional knowledge retrieval hit",
      expect.objectContaining({ matches: 1 })
    );
  });
});
