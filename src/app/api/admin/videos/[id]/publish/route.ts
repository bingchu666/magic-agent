import { assertAdmin } from "@/features/auth/session.server";
import { supabaseDb } from "@/lib/data/supabase-db";
import { jsonError, jsonOk } from "@/lib/ui/api";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const admin = await assertAdmin(req);
    const video = await supabaseDb.publishVideo(id);
    if (!video) return jsonError("VIDEO_NOT_FOUND", 404);

    await supabaseDb.createAuditLog({
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
