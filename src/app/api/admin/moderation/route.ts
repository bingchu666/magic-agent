import { assertAdmin } from "@/features/auth/session.server";
import { memoryDb } from "@/lib/data/memory-db";
import { jsonError, jsonOk } from "@/lib/ui/api";

export async function GET(req: Request) {
  try {
    assertAdmin(req);
    const [audits, events] = await Promise.all([
      memoryDb.listAuditLogs(200),
      memoryDb.listEvents(200),
    ]);
    return jsonOk({ audits, events });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unauthorized";
    return jsonError(msg, msg === "FORBIDDEN" ? 403 : 401);
  }
}
