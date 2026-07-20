import { assertSession } from "@/features/auth/session.server";
import { memoryDb } from "@/lib/data/memory-db";
import { jsonError, jsonOk } from "@/lib/ui/api";

export async function PUT(req: Request, { params }: { params: { fileId: string } }) {
  try {
    const session = assertSession(req);
    const file = await memoryDb.getFile(params.fileId);

    if (!file || file.userId !== session.id) {
      return jsonError("FILE_NOT_FOUND", 404);
    }

    const buffer = await req.arrayBuffer();
    await memoryDb.saveUpload(file.id, buffer);

    await memoryDb.createEvent({
      userId: session.id,
      name: "file_uploaded",
      payload: {
        fileId: file.id,
        size: buffer.byteLength,
      },
    });

    return jsonOk({ ok: true, fileId: file.id });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Upload failed", 500);
  }
}
