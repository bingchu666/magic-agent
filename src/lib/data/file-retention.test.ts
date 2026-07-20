import { describe, expect, it } from "vitest";
import { memoryDb, resetMemoryDbForTests } from "@/lib/data/memory-db";

describe("file retention", () => {
  it("marks expired files when retention window passed", async () => {
    resetMemoryDbForTests();
    await memoryDb.ensureUser({
      id: "u_test",
      name: "Tester",
      role: "user",
      locale: "zh",
    });

    const file = await memoryDb.createFileAsset({
      userId: "u_test",
      fileName: "notes.txt",
      mimeType: "text/plain",
      size: 16,
      storageKey: "uploads/u_test/notes.txt",
    });

    await memoryDb.updateFile(file.id, {
      status: "ready",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });

    const files = await memoryDb.listFiles("u_test");
    expect(files[0].status).toBe("expired");
  });
});
