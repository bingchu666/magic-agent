import { assertSession } from "@/features/auth/session.server";
import { supabaseDb } from "@/lib/data/supabase-db";
import { jsonError, jsonOk } from "@/lib/ui/api";
import { createClient } from "@supabase/supabase-js";
import { documentMimeType, fileValidationError } from "@/features/file-intelligence/file-types";

function getStorageAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("File storage is not configured");
  }
  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export async function POST(req: Request) {
  try {
    const session = await assertSession(req);
    const body = (await req.json()) as {
      fileName?: string;
      mimeType?: string;
      size?: number;
    };

    if (typeof body?.fileName !== "string") {
      return jsonError("fileName is required", 400);
    }
    const fileName = body.fileName.trim().replace(/[\\/\0]/g, "_").slice(0, 180);
    const mimeType = documentMimeType(fileName);
    const size = Number(body.size);
    const validationError = fileValidationError({ name: fileName, size });
    if (validationError || !mimeType) return jsonError(validationError || "Unsupported file", 400);

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

    // The browser uploads directly to Supabase Storage. Proxying the file
    // through this Next.js route would hit Vercel's 4.5 MB Function payload
    // limit even though the product intentionally supports files up to 25 MB.
    const { data: signedUpload, error: signedUploadError } = await getStorageAdmin()
      .storage
      .from("file-uploads")
      .createSignedUploadUrl(file.storageKey, { upsert: true });
    if (signedUploadError || !signedUpload?.signedUrl) {
      await supabaseDb.deleteFile(file.id, session.id).catch(() => undefined);
      throw new Error(
        signedUploadError
          ? `Failed to prepare direct upload: ${signedUploadError.message}`
          : "Failed to prepare direct upload"
      );
    }

    return jsonOk({
      fileId: file.id,
      uploadUrl: signedUpload.signedUrl,
      method: "PUT",
      expiresIn: 300,
      uploadStrategy: "direct",
      mimeType,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to prepare upload";
    console.error("[api/files/presign] failed", { message });
    return jsonError(message, message === "UNAUTHORIZED" ? 401 : 500);
  }
}
