import { assertSession } from "@/features/auth/session.server";
import { supabaseDb } from "@/lib/data/supabase-db";
import { jsonError, jsonOk } from "@/lib/ui/api";

const MAX_FILE_SIZE = 25 * 1024 * 1024;

export async function POST(req: Request) {
  try {
    const session = await assertSession(req);
    const body = (await req.json()) as {
      fileName?: string;
      mimeType?: string;
      size?: number;
    };

    if (!body?.fileName || !body?.mimeType) {
      return jsonError("fileName and mimeType are required", 400);
    }
    const fileName = body.fileName.trim().replace(/[\\/\0]/g, "_").slice(0, 180);
    const mimeType = body.mimeType.trim().slice(0, 120);
    const size = Number(body.size);
    if (!fileName || !mimeType || !Number.isSafeInteger(size) || size <= 0 || size > MAX_FILE_SIZE) {
      return jsonError("Invalid file metadata or file is larger than 25 MB", 400);
    }

    const file = await supabaseDb.createFileAsset({
      userId: session.id,
      fileName,
      mimeType,
      size,
      storageKey: `uploads/${session.id}/${Date.now()}_${fileName}`,
    });

    await supabaseDb.createEvent({
      userId: session.id,
      name: "file_presigned",
      payload: {
        fileId: file.id,
        mimeType: file.mimeType,
      },
    });

    return jsonOk({
      fileId: file.id,
      uploadUrl: `/api/files/${file.id}/upload`,
      method: "PUT",
      expiresIn: 300,
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Unauthorized", 401);
  }
}
