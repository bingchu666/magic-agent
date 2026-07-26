import { NextResponse } from "next/server";
import { assertSession } from "@/features/auth/session.server";
import { generateWithGateway } from "@/lib/ai/model-gateway";
import { Locale } from "@/lib/domain/types";

const EXPLORE_SYSTEM_PROMPT =
  "You are a rigorous interdisciplinary learning guide inside a hierarchical knowledge workspace. " +
  "Be concise, accurate, explicit about uncertainty, and do not force the discussion toward stage magic unless asked.";

type ExploreUtilityBody = {
  mode?: "preview" | "validate" | "summarize";
  locale?: Locale;
  term?: string;
  context?: string;
  understanding?: string;
  content?: string;
};

function clip(value: unknown, limit: number) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

export async function POST(req: Request) {
  try {
    await assertSession(req);
    const body = (await req.json()) as ExploreUtilityBody;
    const locale: Locale = body.locale === "en" ? "en" : "zh";
    let prompt = "";

    if (body.mode === "preview") {
      const term = clip(body.term, 160);
      if (!term) return NextResponse.json({ error: "Missing term" }, { status: 400 });
      prompt =
        locale === "zh"
          ? `用不超过100字解释术语“${term}”。先给一句直观定义，再说明它为什么与当前上下文有关。不要使用标题。\n\n当前上下文：${clip(body.context, 2200)}`
          : `Explain "${term}" in at most 80 words. Give an intuitive definition, then say why it matters in the current context. No heading.\n\nContext: ${clip(body.context, 2200)}`;
    } else if (body.mode === "validate") {
      const understanding = clip(body.understanding, 1800);
      if (!understanding) {
        return NextResponse.json({ error: "Missing understanding" }, { status: 400 });
      }
      prompt =
        locale === "zh"
          ? `校验用户对知识的理解是否准确。若核心理解准确，必须以“[认可]”开头；若存在关键错误，必须以“[需修正]”开头。随后只给一条具体反馈，不超过120字。\n\n参考内容：${clip(body.context, 3200)}\n\n用户理解：${understanding}`
          : `Validate the user's understanding. Start with "[Accepted]" if the core idea is accurate, otherwise start with "[Revise]". Then give one concrete note under 100 words.\n\nReference: ${clip(body.context, 3200)}\n\nUser understanding: ${understanding}`;
    } else if (body.mode === "summarize") {
      const content = clip(body.content, 9000);
      if (!content) return NextResponse.json({ error: "Missing content" }, { status: 400 });
      prompt =
        locale === "zh"
          ? `把下面的知识探索压缩成一份可复习的项目摘要：先用一句话写主线，再列出3至5条关键认识，最后写一个仍待回答的问题。总长度不超过350字。\n\n${content}`
          : `Turn the exploration below into a reviewable project summary: one sentence for the main line, 3–5 key insights, and one open question. Keep it under 250 words.\n\n${content}`;
    } else {
      return NextResponse.json({ error: "Unsupported mode" }, { status: 400 });
    }

    const result = await generateWithGateway({
      locale,
      intent: "analysis",
      userMessage: prompt,
      history: [],
      fileContext: "",
      systemPrompt: EXPLORE_SYSTEM_PROMPT,
    });

    return NextResponse.json({ text: result.text, provider: result.provider });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: message },
      { status: message === "UNAUTHORIZED" ? 401 : 500 }
    );
  }
}
