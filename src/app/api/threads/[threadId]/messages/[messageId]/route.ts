import { assertSession } from "@/features/auth/session.server";
import { supabaseDb } from "@/lib/data/supabase-db";
import { jsonError, jsonOk } from "@/lib/ui/api";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ threadId: string; messageId: string }> }
) {
  try {
    const { threadId, messageId } = await params;
    const session = await assertSession(req);
    const thread = await supabaseDb.getThread(threadId);
    if (!thread || thread.userId !== session.id) {
      return jsonError("THREAD_NOT_FOUND", 404);
    }

    const body = (await req.json().catch(() => null)) as { content?: unknown } | null;
    const content = typeof body?.content === "string" ? body.content.trim() : "";
    if (!content) {
      return jsonError("Missing content", 400);
    }

    const result = await supabaseDb.editMessageAndTruncate({
      threadId: thread.id,
      messageId,
      content,
    });

    if (!result.ok) {
      return jsonError(result.reason, result.reason === "NOT_FOUND" ? 404 : 400);
    }

    return jsonOk({ item: result.message, deletedMessageIds: result.deletedMessageIds });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    return jsonError(message, message === "UNAUTHORIZED" ? 401 : 500);
  }
}
