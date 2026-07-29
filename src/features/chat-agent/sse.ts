import { ChatSsePayloadMap, SseEventType } from "@/lib/domain/types";

type Handlers = {
  [K in SseEventType]?: (payload: ChatSsePayloadMap[K]) => void;
};

export async function consumeSseStream(
  response: Response,
  handlers: Handlers,
  options: { signal?: AbortSignal } = {}
): Promise<void> {
  if (!response.body) {
    throw new Error("Streaming body is empty");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const abortError = () => new DOMException("Generation stopped", "AbortError");
  const cancelReader = () => {
    void reader.cancel(options.signal?.reason).catch(() => {
      // An aborted fetch can error the body before cancel() settles.
    });
  };

  if (options.signal?.aborted) {
    cancelReader();
    throw abortError();
  }
  options.signal?.addEventListener("abort", cancelReader, { once: true });

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";

      for (const block of chunks) {
        const lines = block.split("\n");
        const eventLine = lines.find((line) => line.startsWith("event:"));
        const dataLine = lines.find((line) => line.startsWith("data:"));

        if (!eventLine || !dataLine) continue;

        const event = eventLine.replace("event:", "").trim() as SseEventType;
        const payloadText = dataLine.replace("data:", "").trim();
        if (!payloadText) continue;

        try {
          const payload = JSON.parse(payloadText) as ChatSsePayloadMap[typeof event];
          const handler = handlers[event] as ((value: typeof payload) => void) | undefined;
          if (handler) handler(payload);
        } catch (error) {
          console.warn("Failed to parse SSE payload", error);
        }
      }
    }
  } catch (error) {
    if (options.signal?.aborted) throw abortError();
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", cancelReader);
  }

  // reader.cancel() resolves a pending read with done=true in some browsers,
  // so explicitly preserve AbortError semantics for the caller.
  if (options.signal?.aborted) throw abortError();
}
