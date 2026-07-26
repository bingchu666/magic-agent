import { generateShortTitle, generateWithGateway, generateWithGatewayStream, naiveTitleFallback } from "@/lib/ai/model-gateway";
import { buildContext } from "@/lib/agent/context";
import { detectIntent } from "@/lib/agent/intent";
import { supabaseDb } from "@/lib/data/supabase-db";
import { AgentOutput, ChatHistoryMessage, ChatStreamRequest, Locale, Message } from "@/lib/domain/types";
import { normalizeChatHistory, removeDuplicateCurrentUserTurn } from "@/lib/agent/history";
import { ensureConceptAnnotations } from "@/lib/agent/concept-annotations";

type OrchestratorInput = ChatStreamRequest & {
  userId: string;
  onThreadReady?: (threadId: string, title: string) => void;
  onModelToken?: (text: string) => void;
  signal?: AbortSignal;
};

const zhNumberMap: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

function detectReplyLocale(message: string, fallback: Locale): Locale {
  const text = (message || "").trim();
  if (!text) return fallback;

  const zhChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const asciiLetters = (text.match(/[A-Za-z]/g) || []).length;

  if (zhChars >= 2 && zhChars > asciiLetters * 0.35) return "zh";
  if (asciiLetters >= 10 && asciiLetters >= zhChars * 1.2) return "en";
  return fallback;
}

