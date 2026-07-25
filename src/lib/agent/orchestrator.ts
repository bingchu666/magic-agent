import { generateWithGateway, generateWithGatewayStream } from "@/lib/ai/model-gateway";
import { buildContext } from "@/lib/agent/context";
import { detectIntent } from "@/lib/agent/intent";
import { supabaseDb } from "@/lib/data/supabase-db";
import { AgentOutput, ChatHistoryMessage, ChatStreamRequest, Locale, Message } from "@/lib/domain/types";
import { normalizeChatHistory, removeDuplicateCurrentUserTurn } from "@/lib/agent/history";

type OrchestratorInput = ChatStreamRequest & {
  userId: string;
  onThreadReady?: (threadId: string) => void;
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

function summarizeThreadTitle(message: string, locale: Locale) {
  const plain = message.replace(/\s+/g, " ").trim();
  if (!plain) return locale === "zh" ? "新对话" : "New Thread";
  const snippet = plain.slice(0, 28);
  return plain.length > 28 ? `${snippet}...` : snippet;
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
  userMessage: Message;
  assistantMessage: Message;
  output: AgentOutput;
}> {
  console.time("runAgentOrchestration");
  const requestedLocale: Locale = input.locale === "en" ? "en" : "zh";
  const locale: Locale = detectReplyLocale(input.userMessage, requestedLocale);

  // The route has already authenticated the session and loaded its trusted
  // profile. Avoid repeating that database read on every chat turn.
  console.time("orchestrator:resolveThread");
  const requestedThread = input.threadId
    ? await supabaseDb.getThread(input.threadId)
    : null;
  const thread = requestedThread?.userId === input.userId
    ? requestedThread
    : await supabaseDb.createThread(
      input.userId,
      summarizeThreadTitle(input.userMessage, locale)
    );
  console.timeEnd("orchestrator:resolveThread");

  if (!thread) {
    throw new Error("Failed to initialize thread");
  }
  if (input.onThreadReady) input.onThreadReady(thread.id);

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
  };

  const generationPromise = input.onModelToken
    ? generateWithGatewayStream(generationInput, input.onModelToken, input.signal)
    : generateWithGateway(generationInput);
  const [generation, userMessage] = await Promise.all([
    generationPromise,
    userMessagePromise,
  ]);

  const finalText = normalizeResponseText(generation.text);

  const output: AgentOutput = {
    text: finalText,
    locale,
    intent,
    recommendations: [],
    recommendationRefreshed: false,
    refreshReason: "keep_previous",
    goalTopic: null,
    usedFileInsights: context.usedFileInsights,
    safety,
    provider: generation.provider,
  };

  console.time("orchestrator:persistAssistantMessage");
  const assistantMessage = await supabaseDb.createMessage({
    threadId: thread.id,
    userId: input.userId,
    role: "assistant",
    content: output.text,
    locale,
  });
  console.timeEnd("orchestrator:persistAssistantMessage");

  console.time("orchestrator:createEvent");
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
  console.timeEnd("orchestrator:createEvent");

  console.timeEnd("runAgentOrchestration");
  return {
    threadId: thread.id,
    userMessage,
    assistantMessage,
    output,
  };
}
