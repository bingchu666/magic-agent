import { assertAdmin } from "@/features/auth/session.server";
import { supabaseDb } from "@/lib/data/supabase-db";
import { Locale, VideoDifficulty } from "@/lib/domain/types";
import { jsonError, jsonOk } from "@/lib/ui/api";

function asLocale(input: unknown): Locale | undefined {
  if (input === "zh" || input === "en") return input;
  return undefined;
}

function asDifficulty(input: unknown): VideoDifficulty | undefined {
  if (input === "beginner" || input === "intermediate" || input === "advanced") return input;
  return undefined;
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const admin = await assertAdmin(req);
    const body = (await req.json()) as {
      title?: string;
      description?: string;
      url?: string;
      language?: Locale;
      difficulty?: VideoDifficulty;
      tags?: string[];
      status?: "draft" | "published";
    };

    const video = await supabaseDb.updateVideo(params.id, {
      title: typeof body.title === "string" ? body.title.trim() : undefined,
      description: typeof body.description === "string" ? body.description.trim() : undefined,
      url: typeof body.url === "string" ? body.url.trim() : undefined,
      language: asLocale(body.language),
      difficulty: asDifficulty(body.difficulty),
      tags: Array.isArray(body.tags)
        ? body.tags.map((tag) => String(tag).trim()).filter(Boolean)
        : undefined,
      status: body.status,
    });

    if (!video) return jsonError("VIDEO_NOT_FOUND", 404);

    await supabaseDb.createAuditLog({
      userId: admin.id,
      action: "video_updated",
      details: JSON.stringify({ videoId: video.id }),
    });

    return jsonOk({ item: video });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unauthorized";
    return jsonError(msg, msg === "FORBIDDEN" ? 403 : 401);
  }
}
