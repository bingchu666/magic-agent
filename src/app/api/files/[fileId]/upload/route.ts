import { assertSession } from "@/features/auth/session.server";
import { supabaseDb } from "@/lib/data/supabase-db";
import { jsonError, jsonOk } from "@/lib/ui/api";

export async function PUT(req: Request, { params }: { params: Promise<{ fileId: string }> }) {
  try {
    const { fileId } = await params;
    const session = await assertSession(req);
    const file = await supabaseDb.getFile(fileId);

    if (!file || file.userId !== session.id) {
      return jsonError("FILE_NOT_FOUND", 404);
    }

    const buffer = await req.arrayBuffer();
    if (buffer.byteLength !== file.size || buffer.byteLength > 25 * 1024 * 1024) {
      return jsonError("Uploaded size does not match the presigned file metadata", 400);
    }
    await supabaseDb.saveUpload(file.id, buffer);

    await supabaseDb.createEvent({
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
