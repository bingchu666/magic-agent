import { assertSession } from "@/features/auth/session.server";
import { memoryDb } from "@/lib/data/memory-db";
import { jsonError, jsonOk } from "@/lib/ui/api";

export async function DELETE(req: Request, { params }: { params: { threadId: string } }) {
  try {
    const session = assertSession(req);
    const deleted = memoryDb.deleteThread(params.threadId, session.id);
    if (!deleted) {
      return jsonError("THREAD_NOT_FOUND", 404);
    }

    memoryDb.createEvent({
      userId: session.id,
      name: "thread_deleted",
      payload: {
        threadId: deleted.id,
      },
    });

    return jsonOk({ item: deleted });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    return jsonError(message, message === "UNAUTHORIZED" ? 401 : 500);
  }
}
