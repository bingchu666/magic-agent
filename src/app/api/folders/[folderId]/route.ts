import { assertSession } from "@/features/auth/session.server";
import { supabaseDb } from "@/lib/data/supabase-db";
import { jsonError, jsonOk } from "@/lib/ui/api";

export async function PATCH(req: Request, { params }: { params: Promise<{ folderId: string }> }) {
  try {
    const { folderId } = await params;
    const session = await assertSession(req);
    let body: { name?: string; sortOrder?: number } = {};
    try {
      body = (await req.json()) as { name?: string; sortOrder?: number };
    } catch {
      body = {};
    }

    const name = typeof body.name === "string" ? body.name.trim() : undefined;
    if (name !== undefined && !name) return jsonError("FOLDER_NAME_REQUIRED", 400);

    const folder = await supabaseDb.updateFolder(folderId, session.id, {
      name,
      sortOrder: typeof body.sortOrder === "number" ? body.sortOrder : undefined,
    });
    if (!folder) return jsonError("FOLDER_NOT_FOUND", 404);

    return jsonOk({ item: folder });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    return jsonError(message, message === "UNAUTHORIZED" ? 401 : 500);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ folderId: string }> }) {
  try {
    const { folderId } = await params;
    const session = await assertSession(req);
    const deleted = await supabaseDb.deleteFolder(folderId, session.id);
    if (!deleted) return jsonError("FOLDER_NOT_FOUND", 404);

    return jsonOk({ item: deleted });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    return jsonError(message, message === "UNAUTHORIZED" ? 401 : 500);
  }
}
