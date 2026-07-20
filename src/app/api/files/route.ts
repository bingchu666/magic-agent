import { assertSession } from "@/features/auth/session.server";
import { supabaseDb } from "@/lib/data/supabase-db";
import { jsonError, jsonOk } from "@/lib/ui/api";

export async function GET(req: Request) {
  try {
    const session = await assertSession(req);
    const files = await supabaseDb.listFiles(session.id);
    return jsonOk({ items: files });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Unauthorized", 401);
  }
}
