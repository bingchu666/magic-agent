import { Locale } from "@/lib/domain/types";
import { memoryDb } from "@/lib/data/memory-db";
import { stripMarkdown } from "@/lib/domain/utils";

export function buildContext(params: {
  threadId: string;
  userId: string;
  locale: Locale;
  attachmentIds?: string[];
}) {
  const { threadId, userId, locale, attachmentIds = [] } = params;
  const messages = memoryDb.listMessages(threadId).slice(-16);
  const explicitInsights = memoryDb.listFileInsightsByIds(userId, attachmentIds);
  const recentInsights = memoryDb.listRecentFileInsights(userId, locale, 3);

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

  return {
    history,
    fileContext,
    usedFileInsights: uniqueInsights,
  };
}
