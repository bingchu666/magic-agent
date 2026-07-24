import { assertAdmin } from "@/features/auth/session.server";
import { supabaseDb } from "@/lib/data/supabase-db";
import { jsonError, jsonOk } from "@/lib/ui/api";

export async function GET(req: Request) {
  try {
    await assertAdmin(req);
    return jsonOk({
      audits: await supabaseDb.listAuditLogs(200),
      events: await supabaseDb.listEvents(200),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unauthorized";
    return jsonError(msg, msg === "FORBIDDEN" ? 403 : 401);
  }
}
