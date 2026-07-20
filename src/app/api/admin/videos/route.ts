import { assertAdmin } from "@/features/auth/session.server";
import { supabaseDb } from "@/lib/data/supabase-db";
import { Locale, VideoDifficulty } from "@/lib/domain/types";
import { jsonError, jsonOk } from "@/lib/ui/api";

function asLocale(input: unknown): Locale {
  return input === "en" ? "en" : "zh";
}

function asDifficulty(input: unknown): VideoDifficulty {
  if (input === "intermediate" || input === "advanced") return input;
  return "beginner";
}

export async function GET(req: Request) {
  try {
    await assertAdmin(req);
    return jsonOk({ items: await supabaseDb.listVideosForAdmin() });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unauthorized";
    return jsonError(msg, msg === "FORBIDDEN" ? 403 : 401);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await assertAdmin(req);
    const body = (await req.json()) as {
      title?: string;
      description?: string;
      url?: string;
      language?: Locale;
      difficulty?: VideoDifficulty;
      tags?: string[];
    };

    if (!body?.title || !body?.url || !body?.description) {
      return jsonError("title, description, and url are required", 400);
    }

    const video = await supabaseDb.createVideo({
      createdBy: admin.id,
      title: body.title.trim(),
      description: body.description.trim(),
      url: body.url.trim(),
      language: asLocale(body.language),
      difficulty: asDifficulty(body.difficulty),
      tags: Array.isArray(body.tags)
        ? body.tags.map((tag) => String(tag).trim()).filter(Boolean)
        : [],
    });

    await supabaseDb.createAuditLog({
      userId: admin.id,
      action: "video_created",
      details: JSON.stringify({ videoId: video.id }),
    });

    return jsonOk({ item: video }, { status: 201 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unauthorized";
    return jsonError(msg, msg === "FORBIDDEN" ? 403 : 401);
  }
}
