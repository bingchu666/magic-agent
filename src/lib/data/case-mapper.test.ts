import { describe, expect, it } from "vitest";
import { fromDatabaseRow, fromDatabaseRows, toDatabaseRow } from "@/lib/data/case-mapper";

describe("database case mapper", () => {
  it("maps database fields to camelCase while preserving nested JSON payloads", () => {
    expect(fromDatabaseRow({
      thread_id: "thread_1",
      created_at: "2026-07-22T00:00:00.000Z",
      payload: { threadId: "thread_1", recommendationIds: ["video_1"] },
    })).toEqual({
      threadId: "thread_1",
      createdAt: "2026-07-22T00:00:00.000Z",
      payload: { threadId: "thread_1", recommendationIds: ["video_1"] },
    });
  });

  it("maps arrays and treats non-arrays as empty query results", () => {
    expect(fromDatabaseRows([{ user_id: "user_1" }, { user_id: "user_2" }])).toEqual([
      { userId: "user_1" },
      { userId: "user_2" },
    ]);
    expect(fromDatabaseRows(null)).toEqual([]);
  });

  it("maps domain updates to snake_case and drops undefined fields", () => {
    expect(toDatabaseRow({
      previewText: "preview",
      summaryZh: undefined,
      payload: { goalTopic: "cards" },
    })).toEqual({
      preview_text: "preview",
      payload: { goalTopic: "cards" },
    });
  });
});
