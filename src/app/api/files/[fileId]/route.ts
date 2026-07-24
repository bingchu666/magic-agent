import { assertSession } from "@/features/auth/session.server";
import { supabaseDb } from "@/lib/data/supabase-db";
import { jsonError, jsonOk } from "@/lib/ui/api";

export async function GET(req: Request, { params }: { params: Promise<{ fileId: string }> }) {
  try {
    const { fileId } = await params;
    const session = await assertSession(req);
    const file = await supabaseDb.getFile(fileId);
    if (!file || file.userId !== session.id) {
      return jsonError("FILE_NOT_FOUND", 404);
    }

    const jobs = await supabaseDb.listFileJobs(file.id);
    const insights = await supabaseDb.listFileInsightsByIds(session.id, [file.id]);

    return jsonOk({
      file,
      jobs,
      insights,
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Unauthorized", 401);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ fileId: string }> }) {
  try {
    const { fileId } = await params;
    const session = await assertSession(req);
    const deleted = await supabaseDb.deleteFile(fileId, session.id);
    if (!deleted) {
      return jsonError("FILE_NOT_FOUND", 404);
    }

    await supabaseDb.createEvent({
      userId: session.id,
      name: "file_deleted",
      payload: {
        fileId: deleted.id,
        fileName: deleted.fileName,
      },
    });

    return jsonOk({ item: deleted });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Unauthorized", 401);
  }
}
