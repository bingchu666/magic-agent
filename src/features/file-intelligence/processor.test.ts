import { describe, expect, it } from "vitest";
import { chunkPages } from "@/features/file-intelligence/processor";

describe("PDF page chunking", () => {
  it("preserves individual page markers inside a multi-page chunk", () => {
    const chunks = chunkPages([
      { page: 10, text: "Ten" },
      { page: 11, text: "Eleven" },
      { page: 12, text: "Foreword by Darwin Ortiz" },
    ]);

    expect(chunks).toEqual([
      [
        "[Pages 10-12]",
        "[Page 10]",
        "Ten",
        "",
        "[Page 11]",
        "Eleven",
        "",
        "[Page 12]",
        "Foreword by Darwin Ortiz",
      ].join("\n"),
    ]);
  });
});
