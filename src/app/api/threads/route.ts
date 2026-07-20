import { jsonError, jsonOk } from "@/lib/ui/api";
import { assertSession } from "@/features/auth/session.server";
import { supabaseDb } from "@/lib/data/supabase-db";

export async function GET(req: Request) {
  try {
    const session = await assertSession(req);
    const threads = await supabaseDb.listThreads(session.id);
    return jsonOk({ items: threads });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    return jsonError(message, message === "UNAUTHORIZED" ? 401 : 500);
  }
}

export async function POST(req: Request) {
  try {
    const session = await assertSession(req);
    let body: { title?: string } = {};
    try {
      body = (await req.json()) as { title?: string };
    } catch {
      body = {};
    }
    const title = typeof body?.title === "string" && body.title.trim().length > 0
      ? body.title.trim()
      : session.locale === "zh"
      ? "新对话"
      : "New Thread";

    const thread = await supabaseDb.createThread(session.id, title);
    await supabaseDb.createEvent({
      userId: session.id,
      name: "thread_created",
      payload: { threadId: thread.id },
    });
    return jsonOk({ item: thread }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    return jsonError(message, message === "UNAUTHORIZED" ? 401 : 500);
  }
}
