import { assertSession } from "@/features/auth/session.server";
import { runAgentOrchestration } from "@/lib/agent/orchestrator";
import { withRequestCookie } from "@/lib/data/supabase-db";
import { normalizeChatHistory } from "@/lib/agent/history";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const session = await assertSession(req);
    const body = (await req.json()) as {
      messages: Array<{ role: "user" | "assistant"; content: string }>;
      locale: "zh" | "en";
    };

    const { messages, locale } = body;

    if (!messages || messages.length < 2) {
      return NextResponse.json({ questions: [] }, { status: 200 });
    }

    // 只取最近 4 轮对话（最多 8 条消息）
    const recentMessages = messages.slice(-8);

    // 构造提示词
    const systemPrompt =
      locale === "zh"
        ? `你是一个魔术知识助手。请根据用户和助手最近的对话历史，生成 3 个用户可能想继续追问的相关问题。

要求：
1. 问题要简短、口语化，像真人提问一样，控制在 15 个字以内。
2. 必须和当前对话主题紧密相关。
3. 只输出一个 JSON 字符串数组，不要有其他文字。
4. 问题要多样，不要重复。

例如：["什么是魔术的错引？", "这个手法有变种吗？", "适合初学者练习吗？"]`

        : `You are a magic knowledge assistant. Based on the recent conversation history, generate 3 follow-up questions the user might want to ask.

Requirements:
1. Keep questions short and conversational, under 15 words.
2. Must be closely related to the current conversation topic.
3. Output only a JSON string array, no other text.
4. Questions should be diverse, no duplicates.

Example: ["What is misdirection in magic?", "Are there variations of this technique?", "Is it suitable for beginners?"]`;

    // 构造用户消息
    const userPrompt =
      locale === "zh"
        ? "请根据以上对话，生成 3 个相关问题。"
        : "Please generate 3 related questions based on the above conversation.";

    // 把历史消息格式化
    const formattedHistory = recentMessages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    // 组合完整消息列表
    const fullMessages = [
      { role: "system" as const, content: systemPrompt },
      ...formattedHistory,
      { role: "user" as const, content: userPrompt },
    ];

    // 获取 cookie
    const cookieHeader = req.headers.get("cookie") || "";

    let generatedText = "";

    // 复用 runAgentOrchestration 来生成建议问题
    // 注意：这里我们不需要真实的 threadId，传一个临时 ID
    await withRequestCookie(cookieHeader, async () => {
      const result = await runAgentOrchestration({
        threadId: `suggestions_${Date.now()}`,
        userMessage: fullMessages.map((m) => `${m.role}: ${m.content}`).join("\n"),
        locale: locale === "en" ? "en" : "zh",
        attachmentIds: [],
        clientHistory: normalizeChatHistory([]),
        responseMode: "plain",
        userId: session.id,
        signal: new AbortController().signal,
        onThreadReady: () => {},
        onModelToken: (text) => {
          generatedText += text;
        },
      });

      // 如果 onModelToken 没有收集到内容，用 result.output.text 兜底
      if (!generatedText) {
        generatedText = result.output.text;
      }
    });

    // 解析 AI 返回的 JSON
    let questions: string[] = [];
    try {
      // 清理可能的 Markdown 代码块标记
      const cleaned = generatedText.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) {
        questions = parsed.slice(0, 3);
      }
    } catch {
      // 如果解析失败，尝试从文本中提取问题（正则）
      const matches = generatedText.match(/["']([^"']+)["']/g);
      if (matches) {
        questions = matches.map((m) => m.replace(/["']/g, "")).slice(0, 3);
      } else {
        // 如果都失败，返回空数组
        questions = [];
      }
    }

    return NextResponse.json({ questions });
  } catch (error) {
    console.error("Failed to generate suggestions:", error);
    return NextResponse.json(
      { questions: [], error: "Failed to generate suggestions" },
      { status: 500 }
    );
  }
}