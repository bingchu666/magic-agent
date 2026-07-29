import { describe, expect, it, vi } from "vitest";

import { consumeSseStream } from "@/features/chat-agent/sse";

describe("consumeSseStream", () => {
  it("cancels the response reader and rejects with AbortError when generation stops", async () => {
    const canceled = vi.fn();
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode('event: token\ndata: {"text":"partial"}\n\n')
          );
        },
        cancel(reason) {
          canceled(reason);
        },
      })
    );
    const controller = new AbortController();
    const received: string[] = [];

    const consuming = consumeSseStream(
      response,
      {
        token: ({ text }) => received.push(text),
      },
      { signal: controller.signal }
    );

    await vi.waitFor(() => expect(received).toEqual(["partial"]));
    controller.abort("user-stop");

    await expect(consuming).rejects.toMatchObject({ name: "AbortError" });
    expect(canceled).toHaveBeenCalledWith("user-stop");
  });
});
