import { assertSession } from "@/features/auth/session.server";
import { supabaseDb } from "@/lib/data/supabase-db";
import { jsonError, jsonOk } from "@/lib/ui/api";

export async function PATCH(req: Request, { params }: { params: Promise<{ cardId: string }> }) {
  try {
    const { cardId } = await params;
    const session = await assertSession(req);
    let body: {
      title?: string;
      question?: string;
      status?: "idle" | "error";
      unread?: boolean;
      threadId?: string | null;
      folderId?: string | null;
    } = {};
    try {
      body = (await req.json()) as typeof body;
    } catch {
      body = {};
    }

    const card = await supabaseDb.getKnowledgeCard(cardId);
    if (!card || card.userId !== session.id) return jsonError("CARD_NOT_FOUND", 404);

    if (typeof body.threadId === "string" && body.threadId.trim()) {
      const thread = await supabaseDb.getThread(body.threadId.trim());
      if (!thread || thread.userId !== session.id) {
        return jsonError("THREAD_NOT_FOUND", 404);
      }
    }

    // Only root cards ever carry a folder assignment — matches the DB CHECK
    // constraint. This route never changes `relation`, so the card's current
    // relation is the one that decides whether folderId may be set.
    if (body.folderId !== undefined && body.folderId !== null && card.relation !== "root") {
      return jsonError("ONLY_ROOT_CARDS_HAVE_FOLDERS", 400);
    }
    if (typeof body.folderId === "string" && body.folderId.trim()) {
      const folder = await supabaseDb.getFolder(body.folderId.trim());
      if (!folder || folder.userId !== session.id) {
        return jsonError("FOLDER_NOT_FOUND", 404);
      }
    }

    const updated = await supabaseDb.updateKnowledgeCard(cardId, session.id, {
      title: typeof body.title === "string" ? body.title.trim() : undefined,
      question: typeof body.question === "string" ? body.question : undefined,
      status: body.status === "idle" || body.status === "error" ? body.status : undefined,
      unread: typeof body.unread === "boolean" ? body.unread : undefined,
      threadId: body.threadId !== undefined ? (body.threadId ? body.threadId.trim() : null) : undefined,
      folderId: body.folderId !== undefined ? (body.folderId ? body.folderId.trim() : null) : undefined,
    });
    if (!updated) return jsonError("CARD_NOT_FOUND", 404);

    return jsonOk({ item: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    return jsonError(message, message === "UNAUTHORIZED" ? 401 : 500);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ cardId: string }> }) {
  try {
    const { cardId } = await params;
    const session = await assertSession(req);
    const deleted = await supabaseDb.deleteKnowledgeCard(cardId, session.id);
    if (!deleted) return jsonError("CARD_NOT_FOUND", 404);

    return jsonOk({ item: deleted });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    return jsonError(message, message === "UNAUTHORIZED" ? 401 : 500);
  }
}
