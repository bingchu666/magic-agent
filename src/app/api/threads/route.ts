import { jsonError, jsonOk } from "@/lib/ui/api";
import { assertSession } from "@/features/auth/session.server";
import { supabaseDb } from "@/lib/data/supabase-db";
import { naiveTitleFallback } from "@/lib/ai/model-gateway";

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
    let body: { title?: string; rawQuestion?: string; parentThreadId?: string; sourceTerm?: string } = {};
    try {
      body = (await req.json()) as {
        title?: string;
        rawQuestion?: string;
        parentThreadId?: string;
        sourceTerm?: string;
      };
    } catch {
      body = {};
    }

    // When the caller supplies the raw (possibly long) question, use an
    // immediate truncated placeholder so thread/card creation never waits on
    // a model call; the first chat turn on this thread upgrades it to a
    // short AI-generated title in the background (see runAgentOrchestration).
    // An explicit `title` (already short/meaningful, e.g. a branch's source
    // term) is used as-is and skips that upgrade entirely.
    const rawQuestion = typeof body.rawQuestion === "string" ? body.rawQuestion.trim() : "";
    const explicitTitle = typeof body.title === "string" ? body.title.trim() : "";
    const titlePending = Boolean(rawQuestion);
    const title = rawQuestion
      ? naiveTitleFallback(rawQuestion, session.locale)
      : explicitTitle || (session.locale === "zh" ? "新对话" : "New Thread");

    const parentThreadId =
      typeof body.parentThreadId === "string" && body.parentThreadId.trim()
        ? body.parentThreadId.trim()
        : null;
    const sourceTerm =
      typeof body.sourceTerm === "string" && body.sourceTerm.trim()
        ? body.sourceTerm.trim().slice(0, 160)
        : null;
    if (parentThreadId) {
      const parent = await supabaseDb.getThread(parentThreadId);
      if (!parent || parent.userId !== session.id) {
        return jsonError("PARENT_THREAD_NOT_FOUND", 404);
      }
    }

    const created = await supabaseDb.createThread(session.id, title, { titlePending });
    const thread = {
      ...created,
      parentThreadId,
      sourceTerm,
    };
    if (parentThreadId) {
      await supabaseDb.createEvent({
        userId: session.id,
        name: "thread_branch_created",
        payload: {
          childThreadId: thread.id,
          parentThreadId,
          sourceTerm,
        },
      });
    }
    await supabaseDb.createEvent({
      userId: session.id,
      name: "thread_created",
      payload: { threadId: thread.id, parentThreadId, sourceTerm },
    });
    return jsonOk({ item: thread }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    return jsonError(message, message === "UNAUTHORIZED" ? 401 : 500);
  }
}
