const DEFAULT_MIN_SIMILARITY = 0.35;
const DEFAULT_MAX_CONTEXT_CHARS = 4000;
const DEFAULT_TIMEOUT_MS = 5000;

export type KnowledgeSearch = (
  query: string
) => Promise<Record<string, unknown>[]>;

function resolveMinSimilarity(value?: number) {
  if (Number.isFinite(value)) return Number(value);
  const configured = Number(process.env.RAG_MIN_SIMILARITY);
  return Number.isFinite(configured) ? configured : DEFAULT_MIN_SIMILARITY;
}

function formatRelevantChunk(
  row: Record<string, unknown>,
  minSimilarity: number
): string | null {
  const similarity = Number(row.similarity);
  if (!Number.isFinite(similarity) || similarity < minSimilarity) return null;

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

/**
 * Best-effort RAG adapter. The caller always receives a string, so retrieval
 * availability never controls whether the model is allowed to answer.
 */
export async function retrieveOptionalKnowledge(params: {
  query: string;
  search: KnowledgeSearch;
  minSimilarity?: number;
  maxContextChars?: number;
  timeoutMs?: number;
}): Promise<string> {
  const query = params.query.trim();
  if (!query) return "";

  try {
    const configuredTimeout = Number(process.env.RAG_TIMEOUT_MS);
    const timeoutMs = Math.max(
      1,
      params.timeoutMs ??
        (Number.isFinite(configuredTimeout) ? configuredTimeout : DEFAULT_TIMEOUT_MS)
    );
    let timeout: NodeJS.Timeout | undefined;
    const rows = await Promise.race([
      params.search(query),
      new Promise<Record<string, unknown>[]>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`retrieval timed out after ${timeoutMs}ms`)),
          timeoutMs
        );
      }),
    ]).finally(() => {
      if (timeout) clearTimeout(timeout);
    });
    const minSimilarity = resolveMinSimilarity(params.minSimilarity);
    const chunks = rows
      .map((row) => formatRelevantChunk(row, minSimilarity))
      .filter((chunk): chunk is string => Boolean(chunk))
    const mode = String(rows[0]?.searchMode || rows[0]?.search_mode || "unknown");
    if (chunks.length > 0) {
      console.info("Optional knowledge retrieval hit", {
        mode,
        matches: chunks.length,
      });
    } else {
      console.info("Optional knowledge retrieval miss", { mode });
    }
    return chunks
      .join("\n\n---\n\n")
      .slice(0, params.maxContextChars ?? DEFAULT_MAX_CONTEXT_CHARS);
  } catch (error) {
    console.warn("Optional knowledge retrieval unavailable; continuing without it", {
      error: error instanceof Error ? error.message : String(error),
    });
    return "";
  }
}
