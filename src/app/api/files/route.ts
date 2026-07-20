import { assertSession } from "@/features/auth/session.server";
import { memoryDb } from "@/lib/data/memory-db";
import { jsonError, jsonOk } from "@/lib/ui/api";

export async function GET(req: Request) {
  try {
    const session = assertSession(req);
    const files = await memoryDb.listFiles(session.id);
    return jsonOk({ items: files });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Unauthorized", 401);
  }
}
