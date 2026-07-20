import { assertSession } from "@/features/auth/session.server";
import { enqueueFileProcessing } from "@/features/file-intelligence/processor";
import { jsonError, jsonOk } from "@/lib/ui/api";

export async function POST(req: Request, { params }: { params: { fileId: string } }) {
  try {
    const session = await assertSession(req);
    const job = await enqueueFileProcessing({
      fileId: params.fileId,
      userId: session.id,
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
