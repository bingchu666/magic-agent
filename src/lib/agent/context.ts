import { ChatHistoryMessage, KnowledgeSourceRef, Locale } from "@/lib/domain/types";
import { supabaseDb } from "@/lib/data/supabase-db";
import { stripMarkdown } from "@/lib/domain/utils";
import {
  extractKnowledgeSourceTitles,
  retrieveOptionalKnowledge,
} from "@/lib/agent/knowledge-retrieval";
import { findMagicTermMentions } from "@/lib/agent/magic-term-match";

const OPTIONAL_CONTEXT_TIMEOUT_MS = 800;
// listMagicTermsForScan's cold path is a ~3.5s paginated fetch of the whole
// magic_terms table (see supabase-db.ts) — well past the 800ms budget used
// for other optional context, so it gets its own longer allowance. Startup
// warmup (src/instrumentation.ts) plus the cache's stale-while-revalidate
// refresh mean this timeout should only ever matter on a true cold start.
const MAGIC_TERM_SCAN_TIMEOUT_MS = 5000;

async function loadOptionalContext<T>(
  label: string,
  operation: Promise<T>,
  fallback: T,
  timeoutMs: number = OPTIONAL_CONTEXT_TIMEOUT_MS
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
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

function dedupeKnowledgeSources(sources: KnowledgeSourceRef[]): KnowledgeSourceRef[] {
  const seen = new Set<string>();
  return sources.filter(({ source, title }) => {
    const key = `${source}:${title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function buildContext(params: {
  threadId: string;
  userId: string;
  locale: Locale;
  userMessage: string;
  attachmentIds?: string[];
  clientHistory?: ChatHistoryMessage[];
  presetKnowledgeSources?: KnowledgeSourceRef[];
}) {
  const {
    threadId,
    userId,
    userMessage,
    attachmentIds = [],
    clientHistory = [],
    presetKnowledgeSources = [],
  } = params;
  const [storedMessages, explicitInsights, retrievedTrickKnowledge, magicTermRecords] =
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
      loadOptionalContext(
        "magic term dictionary scan",
        supabaseDb.listMagicTermsForScan(),
        [],
        MAGIC_TERM_SCAN_TIMEOUT_MS
      ),
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

  // Whole-message dictionary scan — distinct from the trick-chunk retrieval
  // above, which searches by relevance/embedding against a curated trick
  // library. This is plain "does any headword appear in this text" matching
  // (see magic-term-match.ts for why semantic search doesn't fit here).
  const termMatches = findMagicTermMentions(userMessage, magicTermRecords);
  const termKnowledgeText = termMatches
    .map((match) => `${match.term}：\n${match.definition}`)
    .join("\n\n---\n\n");

  const retrievedKnowledge = [termKnowledgeText, retrievedTrickKnowledge]
    .filter(Boolean)
    .join("\n\n---\n\n");

  const knowledgeSources = dedupeKnowledgeSources([
    ...presetKnowledgeSources,
    ...termMatches.map((match): KnowledgeSourceRef => ({ title: match.term, source: "term" })),
    ...extractKnowledgeSourceTitles(retrievedTrickKnowledge).map(
      (title): KnowledgeSourceRef => ({ title, source: "trick" })
    ),
  ]);

  return {
    history,
    fileContext,
    retrievedKnowledge,
    knowledgeSources,
    usedFileInsights: uniqueInsights,
  };
}
