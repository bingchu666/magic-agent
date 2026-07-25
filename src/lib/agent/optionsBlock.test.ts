import { describe, expect, it } from "vitest";
import { extractQuickOptions } from "@/lib/agent/optionsBlock";

describe("extractQuickOptions", () => {
  it("extracts a well-formed options block and strips it from the content", () => {
    const content =
      '好的，我们先了解一下你的情况。\n\n```options\n{"question": "你的经验水平如何？", "options": ["新手", "有一些基础", "熟练"]}\n```';

    const result = extractQuickOptions(content);

    expect(result.quickOptions).toEqual({
      question: "你的经验水平如何？",
      options: ["新手", "有一些基础", "熟练"],
    });
    expect(result.cleanedContent).toBe("好的，我们先了解一下你的情况。");
    expect(result.cleanedContent).not.toContain("```");
    expect(result.cleanedContent).not.toContain("question");
  });

  it("returns the content unchanged when there is no options block", () => {
    const content = "这是一段普通的说明文字，没有任何代码块。";
    const result = extractQuickOptions(content);

    expect(result.quickOptions).toBeNull();
    expect(result.cleanedContent).toBe(content);
  });

  it("falls back to plain text when the JSON is malformed", () => {
    const content = "说明文字。\n\n```options\n{question: not valid json,,,}\n```";
    const result = extractQuickOptions(content);

    expect(result.quickOptions).toBeNull();
    expect(result.cleanedContent).toBe(content);
  });

  it("falls back to plain text when required fields are missing", () => {
    const content = '说明文字。\n\n```options\n{"question": "标题"}\n```';
    const result = extractQuickOptions(content);

    expect(result.quickOptions).toBeNull();
    expect(result.cleanedContent).toBe(content);
  });

  it("falls back to plain text when there are fewer than two options", () => {
    const content = '说明文字。\n\n```options\n{"question": "标题", "options": ["只有一个"]}\n```';
    const result = extractQuickOptions(content);

    expect(result.quickOptions).toBeNull();
  });

  it("ignores unrelated fenced code blocks", () => {
    const content = '这是一个例子：\n\n```js\nconsole.log("hi");\n```';
    const result = extractQuickOptions(content);

    expect(result.quickOptions).toBeNull();
    expect(result.cleanedContent).toBe(content);
  });

  it("stays null while the block is still streaming in (unclosed fence)", () => {
    const content = '说明文字。\n\n```options\n{"question": "标题", "options": ["a"';
    const result = extractQuickOptions(content);

    expect(result.quickOptions).toBeNull();
    expect(result.cleanedContent).toBe(content);
  });

  it("trims non-string and blank entries out of the options array", () => {
    const content =
      '说明文字。\n\n```options\n{"question": "选一个", "options": ["A", "", 42, "B", "  "]}\n```';
    const result = extractQuickOptions(content);

    expect(result.quickOptions).toEqual({ question: "选一个", options: ["A", "B"] });
  });
});
