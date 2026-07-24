import { assertSession } from "@/features/auth/session.server";
import { runAgentOrchestration } from "@/lib/agent/orchestrator";
import { withRequestCookie } from "@/lib/data/supabase-db";
import { ChatSsePayloadMap, ChatStreamRequest, SseEventType } from "@/lib/domain/types";
import { normalizeChatHistory } from "@/lib/agent/history";

function sseLine<T extends SseEventType>(event: T, data: ChatSsePayloadMap[T]) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function chunkText(text: string) {
  const chunks: string[] = [];
  let acc = "";
  const pushAcc = () => {
    if (acc) {
      chunks.push(acc);
      acc = "";
    }
  };

  for (const ch of Array.from(text)) {
    acc += ch;
    const isBoundary = /[\s，。！？,.!?;；:：\n]/.test(ch);
    if (acc.length >= 26 && isBoundary) {
      pushAcc();
      continue;
    }
    if (acc.length >= 42) {
      pushAcc();
    }
  }

  pushAcc();
  return chunks;
}

export async function POST(req: Request) {
  try {
    console.time("chat/stream:assertSession");
    const session = await assertSession(req);
    console.timeEnd("chat/stream:assertSession");
    const body = (await req.json()) as ChatStreamRequest;

    if (!body?.userMessage || typeof body.userMessage !== "string") {
      return new Response("Missing userMessage", { status: 400 });
    }

    // Capture cookies before entering the ReadableStream —
    // next/headers cookies() is unavailable inside the stream callback.
    const cookieHeader = req.headers.get("cookie") || "";

    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        await withRequestCookie(cookieHeader, async () => {
        const write = <T extends SseEventType>(event: T, payload: ChatSsePayloadMap[T]) => {
          controller.enqueue(encoder.encode(sseLine(event, payload)));
        };

        let streamFailed = false;
        let threadEventSent = false;
        let streamedAnyToken = false;
        let threadIdFromCallback: string | null = null;

        try {
          const result = await runAgentOrchestration({
            threadId: body.threadId,
            userMessage: body.userMessage,
            locale: body.locale === "en" ? "en" : "zh",
            attachmentIds: Array.isArray(body.attachmentIds) ? body.attachmentIds : [],
            clientHistory: normalizeChatHistory(body.clientHistory),
            userId: session.id,
            onThreadReady: (threadId) => {
              threadIdFromCallback = threadId;
              if (threadEventSent) return;
              write("thread", {
                threadId,
                messageId: "pending",
              });
              threadEventSent = true;
            },
            onModelToken: (text) => {
              if (!text) return;
              streamedAnyToken = true;
              write("token", { text });
            },
          });

          if (!threadEventSent) {
            write("thread", {
              threadId: threadIdFromCallback || result.threadId,
              messageId: result.assistantMessage.id,
            });
            threadEventSent = true;
          }

          if (!streamedAnyToken) {
            const chunks = chunkText(result.output.text);
            chunks.forEach((text) => {
              write("token", { text });
            });
          }

          if (result.output.cards) {
            write("cards", result.output.cards);
          }

          write("done", {
            messageId: result.assistantMessage.id,
            provider: result.output.provider,
            recommendationRefreshed: result.output.recommendationRefreshed,
            refreshReason: result.output.refreshReason,
            goalTopic: result.output.goalTopic,
          });
        } catch (error) {
          streamFailed = true;
          const message = error instanceof Error ? error.message : "Unknown error";
          write("error", { message });
        } finally {
          if (!streamFailed) {
            controller.close();
          } else {
            controller.close();
          }
        }
        }); // withRequestCookie
      },
      cancel(reason) {
        console.warn("SSE canceled", reason);
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        Connection: "keep-alive",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(sseLine("error", { message }), {
      status: message === "UNAUTHORIZED" ? 401 : 500,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
      },
    });
  }
}
