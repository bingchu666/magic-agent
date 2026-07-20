import { clearSessionResponse, readSession } from "@/features/auth/session.server";
import { memoryDb } from "@/lib/data/memory-db";

export async function POST() {
  const user = readSession();
  if (user) {
    await memoryDb.createEvent({
      userId: user.id,
      name: "auth_logout",
      payload: {},
    });
  }
  return clearSessionResponse();
}
