import { describe, expect, it } from "vitest";
import { detectIntent } from "@/lib/agent/intent";

describe("detectIntent", () => {
  it("detects translation intent", () => {
    expect(detectIntent("请翻译这段英文")).toBe("translation");
    expect(detectIntent("translate this to chinese")).toBe("translation");
  });

  it("uses natural chat as default, including teaching asks", () => {
    expect(detectIntent("教我一个纸牌流程")).toBe("chat");
    expect(detectIntent("give me a card routine")).toBe("chat");
    expect(detectIntent("你好，今天练什么")).toBe("chat");
  });
});