function normalizeResponseText(input: string) {
  return input
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractLatestAssistantFromHistory(history: ChatHistoryMessage[] | undefined) {
  return [...(history ?? [])]
    .reverse()
    .find((message) => message.role === "assistant")
    ?.content.trim() || null;
}

function parseRequestedPoint(text: string) {
  const en = text.match(/point\s*([1-9]\d*)/i);
  if (en?.[1]) return Number(en[1]);

  const zhDigit = text.match(/第\s*([1-9]\d*)\s*点/);
  if (zhDigit?.[1]) return Number(zhDigit[1]);

  const zhWord = text.match(/第\s*([一二三四五六七八九十])\s*点/);
  if (zhWord?.[1] && zhNumberMap[zhWord[1]]) return zhNumberMap[zhWord[1]];

  return null;
}

function extractPointSegment(answer: string | undefined, point: number | null) {
  if (!answer || !point || point <= 0) return null;
  const text = answer.replace(/\r\n/g, "\n");

  const startPattern = new RegExp(`(?:^|\\s)${point}\\s*[\\.|、\\)]\\s*`, "i");
  const start = startPattern.exec(text);
  if (!start) return null;

  const from = start.index + start[0].length;
  const nextPattern = new RegExp(`\\s${point + 1}\\s*[\\.|、\\)]\\s*`, "i");
  const next = nextPattern.exec(text.slice(from));
  const to = next ? from + next.index : Math.min(text.length, from + 560);
  const segment = text.slice(from, to).trim();
  return segment || null;
}

function isExplicitFollowUp(message: string) {
  return /(继续|接着|展开|细化|延续|上一条|上一步|follow up|continue|build on|expand)/i.test(
    message
  );
}

export async function runAgentOrchestration(input: OrchestratorInput): Promise<{
  threadId: string;
  threadTitle: string;
  userMessage: Message;
  assistantMessage: Message;
  output: AgentOutput;
}> {
  const requestedLocale: Locale = input.locale === "en" ? "en" : "zh";
  const locale: Locale = detectReplyLocale(input.userMessage, requestedLocale);

  // The route has already authenticated the session and loaded its trusted
  // profile. Avoid repeating that database read on every chat turn.
  const requestedThread = input.threadId
    ? await supabaseDb.getThread(input.threadId)
    : null;
  // Thread creation must never wait on the AI title call: use an immediate
  // truncated placeholder so the card/conversation is ready right away, and
  // upgrade it to a short AI-generated title in the background below (in
  // parallel with generation), once `titlePending` marks it as needed.
  const thread = requestedThread?.userId === input.userId
    ? requestedThread
    : await supabaseDb.createThread(
      input.userId,
      naiveTitleFallback(input.userMessage, locale),
      { titlePending: true }
    );

  if (!thread) {
    throw new Error("Failed to initialize thread");
  }
  if (input.onThreadReady) input.onThreadReady(thread.id, thread.title);

  const titleUpgradePromise: Promise<void> = thread.titlePending
    ? generateShortTitle({ userMessage: input.userMessage, locale })
        .then(async (generatedTitle) => {
          const finalTitle = generatedTitle || thread.title;
          await supabaseDb.updateThreadTitle(thread.id, finalTitle);
          thread.title = finalTitle;
          thread.titlePending = false;
          if (input.onThreadReady) input.onThreadReady(thread.id, finalTitle);
        })
        .catch((error) => {
          // The placeholder title already stands as the final title — a
          // failed upgrade is a non-issue, not a broken experience.
          console.warn("Short title upgrade failed; keeping placeholder title", error);
        })
    : Promise.resolve();

  const intent = detectIntent(input.userMessage);
  const safety = { mode: "allow" as const };
  const clientHistory = removeDuplicateCurrentUserTurn(
    normalizeChatHistory(input.clientHistory),
    input.userMessage
  );
  const context = await buildContext({
    threadId: thread.id,
    userId: input.userId,
    locale: requestedLocale,
    userMessage: input.userMessage,
    attachmentIds: input.attachmentIds,
    clientHistory,
  });

  const history = clientHistory.length > 0
    ? clientHistory
    : normalizeChatHistory(context.history);
  const previousAssistantReply = extractLatestAssistantFromHistory(history) || undefined;

  // Persist the user turn while generation starts so this required write does
  // not add latency before the first streamed token.
  const userMessagePromise = supabaseDb.createMessage({
    threadId: thread.id,
    userId: input.userId,
    role: "user",
    content: input.userMessage,
    locale: requestedLocale,
    attachmentIds: input.attachmentIds,
  });

  const requestedPoint = parseRequestedPoint(input.userMessage);
  const continuationTarget = extractPointSegment(previousAssistantReply, requestedPoint);
  const followUp = isExplicitFollowUp(input.userMessage);
  const responseFormatInstructions = [
    input.responseMode === "annotated"
      ? "Mark 3 to 6 concrete, useful concepts that a learner may want to inspect next by wrapping only the exact term in double square brackets, for example [[misdirection]]. Keep the markers inline inside the natural answer. Do not explain the marker syntax, do not put full sentences inside markers, and do not mark generic words."
      : "",
    context.knowledgeSources.length
      ? locale === "zh"
        ? `本次已命中应用知识库。优先使用检索内容，并在回答末尾单独添加“知识库依据：${context.knowledgeSources.join("；")}”。只能列出这些真实标题，不要编造来源。`
        : `The app knowledge base matched this request. Use the retrieved material and end with "Database grounding: ${context.knowledgeSources.join("; ")}". List only these exact titles and do not invent sources.`
      : "",
  ].filter(Boolean);

  const generationInput = {
    locale,
    intent,
    userMessage: input.userMessage,
    history,
    fileContext: context.fileContext,
    retrievedKnowledge: context.retrievedKnowledge,
    avoidRepeatOf: followUp ? previousAssistantReply : undefined,
    continuationTarget: continuationTarget
      ? `Point ${requestedPoint}: ${continuationTarget}`
      : undefined,
    responseFormatPrompt: responseFormatInstructions.length
      ? responseFormatInstructions.join("\n")
      : undefined,
  };

  const generationPromise = input.onModelToken
    ? generateWithGatewayStream(generationInput, input.onModelToken, input.signal)
    : generateWithGateway(generationInput);
  const [generation, userMessage] = await Promise.all([
    generationPromise,
    userMessagePromise,
    titleUpgradePromise,
  ]);

  const normalizedText = normalizeResponseText(generation.text);
  const finalText =
    input.responseMode === "annotated"
      ? ensureConceptAnnotations(normalizedText)
      : normalizedText;

  const output: AgentOutput = {
    text: finalText,
    locale,
    intent,
    recommendations: [],
    recommendationRefreshed: false,
    refreshReason: "keep_previous",
    goalTopic: null,
    usedFileInsights: context.usedFileInsights,
    knowledgeSources: context.knowledgeSources,
    safety,
    provider: generation.provider,
  };

  const assistantMessage = await supabaseDb.createMessage({
    threadId: thread.id,
    userId: input.userId,
    role: "assistant",
    content: output.text,
    locale,
  });

  await supabaseDb.createEvent({
    userId: input.userId,
    name: "chat_completion",
    payload: {
      threadId: thread.id,
      messageId: assistantMessage.id,
      provider: output.provider,
      intent: output.intent,
      usedFileInsights: output.usedFileInsights.length,
    },
  });

  return {
    threadId: thread.id,
    threadTitle: thread.title,
    userMessage,
    assistantMessage,
    output,
  };
}
