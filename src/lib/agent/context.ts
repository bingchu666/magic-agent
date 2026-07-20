import { Locale } from "@/lib/domain/types";
import { memoryDb } from "@/lib/data/memory-db";
import { stripMarkdown } from "@/lib/domain/utils";

export async function buildContext(params: {
  threadId: string;
  userId: string;
  locale: Locale;
  attachmentIds?: string[];
}) {
  const { threadId, userId, locale, attachmentIds = [] } = params;
  const messages = (await memoryDb.listMessages(threadId)).slice(-16);
  const explicitInsights = await memoryDb.listFileInsightsByIds(userId, attachmentIds);
  const recentInsights = await memoryDb.listRecentFileInsights(userId, locale, 3);

  const uniqueInsights = [...explicitInsights, ...recentInsights].filter(
    (insight, idx, arr) => idx === arr.findIndex((item) => item.id === insight.id)
  );

  const history = messages
    .map((message) => `${message.role.toUpperCase()}: ${stripMarkdown(message.content)}`)
    .join("\n")
    .slice(-8000);

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
