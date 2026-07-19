import { assertAdmin } from "@/features/auth/session.server";
import { memoryDb } from "@/lib/data/memory-db";
import { jsonError, jsonOk } from "@/lib/ui/api";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const admin = assertAdmin(req);
    const video = memoryDb.publishVideo(params.id);
    if (!video) return jsonError("VIDEO_NOT_FOUND", 404);

    memoryDb.createAuditLog({
      userId: admin.id,
      action: "video_published",
      details: JSON.stringify({ videoId: video.id }),
    });

    return jsonOk({ item: video });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unauthorized";
    return jsonError(msg, msg === "FORBIDDEN" ? 403 : 401);
  }
}
