import { assertSession } from "@/features/auth/session.server";
import { supabaseDb } from "@/lib/data/supabase-db";
import { jsonError, jsonOk } from "@/lib/ui/api";

export async function GET(req: Request, { params }: { params: Promise<{ threadId: string }> }) {
  try {
    const { threadId } = await params;
    const session = await assertSession(req);
    const thread = await supabaseDb.getThread(threadId);
    if (!thread || thread.userId !== session.id) {
      return jsonError("THREAD_NOT_FOUND", 404);
    }

    const messages = await supabaseDb.listMessages(thread.id);
    return jsonOk({ items: messages });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Unauthorized", 401);
  }
}
