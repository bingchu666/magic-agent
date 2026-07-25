import { assertSession } from "@/features/auth/session.server";
import { regenerateAssistantMessage } from "@/lib/agent/orchestrator";
import { supabaseDb } from "@/lib/data/supabase-db";
import { jsonError, jsonOk } from "@/lib/ui/api";

export async function POST(
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

    const result = await regenerateAssistantMessage({
      threadId: thread.id,
      messageId,
      userId: session.id,
    });

    if (!result.ok) {
      return jsonError(result.reason, result.reason === "NOT_FOUND" ? 404 : 400);
    }

    return jsonOk({ item: result.message });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    return jsonError(message, message === "UNAUTHORIZED" ? 401 : 500);
  }
}
