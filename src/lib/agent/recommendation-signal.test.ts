import { describe, expect, it } from "vitest";
import { extractLearningSignal, hasLearningIntent, hasTopicShift } from "@/lib/agent/recommendation-signal";

describe("recommendation-signal", () => {
  it("does not treat greetings as learning intent", () => {
    expect(hasLearningIntent("你好")).toBe(false);
    expect(hasLearningIntent("hello")).toBe(false);
    expect(hasLearningIntent("你的名字是")).toBe(false);
  });

  it("detects learning intent and goal topic", () => {
    const signal = extractLearningSignal("我想练纸牌双翻");
    expect(signal.hasLearningIntent).toBe(true);
    expect(signal.goalTopic).toBe("纸牌魔术");
    expect(signal.learningRequestType).toBe("practice");
  });

  it("detects topic shift", () => {
    expect(hasTopicShift("纸牌魔术", "硬币魔术")).toBe(true);
    expect(hasTopicShift("纸牌魔术", "纸牌魔术")).toBe(false);
  });
});
