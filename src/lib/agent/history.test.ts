import { describe, expect, it } from "vitest";
import { normalizeChatHistory, removeDuplicateCurrentUserTurn } from "@/lib/agent/history";

describe("conversation history", () => {
  it("preserves multiline assistant replies as one turn", () => {
    const history = normalizeChatHistory([
      { role: "user", content: "记住我的艺名是北辰" },
      { role: "assistant", content: "好的。\n你的艺名是北辰。\n我会在后续建议中使用它。" },
    ]);

    expect(history).toEqual([
      { role: "user", content: "记住我的艺名是北辰" },
      { role: "assistant", content: "好的。\n你的艺名是北辰。\n我会在后续建议中使用它。" },
    ]);
  });

  it("drops invalid roles and empty content", () => {
    const history = normalizeChatHistory([
      { role: "system", content: "untrusted" },
      { role: "assistant", content: "  " },
      { role: "user", content: "有效消息" },
    ]);

    expect(history).toEqual([{ role: "user", content: "有效消息" }]);
  });

  it("removes a duplicated current user turn", () => {
    const history = normalizeChatHistory([
      { role: "assistant", content: "上一轮回复" },
      { role: "user", content: "继续展开" },
    ]);

    expect(removeDuplicateCurrentUserTurn(history, "继续展开")).toEqual([
      { role: "assistant", content: "上一轮回复" },
    ]);
  });

  it("keeps the newest turns within configured bounds", () => {
    const history = normalizeChatHistory(
      [
        { role: "user", content: "old" },
        { role: "assistant", content: "middle" },
        { role: "user", content: "new" },
      ],
      { maxTurns: 2, maxTurnChars: 20, maxTotalChars: 20 }
    );

    expect(history).toEqual([
      { role: "assistant", content: "middle" },
      { role: "user", content: "new" },
    ]);
  });
});
