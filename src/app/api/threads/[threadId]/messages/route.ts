import { assertSession } from "@/features/auth/session.server";
import { memoryDb } from "@/lib/data/memory-db";
import { jsonError, jsonOk } from "@/lib/ui/api";

export async function GET(req: Request, { params }: { params: { threadId: string } }) {
  try {
    const session = assertSession(req);
    const thread = await memoryDb.getThread(params.threadId);
    if (!thread || thread.userId !== session.id) {
      return jsonError("THREAD_NOT_FOUND", 404);
    }

    const messages = await memoryDb.listMessages(thread.id);
    return jsonOk({ items: messages });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Unauthorized", 401);
  }
}
