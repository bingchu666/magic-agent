import { assertSession } from "@/features/auth/session.server";
import { supabaseDb } from "@/lib/data/supabase-db";
import { jsonError, jsonOk } from "@/lib/ui/api";

export async function GET(req: Request) {
  try {
    const session = await assertSession(req);
    const folders = await supabaseDb.listFolders(session.id);
    return jsonOk({ items: folders });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    return jsonError(message, message === "UNAUTHORIZED" ? 401 : 500);
  }
}

export async function POST(req: Request) {
  try {
    const session = await assertSession(req);
    let body: { name?: string } = {};
    try {
      body = (await req.json()) as { name?: string };
    } catch {
      body = {};
    }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return jsonError("FOLDER_NAME_REQUIRED", 400);

    const folder = await supabaseDb.createFolder(session.id, name);
    return jsonOk({ item: folder }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    return jsonError(message, message === "UNAUTHORIZED" ? 401 : 500);
  }
}
