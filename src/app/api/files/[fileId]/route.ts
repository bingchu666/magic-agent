import { assertSession } from "@/features/auth/session.server";
import { memoryDb } from "@/lib/data/memory-db";
import { jsonError, jsonOk } from "@/lib/ui/api";

export async function GET(req: Request, { params }: { params: { fileId: string } }) {
  try {
    const session = assertSession(req);
    const file = memoryDb.getFile(params.fileId);
    if (!file || file.userId !== session.id) {
      return jsonError("FILE_NOT_FOUND", 404);
    }

    const jobs = memoryDb.listFileJobs(file.id);
    const insights = memoryDb.listFileInsightsByIds(session.id, [file.id]);

    return jsonOk({
      file,
      jobs,
      insights,
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Unauthorized", 401);
  }
}

export async function DELETE(req: Request, { params }: { params: { fileId: string } }) {
  try {
    const session = assertSession(req);
    const deleted = memoryDb.deleteFile(params.fileId, session.id);
    if (!deleted) {
      return jsonError("FILE_NOT_FOUND", 404);
    }

    memoryDb.createEvent({
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
