import { assertSession } from "@/features/auth/session.server";
import { supabaseDb } from "@/lib/data/supabase-db";
import { CardRelation } from "@/lib/domain/types";
import { jsonError, jsonOk } from "@/lib/ui/api";

function asRelation(input: unknown): CardRelation | undefined {
  if (input === "root" || input === "child" || input === "related" || input === "branch") return input;
  return undefined;
}

export async function GET(req: Request) {
  try {
    const session = await assertSession(req);
    const cards = await supabaseDb.listKnowledgeCards(session.id);
    return jsonOk({ items: cards });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    return jsonError(message, message === "UNAUTHORIZED" ? 401 : 500);
  }
}

export async function POST(req: Request) {
  try {
    const session = await assertSession(req);
    let body: {
      id?: string;
      threadId?: string;
      parentId?: string;
      folderId?: string;
      relation?: CardRelation;
      title?: string;
      question?: string;
    } = {};
    try {
      body = (await req.json()) as typeof body;
    } catch {
      body = {};
    }

    const relation = asRelation(body.relation);
    if (!relation) return jsonError("RELATION_REQUIRED", 400);

    const parentId = typeof body.parentId === "string" && body.parentId.trim() ? body.parentId.trim() : null;
    // Root cards have no parent; every other relation must have one — mirrors
    // the DB-level CHECK constraint, checked here too so a bad request gets a
    // clean 400 instead of surfacing a raw Postgres error.
    if ((relation === "root") !== (parentId === null)) {
      return jsonError("PARENT_RELATION_MISMATCH", 400);
    }
    if (parentId) {
      const parent = await supabaseDb.getKnowledgeCard(parentId);
      if (!parent || parent.userId !== session.id) {
        return jsonError("PARENT_CARD_NOT_FOUND", 404);
      }
    }

    const threadId = typeof body.threadId === "string" && body.threadId.trim() ? body.threadId.trim() : null;
    if (threadId) {
      const thread = await supabaseDb.getThread(threadId);
      if (!thread || thread.userId !== session.id) {
        return jsonError("THREAD_NOT_FOUND", 404);
      }
    }

    // Only root cards ever carry a folder assignment — matches the DB CHECK
    // constraint (folder_id only meaningful when relation = 'root').
    const folderId =
      relation === "root" && typeof body.folderId === "string" && body.folderId.trim()
        ? body.folderId.trim()
        : null;
    if (folderId) {
      const folder = await supabaseDb.getFolder(folderId);
      if (!folder || folder.userId !== session.id) {
        return jsonError("FOLDER_NOT_FOUND", 404);
      }
    }

    const title = typeof body.title === "string" ? body.title.trim() : "";
    const question = typeof body.question === "string" ? body.question : "";

    const card = await supabaseDb.createKnowledgeCard({
      userId: session.id,
      threadId,
      parentId,
      folderId,
      relation,
      title,
      question,
      status: "idle",
      unread: false,
    });

    return jsonOk({ item: card }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    return jsonError(message, message === "UNAUTHORIZED" ? 401 : 500);
  }
}
