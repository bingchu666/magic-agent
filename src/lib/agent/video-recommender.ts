import { Locale } from "@/lib/domain/types";
import { memoryDb } from "@/lib/data/memory-db";
import { recommendVideosDynamic } from "@/lib/recommendation/service";

async function buildConversationText(threadId?: string, fallback?: string) {
  if (fallback && fallback.trim()) return fallback;
  if (!threadId) return "";

  const messages = (await memoryDb.listMessages(threadId)).slice(-8);
  return messages
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n")
    .trim();
}

export async function recommendVideos(params: {
  userMessage: string;
  conversationText?: string;
  locale: Locale;
  threadId?: string;
  userId?: string;
  topK?: number;
}) {
  const threadId = params.threadId || "thread_ephemeral";
  const userId = params.userId || "guest_user";

  const conversationText = await buildConversationText(params.threadId, params.conversationText);

  return recommendVideosDynamic({
    locale: params.locale,
    userId,
    threadId,
    userMessage: params.userMessage,
    conversationText,
    limit: Math.min(6, Math.max(3, params.topK ? Math.floor(params.topK / 6) : 3)),
  });
}
