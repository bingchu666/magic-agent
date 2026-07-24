import { assertSession } from "@/features/auth/session.server";
import { supabaseDb } from "@/lib/data/supabase-db";
import { jsonError, jsonOk } from "@/lib/ui/api";

export async function DELETE(req: Request, { params }: { params: Promise<{ threadId: string }> }) {
  try {
    const { threadId } = await params;
    const session = await assertSession(req);
    const deleted = await supabaseDb.deleteThread(threadId, session.id);
    if (!deleted) {
      return jsonError("THREAD_NOT_FOUND", 404);
    }

    await supabaseDb.createEvent({
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
