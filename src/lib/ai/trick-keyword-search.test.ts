import { describe, expect, it } from "vitest";
import { buildTrickKeywordPlan, rankKeywordTricks } from "@/lib/ai/trick-keyword-search";

describe("trick keyword search", () => {
  it("maps Chinese prop and effect terms to English database keywords", () => {
    const plan = buildTrickKeywordPlan("教我一个硬币消失魔术");

    expect(plan.terms).toEqual(expect.arrayContaining(["coin", "vanish"]));
    expect(plan.broadMagicRequest).toBe(false);
  });

  it("recognizes a broad magic request without tying it to one exact phrase", () => {
    expect(buildTrickKeywordPlan("我想学点魔术").broadMagicRequest).toBe(true);
    expect(buildTrickKeywordPlan("show me a magic trick").broadMagicRequest).toBe(true);
    expect(buildTrickKeywordPlan("你好").broadMagicRequest).toBe(false);
  });

  it("ranks matching entries and formats them as optional knowledge", () => {
    const rows = rankKeywordTricks(
      [
        { id: "1", title: "Coin Vanish", method_summary: "A coin appears to vanish.", difficulty: "beginner" },
        { id: "2", title: "Card Control", method_summary: "Control a selected card.", difficulty: "beginner" },
      ],
      ["coin", "vanish"],
      2
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: "Coin Vanish", searchMode: "keyword" });
  });
});
