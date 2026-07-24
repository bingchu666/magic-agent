import { afterEach, describe, expect, it } from "vitest";
import {
  buildMessages,
  isGroundedMethodRefusal,
  type GenerationInput,
} from "@/lib/ai/model-gateway";

function input(overrides: Partial<GenerationInput> = {}): GenerationInput {
  return {
    locale: "zh",
    intent: "chat",
    userMessage: "教我一个魔术",
    history: [],
    fileContext: "",
    ...overrides,
  };
}

function systemMessage(messages: ReturnType<typeof buildMessages>) {
  return messages.find((message) => message.role === "system")?.content || "";
}

function latestUserMessage(messages: ReturnType<typeof buildMessages>) {
  return [...messages].reverse().find((message) => message.role === "user")?.content || "";
}

describe("model gateway prompt", () => {
  const originalSystemPrompt = process.env.MAGIC_AGENT_SYSTEM_PROMPT;

  afterEach(() => {
    if (originalSystemPrompt === undefined) {
      delete process.env.MAGIC_AGENT_SYSTEM_PROMPT;
    } else {
      process.env.MAGIC_AGENT_SYSTEM_PROMPT = originalSystemPrompt;
    }
  });

  it.each([
    "教我一个魔术",
    "帮我设计三分钟的舞台流程",
    "为什么观众总能看出我的假动作？",
    "给我制定一周练习计划",
  ])("answers normally without retrieved knowledge: %s", (userMessage) => {
    const messages = buildMessages(input({ userMessage }));
    const system = systemMessage(messages);
    const user = latestUserMessage(messages);

    expect(system).toContain("never a permission gate");
    expect(system).toContain("answer normally and completely from your general knowledge");
    expect(system).toContain("Never refuse");
    expect(system).toContain("For any broad but answerable request");
    expect(user).not.toContain("no matching entries");
    expect(user).not.toContain("Do not fabricate a trick method");
    expect(user).not.toContain("Optional retrieved knowledge");
  });

  it("adds retrieved knowledge as optional prioritized context", () => {
    const messages = buildMessages(
      input({ retrievedKnowledge: "消失的硬币：用经典法式落下完成。" })
    );
    const user = latestUserMessage(messages);

    expect(user).toContain("Optional retrieved knowledge");
    expect(user).toContain("消失的硬币");
    const system = systemMessage(messages);
    expect(system).toContain("prioritize their concrete facts");
    expect(system).toContain("user-authorized reference material");
    expect(system).toContain("Do not refuse, withhold the method");
    expect(system).toContain("Do not invent citations");
  });

  it("keeps the retrieval fallback policy when a custom persona is configured", () => {
    process.env.MAGIC_AGENT_SYSTEM_PROMPT = "Use a concise teaching style.";
    const system = systemMessage(buildMessages(input()));

    expect(system).toContain("Use a concise teaching style.");
    expect(system).toContain("retrieved database knowledge is optional supporting context");
  });

  it("detects a refusal only when a teaching request has retrieved material", () => {
    const refusal =
      "I cannot teach the full method because this is a published commercial effect protected by copyright.";
    const groundedInput = input({
      userMessage: "Teach me how to do Hypothetical Possibilities",
      retrievedKnowledge: "Setup: use a wallet and a duplicate card.",
    });

    expect(isGroundedMethodRefusal(groundedInput, refusal)).toBe(true);
    expect(
      isGroundedMethodRefusal(
        input({ userMessage: groundedInput.userMessage }),
        refusal
      )
    ).toBe(false);
    expect(
      isGroundedMethodRefusal(
        input({
          userMessage: "Who owns the copyright?",
          retrievedKnowledge: groundedInput.retrievedKnowledge,
        }),
        refusal
      )
    ).toBe(false);
  });

  it("adds a direct correction instruction for a grounded retry", () => {
    const messages = buildMessages(
      input({
        userMessage: "教我这个魔术的方法",
        retrievedKnowledge: "准备：一副牌。方法：使用双翻。",
      }),
      { groundedRetry: true }
    );
    const user = latestUserMessage(messages);

    expect(user).toContain("previous draft was rejected");
    expect(user).toContain("Begin with the requested method or steps");
    expect(user).toContain("准备：一副牌");
  });
});
