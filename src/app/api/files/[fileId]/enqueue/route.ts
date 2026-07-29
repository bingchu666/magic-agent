import { assertSession } from "@/features/auth/session.server";
import {
  enqueueFileProcessing,
  processFileJob,
} from "@/features/file-intelligence/processor";
import { withRequestCookie } from "@/lib/data/supabase-db";
import { jsonError, jsonOk } from "@/lib/ui/api";
import { after } from "next/server";

export const maxDuration = 300;
export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ fileId: string }> }) {
  try {
    const { fileId } = await params;
    const session = await assertSession(req);
    const job = await enqueueFileProcessing({
      fileId,
      userId: session.id,
    });
    const cookieHeader = req.headers.get("cookie") ?? "";
    after(async () => {
      await withRequestCookie(cookieHeader, () => processFileJob(job.id));
    });

    return jsonOk({
      jobId: job.id,
      status: job.status,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to enqueue";
    if (message === "FILE_NOT_FOUND") {
      return jsonError(message, 404);
    }
    return jsonError(message, 500);
  }
}
