import { ChatHistoryMessage, FileInsight, KnowledgeSourceRef, Locale } from "@/lib/domain/types";
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
const FILE_CONTEXT_CHARS = Number(
  process.env.MODEL_FILE_CONTEXT_CHARS || 700_000
);

function queryTerms(value: string) {
  const terms = value
    .toLocaleLowerCase()
    .match(/[\p{L}\p{N}][\p{L}\p{N}'’-]{2,}/gu) ?? [];
  const ignored = new Set([
    "this", "that", "with", "from", "about", "book", "file", "please",
    "讲一下", "这本书", "详细", "解释", "文件", "内容", "帮忙",
  ]);
  return [...new Set(terms.filter((term) => !ignored.has(term)))].slice(0, 12);
}

const chineseDigitValues: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

function parseChineseNumber(value: string) {
  if (!/[十百千]/.test(value)) {
    const digits = Array.from(value).map((character) => chineseDigitValues[character]);
    return digits.every((digit) => digit !== undefined)
      ? Number(digits.join(""))
      : Number.NaN;
  }

  const units: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };
  let total = 0;
  let currentDigit = 0;
  for (const character of value) {
    if (character in chineseDigitValues) {
      currentDigit = chineseDigitValues[character];
      continue;
    }
    const unit = units[character];
    if (!unit) return Number.NaN;
    total += (currentDigit || 1) * unit;
    currentDigit = 0;
  }
  return total + currentDigit;
}

function requestedPageNumbers(value: string) {
  const pages = new Set<number>();
  const singlePatterns: Array<[RegExp, (raw: string) => number]> = [
    [/第\s*(\d{1,4})\s*页/gu, Number],
    [/\bpage\s*(\d{1,4})\b/giu, Number],
    [
      /第\s*([零〇一二两三四五六七八九十百千]{1,8})\s*页/gu,
      parseChineseNumber,
    ],
  ];
  for (const [pattern, parse] of singlePatterns) {
    for (const match of value.matchAll(pattern)) {
      const page = parse(match[1]);
      if (Number.isSafeInteger(page) && page > 0) pages.add(page);
    }
  }

  const rangePatterns: Array<[RegExp, (raw: string) => number]> = [
    [
      /第?\s*(\d{1,4})\s*(?:-|–|—|至|到)\s*(\d{1,4})\s*页/gu,
      Number,
    ],
    [
      /\bpages?\s*(\d{1,4})\s*(?:-|–|—|to)\s*(\d{1,4})\b/giu,
      Number,
    ],
    [
      /第?\s*([零〇一二两三四五六七八九十百千]{1,8})\s*(?:-|–|—|至|到)\s*([零〇一二两三四五六七八九十百千]{1,8})\s*页/gu,
      parseChineseNumber,
    ],
  ];
  for (const [pattern, parse] of rangePatterns) {
    for (const match of value.matchAll(pattern)) {
      const start = parse(match[1]);
      const end = parse(match[2]);
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) continue;
      if (start <= 0 || end < start || end - start > 20) continue;
      for (let page = start; page <= end; page += 1) pages.add(page);
    }
  }
  return [...pages];
}

function insightPageRange(content: string) {
  const range = content.match(/^\[Pages\s+(\d+)-(\d+)\]/i);
  if (range) {
    return { start: Number(range[1]), end: Number(range[2]) };
  }
  const single = content.match(/^\[Page\s+(\d+)\]/i);
  if (single) {
    const page = Number(single[1]);
    return { start: page, end: page };
  }
  return null;
}

export function orderFileChunks(insights: FileInsight[]) {
  return [...insights].sort((left, right) => {
    const leftRange = insightPageRange(left.content);
    const rightRange = insightPageRange(right.content);
    const pageOrder =
      (leftRange?.start ?? Number.MAX_SAFE_INTEGER) -
      (rightRange?.start ?? Number.MAX_SAFE_INTEGER);
    if (pageOrder !== 0) return pageOrder;
    return left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id);
  });
}

function containsExactPageMarker(content: string, page: number) {
  return new RegExp(`(?:^|\\n)\\[Page ${page}\\](?:\\n|$)`).test(content);
}

export function extractRequestedPageExcerpts(
  previewText: string | undefined,
  pages: number[]
) {
  if (!previewText?.trim() || pages.length === 0) return [];
  const markers = [...previewText.matchAll(/^\[Page (\d+)\]\s*$/gm)];
  return pages.flatMap((page) => {
    const markerIndex = markers.findIndex((match) => Number(match[1]) === page);
    if (markerIndex < 0) return [];
    const marker = markers[markerIndex];
    const nextMarker = markers[markerIndex + 1];
    const start = (marker.index ?? 0) + marker[0].length;
    const end = nextMarker?.index ?? previewText.length;
    const text = previewText.slice(start, end).trim();
    return text ? [`[Page ${page}]\n${text}`] : [];
  });
}

