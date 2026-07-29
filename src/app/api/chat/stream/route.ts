import { assertSession } from "@/features/auth/session.server";
import { runAgentOrchestration } from "@/lib/agent/orchestrator";
import { withRequestCookie } from "@/lib/data/supabase-db";
import {
  ChatSsePayloadMap,
  ChatStreamRequest,
  KnowledgeSourceRef,
  SseEventType,
} from "@/lib/domain/types";
import { normalizeChatHistory } from "@/lib/agent/history";

function sseLine<T extends SseEventType>(event: T, data: ChatSsePayloadMap[T]) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function isKnowledgeSourceRef(value: unknown): value is KnowledgeSourceRef {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as KnowledgeSourceRef).title === "string" &&
    ((value as KnowledgeSourceRef).source === "trick" || (value as KnowledgeSourceRef).source === "term")
  );
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
    const session = await assertSession(req);
    const body = (await req.json()) as ChatStreamRequest;

    if (!body?.userMessage || typeof body.userMessage !== "string") {
      return new Response("Missing userMessage", { status: 400 });
    }
    const attachmentIds = Array.isArray(body.attachmentIds)
      ? body.attachmentIds
          .filter(
            (attachmentId): attachmentId is string =>
              typeof attachmentId === "string" && attachmentId.trim().length > 0
          )
          .slice(0, 10)
      : [];

    // Capture cookies before entering the ReadableStream —
    // next/headers cookies() is unavailable inside the stream callback.
    const cookieHeader = req.headers.get("cookie") || "";

    const encoder = new TextEncoder();
    // Aborts the in-flight model call when the client stops reading the
    // stream (e.g. the user clicked "stop generating" and the fetch was
    // aborted, or the tab/connection closed).
    const abortController = new AbortController();
    const streamStartedAt = Date.now();
    const abortFromRequest = () => {
      if (abortController.signal.aborted) return;
      console.info("[chat-stream] request aborted", {
        threadId: body.threadId || null,
        durationMs: Date.now() - streamStartedAt,
      });
      abortController.abort(req.signal.reason);
    };
    if (req.signal.aborted) {
      abortFromRequest();
    } else {
      req.signal.addEventListener("abort", abortFromRequest, { once: true });
    }

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        await withRequestCookie(cookieHeader, async () => {
        const write = <T extends SseEventType>(event: T, payload: ChatSsePayloadMap[T]) => {
          // Once the client has disconnected there is nothing left to write
          // to — and the underlying controller may already be closed, so
          // enqueue can throw. Skip silently instead of crashing the request.
          if (abortController.signal.aborted) return;
          try {
            controller.enqueue(encoder.encode(sseLine(event, payload)));
          } catch (err) {
            console.warn("Failed to write SSE event", err);
          }
        };

        let threadEventSent = false;
        let streamedAnyToken = false;
        let threadIdFromCallback: string | null = null;
        const chatStartedAt = Date.now();
        let firstTokenLogged = false;

        try {
          const result = await runAgentOrchestration({
            threadId: body.threadId,
            userMessage: body.userMessage,
            locale: body.locale === "en" ? "en" : "zh",
            attachmentIds,
            clientHistory: normalizeChatHistory(body.clientHistory),
            responseMode: body.responseMode === "annotated" ? "annotated" : "plain",
            presetKnowledgeSources: Array.isArray(body.presetKnowledgeSources)
              ? body.presetKnowledgeSources.filter(isKnowledgeSourceRef).slice(0, 5)
              : undefined,
            userId: session.id,
            signal: abortController.signal,
            onThreadReady: (threadId, title) => {
              // Called once immediately with the placeholder title, and again
              // later (same thread, same still-open stream) if the
              // background short-title upgrade completes in time — write
              // every call so the client picks up the upgraded title.
              threadIdFromCallback = threadId;
              write("thread", {
                threadId,
                title,
                messageId: "pending",
              });
              threadEventSent = true;
            },
            onModelToken: (text) => {
              if (!text) return;
              if (!firstTokenLogged) {
                firstTokenLogged = true;
                console.info("Chat stream first token", {
                  durationMs: Date.now() - chatStartedAt,
                });
              }
              streamedAnyToken = true;
              write("token", { text });
            },
          });

          if (!threadEventSent) {
            write("thread", {
              threadId: threadIdFromCallback || result.threadId,
              title: result.threadTitle,
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
            knowledgeSources: result.output.knowledgeSources,
            annotatedText:
              body.responseMode === "annotated" ? result.output.text : undefined,
          });
          console.info("Chat stream completed", {
            provider: result.output.provider,
            durationMs: Date.now() - chatStartedAt,
          });
        } catch (error) {
          if (abortController.signal.aborted) {
            // The client stopped generation — this is expected, not a failure.
            console.info("Chat stream aborted by client");
          } else {
            const message = error instanceof Error ? error.message : "Unknown error";
            write("error", { message });
          }
        } finally {
          req.signal.removeEventListener("abort", abortFromRequest);
          try {
            controller.close();
          } catch {
            // Already closed/canceled from the client side — nothing to do.
          }
        }
        }); // withRequestCookie
      },
      cancel(reason) {
        console.info("[chat-stream] response canceled", {
          threadId: body.threadId || null,
          durationMs: Date.now() - streamStartedAt,
        });
        if (!abortController.signal.aborted) {
          abortController.abort(reason);
        }
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
