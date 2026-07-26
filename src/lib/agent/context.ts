import { ChatHistoryMessage, Locale } from "@/lib/domain/types";
import { supabaseDb } from "@/lib/data/supabase-db";
import { stripMarkdown } from "@/lib/domain/utils";
import {
  extractKnowledgeSourceTitles,
  retrieveOptionalKnowledge,
} from "@/lib/agent/knowledge-retrieval";

const OPTIONAL_CONTEXT_TIMEOUT_MS = 800;

async function loadOptionalContext<T>(
  label: string,
  operation: Promise<T>,
  fallback: T
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${label} timed out`)),
          OPTIONAL_CONTEXT_TIMEOUT_MS
        );
      }),
    ]);
  } catch (error) {
    console.warn(`Optional ${label} unavailable; continuing without it`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return fallback;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function buildContext(params: {
  threadId: string;
  userId: string;
  locale: Locale;
  userMessage: string;
  attachmentIds?: string[];
  clientHistory?: ChatHistoryMessage[];
}) {
  const {
    threadId,
    userId,
    userMessage,
    attachmentIds = [],
    clientHistory = [],
  } = params;
  const [storedMessages, explicitInsights, retrievedKnowledge] =
    await Promise.all([
      clientHistory.length > 0
        ? Promise.resolve([])
        : loadOptionalContext(
            "stored conversation history",
            supabaseDb.listMessages(threadId),
            []
          ),
      loadOptionalContext(
        "attached file insights",
        supabaseDb.listFileInsightsByIds(userId, attachmentIds),
        []
      ),
      retrieveOptionalKnowledge({
        query: userMessage,
        search: (query) => supabaseDb.searchTrickChunks(query),
      }),
    ]);
  const messages = storedMessages.slice(-16);

  const uniqueInsights = explicitInsights.filter(
    (insight, idx, arr) => idx === arr.findIndex((item) => item.id === insight.id)
  );

  const history = clientHistory.length > 0
    ? clientHistory
    : messages
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
    retrievedKnowledge,
    knowledgeSources: extractKnowledgeSourceTitles(retrievedKnowledge),
    usedFileInsights: uniqueInsights,
  };
}
