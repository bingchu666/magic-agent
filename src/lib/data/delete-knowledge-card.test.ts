import { describe, expect, it, vi } from "vitest";
import { deleteCardBeforeThread } from "@/lib/data/delete-knowledge-card";

describe("deleteCardBeforeThread", () => {
  it("removes the restricting card before its referenced thread", async () => {
    const calls: string[] = [];

    await deleteCardBeforeThread({
      deleteCard: async () => {
        calls.push("card");
      },
      deleteThread: async () => {
        calls.push("thread");
      },
    });

    expect(calls).toEqual(["card", "thread"]);
  });

  it("reports cleanup errors without failing an already successful deletion", async () => {
    const onThreadCleanupError = vi.fn();

    await expect(
      deleteCardBeforeThread({
        deleteCard: async () => undefined,
        deleteThread: async () => {
          throw new Error("thread cleanup failed");
        },
        onThreadCleanupError,
      })
    ).resolves.toBeUndefined();
    expect(onThreadCleanupError).toHaveBeenCalledOnce();
  });

  it("still fails when the card itself cannot be deleted", async () => {
    const deleteThread = vi.fn();

    await expect(
      deleteCardBeforeThread({
        deleteCard: async () => {
          throw new Error("card delete failed");
        },
        deleteThread,
      })
    ).rejects.toThrow("card delete failed");
    expect(deleteThread).not.toHaveBeenCalled();
  });
});