export function rankFileChunks(insights: FileInsight[], query: string) {
  const terms = queryTerms(query);
  const requestedPages = requestedPageNumbers(query);
  const ranked = insights
    .map((insight, index) => {
      const content = insight.content.toLocaleLowerCase();
      const keywordScore = terms.reduce((total, term) => {
        const occurrences = content.split(term).length - 1;
        return total + Math.min(occurrences, 8) * Math.max(term.length, 3);
      }, 0);
      const range = insightPageRange(insight.content);
      const pageScore =
        range &&
        requestedPages.some((page) => page >= range.start && page <= range.end)
          ? 1_000_000
          : 0;
      return { insight, index, score: pageScore + keywordScore };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index);

  if (requestedPages.length > 0) {
    return ranked
      .filter(({ score }) => score >= 1_000_000)
      .slice(0, 3)
      .map(({ insight }) => insight);
  }

  if (ranked[0]?.score > 0) {
    return ranked.slice(0, 3).map(({ insight }) => insight);
  }

  // "Explain this book" has no useful literal search term, especially when
  // the question is Chinese and the source is English. Give the model a
  // representative beginning/middle/end sample instead of three adjacent
  // opening chunks.
  const positions = [0, Math.floor(insights.length / 2), insights.length - 1];
  return positions
    .map((index) => insights[index])
    .filter(
      (insight, index, selected): insight is FileInsight =>
        Boolean(insight) &&
        selected.findIndex((item) => item?.id === insight.id) === index
    );
}

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

  const requestedAttachmentIds = Array.from(
    new Set(
      attachmentIds.filter(
        (attachmentId): attachmentId is string =>
          typeof attachmentId === "string" && attachmentId.trim().length > 0
      )
    )
  ).slice(0, 10);

  const [storedMessages, explicitFiles, explicitInsights, retrievedTrickKnowledge, magicTermRecords] =
    await Promise.all([
      clientHistory.length > 0
        ? Promise.resolve([])
        : loadOptionalContext(
            "stored conversation history",
            supabaseDb.listMessages(threadId),
            []
          ),
      // Explicit attachments are user-selected primary context. They must not
      // silently disappear behind the short timeout used for optional context.
      supabaseDb.listFilesByIds(userId, requestedAttachmentIds),
      supabaseDb.listFileInsightsByIds(userId, requestedAttachmentIds),
      // A user-selected file is the authoritative source for this turn.
      // Mixing unrelated app-library hits into a book question is a direct
      // route to confident but unsupported answers.
      requestedAttachmentIds.length > 0
        ? Promise.resolve("")
        : retrieveOptionalKnowledge({
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

  if (explicitFiles.length !== requestedAttachmentIds.length) {
    throw new Error(
      params.locale === "zh"
        ? "有附件不存在或无权访问，请重新上传后再试。"
        : "An attachment is missing or inaccessible. Upload it again and retry."
    );
  }
  const unfinishedFiles = explicitFiles.filter(
    (file) => file.status === "uploaded" || file.status === "processing"
  );
  if (unfinishedFiles.length > 0) {
    throw new Error(
      params.locale === "zh"
        ? `文件仍在解析：${unfinishedFiles.map((file) => file.fileName).join("、")}。解析完成前不会让 AI 猜测内容。`
        : `Still processing: ${unfinishedFiles.map((file) => file.fileName).join(", ")}. AI generation is blocked until the text is ready.`
    );
  }
  const unusableFiles = explicitFiles.filter(
    (file) => file.status === "failed" || file.status === "expired"
  );
  if (unusableFiles.length > 0) {
    throw new Error(
      params.locale === "zh"
        ? `附件无法读取：${unusableFiles.map((file) => file.fileName).join("、")}。请移除后重新上传。`
        : `Cannot read attachment: ${unusableFiles.map((file) => file.fileName).join(", ")}. Remove it and upload again.`
    );
  }
  const contentlessFiles = explicitFiles.filter((file) => {
    const hasInsight = uniqueInsights.some(
      (insight) => insight.fileId === file.id && insight.content.trim().length > 0
    );
    return !hasInsight && !file.previewText?.trim();
  });
  if (contentlessFiles.length > 0) {
    throw new Error(
      params.locale === "zh"
        ? `附件没有可用正文：${contentlessFiles.map((file) => file.fileName).join("、")}。为避免胡编，本次未调用 AI。`
        : `No extracted text is available for: ${contentlessFiles.map((file) => file.fileName).join(", ")}. AI was not called to avoid fabrication.`
    );
  }

  const history = clientHistory.length > 0
    ? clientHistory
    : messages
        .filter((message) => message.role === "user" || message.role === "assistant")
        .map((message) => ({
          role: message.role as "user" | "assistant",
          content: stripMarkdown(message.content),
        }));

  const requestedPages = requestedPageNumbers(userMessage);
  const perFileBudget = Math.max(
    24_000,
    Math.floor(FILE_CONTEXT_CHARS / Math.max(1, explicitFiles.length))
  );
  const fileContext = explicitFiles
    .map((file) => {
      const allFileInsights = uniqueInsights.filter(
        (insight) => insight.fileId === file.id
      );
      const localizedInsights = allFileInsights.filter(
        (insight) => insight.locale === params.locale
      );
      const fileInsights =
        localizedInsights.length > 0 ? localizedInsights : allFileInsights;
      const summaries = fileInsights.filter(
        (insight) => insight.kind === "summary"
      );
      const indexedChunks = orderFileChunks(
        fileInsights.filter((insight) => insight.kind === "key_points")
      );
      const completeExtractedText = indexedChunks
        .map((insight) => insight.content.trim())
        .filter(Boolean)
        .join("\n\n");
      const inlineFullDocument =
        completeExtractedText.length > 0 &&
        completeExtractedText.length <= perFileBudget;
      const relevantChunks = rankFileChunks(
        indexedChunks,
        userMessage
      );
      const exactPageChunks =
        requestedPages.length > 0
          ? relevantChunks.filter((insight) =>
              requestedPages.some((page) =>
                containsExactPageMarker(insight.content, page)
              )
            )
          : relevantChunks;
      // Legacy indexes grouped multiple pages without preserving markers
      // inside the range. The file preview does preserve them, so use it as a
      // compatibility source when the requested page is still present there.
      const previewPageExcerpts = extractRequestedPageExcerpts(
        file.previewText,
        requestedPages.filter(
          (page) =>
            !exactPageChunks.some((insight) =>
              containsExactPageMarker(insight.content, page)
            )
        )
      );
      const pageEvidenceAvailable =
        requestedPages.length === 0 ||
        requestedPages.every(
          (page) =>
            exactPageChunks.some((insight) =>
              containsExactPageMarker(insight.content, page)
            ) ||
            previewPageExcerpts.some((excerpt) =>
              containsExactPageMarker(excerpt, page)
            )
        );
      console.info("[file-context] selected", {
        fileId: file.id,
        fileName: file.fileName,
        mode: inlineFullDocument ? "full_document" : "retrieval_fallback",
        extractedChars: completeExtractedText.length,
        requestedPages,
        indexedChunkCount: indexedChunks.length,
        selectedChunkLabels: exactPageChunks.map(
          (insight) => insight.content.match(/^\[Pages?[^\]]+\]/)?.[0] ?? "unlabeled"
        ),
        previewPageLabels: previewPageExcerpts.map(
          (excerpt) => excerpt.match(/^\[Page[^\]]+\]/)?.[0] ?? "unlabeled"
        ),
        pageEvidenceAvailable,
      });
      const extractedContext = inlineFullDocument
        ? [
            summaries[0]?.content ||
              (params.locale === "zh" ? file.summaryZh : file.summaryEn),
            "Complete extracted document text, ordered by PDF page:",
            completeExtractedText,
          ]
            .filter((value): value is string => Boolean(value?.trim()))
            .join("\n")
        : [
            summaries[0]?.content ||
              (params.locale === "zh" ? file.summaryZh : file.summaryEn),
            ...previewPageExcerpts.map(
              (excerpt) => `exact page excerpt: ${excerpt}`
            ),
            ...exactPageChunks.map(
              (insight) => `relevant excerpt: ${insight.content}`
            ),
            requestedPages.length > 0 && !pageEvidenceAvailable
              ? `Page selection: no indexed chunk matched the requested PDF page(s): ${requestedPages.join(", ")}. Do not answer what those pages contain.`
              : "",
            exactPageChunks.length === 0 &&
            previewPageExcerpts.length === 0 &&
            indexedChunks.length === 0
              ? file.previewText
              : "",
          ]
            .filter((value): value is string => Boolean(value?.trim()))
            .join("\n");

      return [
        `Attached file: ${file.fileName}`,
        `MIME type: ${file.mimeType}`,
        `Processing status: ${file.status}`,
        inlineFullDocument
          ? `Document access mode: complete extracted text (${indexedChunks.length} ordered chunks) is supplied below, not a sample.`
          : indexedChunks.length > 0
            ? `Document access mode: this document exceeds the inline context budget, so the excerpts below were retrieved from ${indexedChunks.length} indexed chunks for the current question.`
          : "Document index: only a legacy preview is available; do not claim access to text beyond the supplied preview.",
        extractedContext,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n")
    .slice(0, FILE_CONTEXT_CHARS);

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