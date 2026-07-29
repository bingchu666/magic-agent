import { describe, expect, it } from "vitest";
import {
  extractRequestedPageExcerpts,
  orderFileChunks,
  rankFileChunks,
} from "@/lib/agent/context";
import type { FileInsight } from "@/lib/domain/types";

function chunk(id: string, content: string): FileInsight {
  return {
    id,
    fileId: "file_1",
    userId: "user_1",
    kind: "key_points",
    locale: "en",
    content,
    createdAt: "2026-07-28T00:00:00.000Z",
  };
}

describe("attached file chunk ranking", () => {
  const chunks = [
    chunk("first", "Introduction and table of contents."),
    chunk("second", "A card routine using a wallet."),
    chunk("middle", "Close Calls uses the Ladanye cut sequence."),
    chunk("fourth", "Audience management notes."),
    chunk("last", "Closing acknowledgements and credits."),
  ];

  it("prioritizes excerpts that literally match a focused question", () => {
    expect(rankFileChunks(chunks, "Explain the Ladanye cut").map((item) => item.id)).toEqual([
      "middle",
      "first",
      "second",
    ]);
  });

  it("samples the whole document for a generic cross-language request", () => {
    expect(rankFileChunks(chunks, "请详细讲解这本书").map((item) => item.id)).toEqual([
      "first",
      "middle",
      "last",
    ]);
  });

  it.each([
    "告诉我第12页讲的什么",
    "讲解一下第十二页内容",
    "What does page 12 say?",
  ])("selects the chunk containing an explicitly requested PDF page: %s", (query) => {
    const pagedChunks = [
      chunk("opening", "[Pages 8-11]\nIntroduction."),
      chunk("page_12", "[Pages 12-17]\nForeword by Darwin Ortiz."),
      chunk("later", "[Pages 18-24]\nLater chapter."),
    ];

    expect(rankFileChunks(pagedChunks, query)[0]?.id).toBe("page_12");
  });

  it("understands Chinese page ranges and larger page numbers", () => {
    const pagedChunks = [
      chunk("range", "[Pages 12-14]\nRequested range."),
      chunk("page_250", "[Page 250]\nFinal PDF page."),
    ];

    expect(
      rankFileChunks(pagedChunks, "讲解第十二到十四页").map((item) => item.id)
    ).toEqual(["range"]);
    expect(rankFileChunks(pagedChunks, "第二百五十页讲什么")[0]?.id).toBe(
      "page_250"
    );
  });

  it("recovers an exact requested page from a legacy file preview", () => {
    const preview = [
      "[Page 11]",
      "Previous page.",
      "",
      "[Page 12]",
      "Foreword by Darwin Ortiz.",
      "",
      "[Page 13]",
      "Next page.",
    ].join("\n");

    expect(extractRequestedPageExcerpts(preview, [12])).toEqual([
      "[Page 12]\nForeword by Darwin Ortiz.",
    ]);
  });

  it("orders a full document index by PDF page instead of database row order", () => {
    const unordered = [
      chunk("late", "[Pages 141-142]\nLate pages."),
      chunk("opening", "[Pages 3-13]\nOpening pages."),
      chunk("middle", "[Pages 71-72]\nMiddle pages."),
    ];

    expect(orderFileChunks(unordered).map((item) => item.id)).toEqual([
      "opening",
      "middle",
      "late",
    ]);
  });
});
