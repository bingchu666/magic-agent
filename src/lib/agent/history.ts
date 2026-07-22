import type { ChatHistoryMessage } from "@/lib/domain/types";

const DEFAULT_MAX_TURNS = 30;
const DEFAULT_MAX_TURN_CHARS = 3000;
const DEFAULT_MAX_TOTAL_CHARS = 16000;

type HistoryLimits = {
  maxTurns?: number;
  maxTurnChars?: number;
  maxTotalChars?: number;
};

function clipTurn(content: string, maxChars: number) {
  if (content.length <= maxChars) return content;
  const separator = "\n…\n";
  if (maxChars <= separator.length + 2) return content.slice(-maxChars);
  const available = Math.max(1, maxChars - separator.length);
  const headLength = Math.ceil(available * 0.6);
  const tailLength = available - headLength;
  return `${content.slice(0, headLength)}${separator}${content.slice(-tailLength)}`;
}

/**
 * Treat browser-provided history as untrusted input and reduce it to a bounded,
 * chronological list of user/assistant turns. Multiline content is preserved.
 */
export function normalizeChatHistory(
  value: unknown,
  limits: HistoryLimits = {}
): ChatHistoryMessage[] {
  if (!Array.isArray(value)) return [];

  const maxTurns = Math.max(1, limits.maxTurns ?? DEFAULT_MAX_TURNS);
  const maxTurnChars = Math.max(1, limits.maxTurnChars ?? DEFAULT_MAX_TURN_CHARS);
  const maxTotalChars = Math.max(1, limits.maxTotalChars ?? DEFAULT_MAX_TOTAL_CHARS);

  const normalized = value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => {
      const role = item.role === "user" || item.role === "assistant" ? item.role : null;
      const content = typeof item.content === "string" ? item.content.trim() : "";
      if (!role || !content) return null;
      return { role, content: clipTurn(content, maxTurnChars) } satisfies ChatHistoryMessage;
    })
    .filter((item): item is ChatHistoryMessage => item !== null)
    .slice(-maxTurns);

  const bounded: ChatHistoryMessage[] = [];
  let remaining = maxTotalChars;
  for (let index = normalized.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const item = normalized[index];
    const content = item.content.length > remaining
      ? clipTurn(item.content, remaining)
      : item.content;
    bounded.unshift({ ...item, content });
    remaining -= content.length;
  }

  return bounded;
}

/** Defensive guard for older clients that included the latest user turn twice. */
export function removeDuplicateCurrentUserTurn(
  history: ChatHistoryMessage[],
  currentUserMessage: string
) {
  const last = history.at(-1);
  if (
    last?.role === "user" &&
    last.content.trim() === currentUserMessage.trim()
  ) {
    return history.slice(0, -1);
  }
  return history;
}
