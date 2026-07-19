import { ChatSsePayloadMap, SseEventType } from "@/lib/domain/types";

type Handlers = {
  [K in SseEventType]?: (payload: ChatSsePayloadMap[K]) => void;
};

export async function consumeSseStream(
  response: Response,
  handlers: Handlers
): Promise<void> {
  if (!response.body) {
    throw new Error("Streaming body is empty");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

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
}
