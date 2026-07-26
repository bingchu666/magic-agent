import { ChatHistoryMessage } from "@/lib/domain/types";
import { containsDomainKeyword } from "@/lib/ai/trick-keyword-search";

const LOW_INFO_MAX_CHARS = 8;

const QUESTION_MARK_PATTERN = /[?？]\s*$/;
const QUESTION_PARTICLE_PATTERN = /(吗|呢)[。！?？!]{0,2}$/;

/** Short and without a concrete prop/trick keyword — likely a quick reply, not a new request. */
export function isLowInformationMessage(text: string, maxChars = LOW_INFO_MAX_CHARS): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (trimmed.length > maxChars) return false;
  return !containsDomainKeyword(trimmed);
}

/** Whether a reply's last sentence is a question (invites a yes/no or choice answer). */
export function endsWithQuestion(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return QUESTION_MARK_PATTERN.test(trimmed) || QUESTION_PARTICLE_PATTERN.test(trimmed);
}

/**
 * Decides what to search the trick knowledge base with for this turn.
 *
 * When the assistant's immediately preceding reply ended with a question and
 * the user's new message is short and low on content, the user is almost
 * certainly just answering that question (confirming, picking an option,
 * saying "continue") rather than raising a new topic. Searching on that short
 * reply directly tends to return irrelevant chunks, so this walks back to the
 * last substantive user turn and searches on that instead. If none exists,
 * retrieval is skipped for this turn and the model falls back to conversation
 * history to decide how to respond.
 *
 * This is deliberately generic — it does not special-case "continue" or any
 * other specific reply; it applies to any short, low-content reply that
 * follows a question from the assistant.
 */
export function resolveRetrievalQuery(
  userMessage: string,
  history: ChatHistoryMessage[]
): string | null {
  const trimmed = userMessage.trim();
  if (!trimmed) return null;

  const lastTurn = history.at(-1);
  const previousReplyWasQuestion = lastTurn?.role === "assistant" && endsWithQuestion(lastTurn.content);

  if (!previousReplyWasQuestion || !isLowInformationMessage(trimmed)) {
    return trimmed;
  }

  for (let i = history.length - 1; i >= 0; i -= 1) {
    const turn = history[i];
    if (turn.role !== "user") continue;
    const candidate = turn.content.trim();
    if (candidate && !isLowInformationMessage(candidate)) {
      return candidate;
    }
  }

  return null;
}
