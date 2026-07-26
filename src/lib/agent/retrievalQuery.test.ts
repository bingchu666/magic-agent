import { describe, expect, it } from "vitest";
import {
  endsWithQuestion,
  isLowInformationMessage,
  resolveRetrievalQuery,
} from "@/lib/agent/retrievalQuery";
import { ChatHistoryMessage } from "@/lib/domain/types";

describe("endsWithQuestion", () => {
  it("detects a trailing question mark", () => {
    expect(endsWithQuestion("要继续下一部分吗？")).toBe(true);
    expect(endsWithQuestion("Do you want to continue?")).toBe(true);
  });

  it("detects a trailing question particle without punctuation", () => {
    expect(endsWithQuestion("要继续吗")).toBe(true);
    expect(endsWithQuestion("你觉得呢")).toBe(true);
  });

  it("returns false for a plain statement", () => {
    expect(endsWithQuestion("这是第一部分的内容。")).toBe(false);
    expect(endsWithQuestion("Here is the setup.")).toBe(false);
  });

  it("returns false for empty input", () => {
    expect(endsWithQuestion("")).toBe(false);
    expect(endsWithQuestion("   ")).toBe(false);
  });
});

describe("isLowInformationMessage", () => {
  it("treats short acknowledgements as low information", () => {
    expect(isLowInformationMessage("继续")).toBe(true);
    expect(isLowInformationMessage("好的")).toBe(true);
    expect(isLowInformationMessage("新手")).toBe(true);
    expect(isLowInformationMessage("continue")).toBe(true);
  });

  it("treats long messages as substantive regardless of keywords", () => {
    expect(isLowInformationMessage("我想了解一下这个流程大概要多久")).toBe(false);
  });

  it("treats a short message with a concrete prop/trick keyword as substantive", () => {
    expect(isLowInformationMessage("纸牌")).toBe(false);
    expect(isLowInformationMessage("coin")).toBe(false);
  });

  it("treats empty input as low information", () => {
    expect(isLowInformationMessage("")).toBe(true);
    expect(isLowInformationMessage("   ")).toBe(true);
  });
});

function history(...turns: ChatHistoryMessage[]): ChatHistoryMessage[] {
  return turns;
}

describe("resolveRetrievalQuery", () => {
  it("uses the raw message when the previous reply was not a question", () => {
    const h = history(
      { role: "user", content: "教我一个纸牌魔术" },
      { role: "assistant", content: "这是设置部分的内容。" }
    );
    expect(resolveRetrievalQuery("继续", h)).toBe("继续");
  });

  it("uses the raw message when it is substantive, even after a question", () => {
    const h = history(
      { role: "user", content: "教我一个魔术" },
      { role: "assistant", content: "你想学纸牌魔术还是硬币魔术呢？" }
    );
    expect(resolveRetrievalQuery("我想学一个用橡皮筋的魔术", h)).toBe(
      "我想学一个用橡皮筋的魔术"
    );
  });

  it("falls back to the last substantive user turn for a short reply to a question", () => {
    const h = history(
      { role: "user", content: "教我一个纸牌魔术" },
      { role: "assistant", content: "好的，你的经验水平如何呢？" }
    );
    expect(resolveRetrievalQuery("新手", h)).toBe("教我一个纸牌魔术");
  });

  it("handles a 'continue' reply generically, same as any other short reply", () => {
    const h = history(
      { role: "user", content: "教我一个硬币魔术" },
      { role: "assistant", content: "这是第 1 部分，共约 3 部分。要继续下一部分吗？" }
    );
    expect(resolveRetrievalQuery("继续", h)).toBe("教我一个硬币魔术");
    expect(resolveRetrievalQuery("go on", h)).toBe("教我一个硬币魔术");
  });

  it("skips retrieval when no substantive prior user turn exists", () => {
    const h = history({ role: "assistant", content: "你的经验水平如何呢？" });
    expect(resolveRetrievalQuery("新手", h)).toBeNull();
  });

  it("skips substantive turns that came before the actual last substantive request", () => {
    const h = history(
      { role: "user", content: "教我一个纸牌魔术" },
      { role: "assistant", content: "好的。" },
      { role: "user", content: "教我一个硬币魔术" },
      { role: "assistant", content: "你的经验水平如何呢？" }
    );
    expect(resolveRetrievalQuery("新手", h)).toBe("教我一个硬币魔术");
  });

  it("returns null for an empty current message", () => {
    const h = history({ role: "assistant", content: "继续吗？" });
    expect(resolveRetrievalQuery("   ", h)).toBeNull();
  });
});
