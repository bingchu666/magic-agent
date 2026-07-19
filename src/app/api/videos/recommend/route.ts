import { assertSession } from "@/features/auth/session.server";
import { jsonError, jsonOk } from "@/lib/ui/api";

export async function GET(req: Request) {
  try {
    assertSession(req);
    return jsonOk({
      items: [],
      meta: {
        disabled: true,
        reason: "video_recommendation_removed",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    const status = message === "UNAUTHORIZED" ? 401 : 500;
    return jsonError(message, status);
  }
}
