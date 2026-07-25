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

    const body = (await req.json().catch(() => null)) as { activeVersionIndex?: unknown } | null;
    const activeVersionIndex = typeof body?.activeVersionIndex === "number" ? body.activeVersionIndex : NaN;
    if (!Number.isInteger(activeVersionIndex)) {
      return jsonError("Invalid activeVersionIndex", 400);
    }

    const result = await supabaseDb.setActiveMessageVersion({
      threadId: thread.id,
      messageId,
      activeVersionIndex,
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
