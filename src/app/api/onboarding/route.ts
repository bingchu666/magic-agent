import { assertSession } from "@/features/auth/session.server";
import { supabaseDb } from "@/lib/data/supabase-db";
import { jsonError, jsonOk } from "@/lib/ui/api";

export async function GET(req: Request) {
  try {
    const session = await assertSession(req);
    const record = await supabaseDb.getUserOnboarding(session.id);
    return jsonOk({
      item: {
        answers: record?.answers ?? {},
        completedAt: record?.completedAt ?? null,
        skipCount: record?.skipCount ?? 0,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    return jsonError(message, message === "UNAUTHORIZED" ? 401 : 500);
  }
}

export async function PATCH(req: Request) {
  try {
    const session = await assertSession(req);
    let body: { answers?: Record<string, unknown>; complete?: boolean; incrementSkip?: boolean } = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const answers =
      body.answers && typeof body.answers === "object" && !Array.isArray(body.answers)
        ? (body.answers as Record<string, string | string[]>)
        : {};

    const record = await supabaseDb.saveUserOnboardingProgress(session.id, {
      answers,
      complete: Boolean(body.complete),
      incrementSkip: Boolean(body.incrementSkip),
    });

    return jsonOk({
      item: {
        answers: record.answers,
        completedAt: record.completedAt,
        skipCount: record.skipCount,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    return jsonError(message, message === "UNAUTHORIZED" ? 401 : 500);
  }
}
