import { assertSession } from "@/features/auth/session.server";
import { supabaseDb } from "@/lib/data/supabase-db";
import { jsonError, jsonOk } from "@/lib/ui/api";

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

    const file = await supabaseDb.createFileAsset({
      userId: session.id,
      fileName: body.fileName,
      mimeType: body.mimeType,
      size: Number(body.size || 0),
      storageKey: `uploads/${session.id}/${Date.now()}_${body.fileName}`,
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
