import { assertSession } from "@/features/auth/session.server";
import { generateWithGatewayStream } from "@/lib/ai/model-gateway";
import { normalizeChatHistory } from "@/lib/agent/history";
import {
  extractKnowledgeSourceTitles,
  retrieveOptionalKnowledge,
} from "@/lib/agent/knowledge-retrieval";
import { supabaseDb } from "@/lib/data/supabase-db";
import { ChatHistoryMessage, Locale } from "@/lib/domain/types";

const EXPLORE_SYSTEM_PROMPT =
  "You are a rigorous interdisciplinary learning guide inside a hierarchical knowledge workspace. " +
  "Help the user understand unfamiliar subjects without losing the main line of reasoning. " +
  "Explain from first principles, distinguish facts from inference, use concrete examples, and surface useful relationships to adjacent concepts. " +
  "Do not force the discussion toward stage magic unless the user explicitly asks about it.";

type ExploreStreamBody = {
  question?: string;
  searchQuery?: string;
  locale?: Locale;
  history?: ChatHistoryMessage[];
  attachmentIds?: string[];
};

function sse(event: string, payload: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

export async function POST(req: Request) {
  try {
    const session = await assertSession(req);
    const body = (await req.json()) as ExploreStreamBody;
    const question = body.question?.trim();

    if (!question) {
      return new Response("Missing question", { status: 400 });
    }

    const locale: Locale = body.locale === "en" ? "en" : "zh";
    const attachmentIds = Array.isArray(body.attachmentIds)
      ? body.attachmentIds.filter((item): item is string => typeof item === "string").slice(0, 8)
      : [];
    const [insights, retrievedKnowledge] = await Promise.all([
      attachmentIds.length
        ? supabaseDb.listFileInsightsByIds(session.id, attachmentIds)
        : Promise.resolve([]),
      retrieveOptionalKnowledge({
        query: body.searchQuery?.trim() || question,
        search: (query) => supabaseDb.searchTrickChunks(query),
      }),
    ]);
    const knowledgeSources = extractKnowledgeSourceTitles(retrievedKnowledge);
    const fileContext = insights
      .map((insight) => `${insight.kind}: ${insight.content}`)
      .join("\n")
      .slice(-6000);

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const write = (event: string, payload: unknown) => {
          controller.enqueue(encoder.encode(sse(event, payload)));
        };

        try {
          const result = await generateWithGatewayStream(
            {
              locale,
              intent: "analysis",
              userMessage: question,
              history: normalizeChatHistory(body.history),
              fileContext,
              retrievedKnowledge,
              systemPrompt: EXPLORE_SYSTEM_PROMPT,
              responseFormatPrompt: knowledgeSources.length
                ? locale === "zh"
                  ? `本次已命中应用知识库。优先使用检索内容，并在回答末尾单独添加“知识库依据：${knowledgeSources.join("；")}”。只能列出这些真实标题。`
                  : `Use the matched app knowledge base and end with "Database grounding: ${knowledgeSources.join("; ")}". List only these exact titles.`
                : undefined,
            },
            (text) => {
              if (text) write("token", { text });
            }
          );

          write("done", {
            messageId: `explore_${Date.now()}`,
            provider: result.provider,
            recommendationRefreshed: false,
            refreshReason: "keep_previous",
            goalTopic: null,
            knowledgeSources,
          });
        } catch (error) {
          write("error", {
            message: error instanceof Error ? error.message : "Explore generation failed",
          });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(sse("error", { message }), {
      status: message === "UNAUTHORIZED" ? 401 : 500,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
      },
    });
  }
}
