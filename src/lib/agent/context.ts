import { Locale } from "@/lib/domain/types";
import { supabaseDb } from "@/lib/data/supabase-db";
import { stripMarkdown } from "@/lib/domain/utils";

function formatTrickChunk(row: Record<string, unknown>): string | null {
  const content = typeof row.content === "string" ? row.content.trim() : "";
  if (!content) return null;

  const title =
    typeof row.title === "string" && row.title.trim()
      ? row.title.trim()
      : typeof row.trick_title === "string"
        ? row.trick_title.trim()
        : "";

  return title ? `${title}：\n${content}` : content;
}

export async function buildContext(params: {
  threadId: string;
  userId: string;
  locale: Locale;
  userMessage: string;
  attachmentIds?: string[];
}) {
  const { threadId, userId, locale, userMessage, attachmentIds = [] } = params;
  const allMessages = await supabaseDb.listMessages(threadId);
  const messages = allMessages.slice(-16);
  const explicitInsights = await supabaseDb.listFileInsightsByIds(userId, attachmentIds);
  const recentInsights = await supabaseDb.listRecentFileInsights(userId, locale, 3);

  const uniqueInsights = [...explicitInsights, ...recentInsights].filter(
    (insight, idx, arr) => idx === arr.findIndex((item) => item.id === insight.id)
  );

  const history = messages
  .filter((message) => message.role === "user" || message.role === "assistant")
  .map((message) => ({
    role: message.role as "user" | "assistant",
    content: stripMarkdown(message.content),
  }));

  const fileContext = uniqueInsights
    .map((insight) => `${insight.kind}: ${insight.content}`)
    .join("\n")
    .slice(-3000);

  // Trick knowledge base (RAG): retrieve chunks relevant to the current
  // question so the model can ground its answer instead of inventing one.
  // Never let a search/embedding failure break the chat turn.
  const trickChunks = await supabaseDb.searchTrickChunks(userMessage).catch((error) => {
    console.error("searchTrickChunks failed", { userMessage, error });
    return [] as Record<string, unknown>[];
  });

  const trickContext = trickChunks
    .map(formatTrickChunk)
    .filter((item): item is string => Boolean(item))
    .join("\n\n---\n\n")
    .slice(0, 4000);

  return {
    history,
    fileContext,
    trickContext,
    usedFileInsights: uniqueInsights,
  };
}
