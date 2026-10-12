import { afterEach, describe, expect, it, vi } from "vitest";
import { buildContext } from "./context";
import { supabaseDb } from "@/lib/data/supabase-db";
import type { FileAsset, FileInsight } from "@/lib/domain/types";

const file: FileAsset = {
  id: "book-test", userId: "reader", fileName: "Practice Book.pdf",
  mimeType: "application/pdf", size: 500, status: "ready",
  storageKey: "fixture", createdAt: "2026-10-12", updatedAt: "2026-10-12",
  expiresAt: "2027-10-12",
};
const insight: FileInsight = {
  id: "text", fileId: file.id, userId: "reader", kind: "key_points", locale: "zh",
  content: "[Pages 1-2]\n[Page 1]\nPrepare three cards.\n\n[Page 2]\nPlace the marked card in the middle. Practice five times.",
  createdAt: "2026-10-12",
};
const params = {
  threadId: "reading-thread", userId: "reader", locale: "zh" as const,
  userMessage: "第二页应该如何练习？", attachmentIds: [file.id],
  clientHistory: [{ role: "user" as const, content: "阅读这本书" }],
};

afterEach(() => vi.restoreAllMocks());

describe("uploaded book grounding", () => {
  it("loads the owned document and page markers while keeping unrelated library knowledge out", async () => {
    const fileLookup = vi.spyOn(supabaseDb, "listFilesByIds").mockResolvedValue([file]);
    vi.spyOn(supabaseDb, "listFileInsightsByIds").mockResolvedValue([insight]);
    const trickSearch = vi.spyOn(supabaseDb, "searchTrickChunks");
    const termScan = vi.spyOn(supabaseDb, "listMagicTermsForScan");
    const personScan = vi.spyOn(supabaseDb, "listMagiciansForScan");
    const context = await buildContext(params);
    expect(fileLookup).toHaveBeenCalledWith("reader", [file.id]);
    expect(context.fileContext).toContain("Practice Book.pdf");
    expect(context.fileContext).toContain("[Page 2]");
    expect(context.fileContext).toContain("Practice five times");
    expect(context.retrievedKnowledge).toBe("");
    expect(trickSearch).not.toHaveBeenCalled();
    expect(termScan).not.toHaveBeenCalled();
    expect(personScan).not.toHaveBeenCalled();
  });

  it("blocks generation for a missing or other user's attachment", async () => {
    vi.spyOn(supabaseDb, "listFilesByIds").mockResolvedValue([]);
    vi.spyOn(supabaseDb, "listFileInsightsByIds").mockResolvedValue([]);
    await expect(buildContext(params)).rejects.toThrow("无权访问");
  });

  it("blocks an unfinished book instead of allowing a filename-based answer", async () => {
    vi.spyOn(supabaseDb, "listFilesByIds").mockResolvedValue([{ ...file, status: "processing" }]);
    vi.spyOn(supabaseDb, "listFileInsightsByIds").mockResolvedValue([]);
    await expect(buildContext(params)).rejects.toThrow("仍在解析");
  });
});
