import OpenAI from "openai";
import { ChatIntent, Locale } from "@/lib/domain/types";

type GenerationInput = {
  locale: Locale;
  intent: ChatIntent;
  userMessage: string;
  history: string;
  fileContext: string;
  avoidRepeatOf?: string;
  continuationTarget?: string;
};

export type GenerationResult = {
  text: string;
  provider: "deepseek" | "openai" | "rule";
};

const MODEL_TIMEOUT_MS = Number(process.env.MODEL_TIMEOUT_MS || 25000);
const MODEL_STREAM_TIMEOUT_MS = Number(process.env.MODEL_STREAM_TIMEOUT_MS || 180000);
const MODEL_MAX_TOKENS = Number(process.env.MODEL_MAX_TOKENS || 1200);
const MODEL_TEMPERATURE = Number(process.env.MODEL_TEMPERATURE || 0.55);
const HISTORY_CLIP_CHARS = Number(process.env.MODEL_HISTORY_CHARS || 12000);
const HISTORY_MAX_TURNS = Number(process.env.MODEL_HISTORY_TURNS || 30);
const HISTORY_TURN_MAX_CHARS = Number(process.env.MODEL_HISTORY_TURN_CHARS || 2000);
const ENABLE_OPENAI_FALLBACK = process.env.OPENAI_FALLBACK_ENABLED === "true";
const DEFAULT_MAGIC_SYSTEM_PROMPT =
  "You are MagicAgent, a professional magic-learning and performance coach. Answer the user's latest request directly with practical coaching guidance. Keep continuity across turns, and only continue a prior section when the user explicitly asks to continue.";

function cleanResponseText(input: string) {
  const normalized = input
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return normalizeTrailingFragment(normalized);
}

function normalizeTrailingFragment(input: string) {
  if (!input) return input;
  if (/[。！？.!?]$/.test(input)) return input;
  if (input.length < 80) return `${input}。`;

  const boundary = findLastBoundary(input);
  if (boundary <= 0) {
    return `${input}。`;
  }

  const clipped = input.slice(0, boundary + 1).trim();
  if (!clipped) return `${input}。`;
  return clipped;
}

function findLastBoundary(text: string) {
  const punctuation = [".", "!", "?", "。", "！", "？"];
  const minIndex = Math.floor(text.length * 0.55);
  let best = -1;
  for (const mark of punctuation) {
    const idx = text.lastIndexOf(mark);
    if (idx >= minIndex && idx > best) best = idx;
  }
  return best;
}

function parseModels(raw: string | undefined, defaults: string[]) {
  const fromEnv = (raw || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return Array.from(new Set([...fromEnv, ...defaults]));
}

function clip(input: string, max: number) {
  if (input.length <= max) return input;
  return input.slice(input.length - max);
}

function historyToMessages(history: string): Array<{ role: "user" | "assistant"; content: string }> {
  const lines = history
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-HISTORY_MAX_TURNS);

  const out: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const line of lines) {
    if (line.startsWith("USER:")) {
      const content = clip(line.replace(/^USER:\s*/, "").trim(), HISTORY_TURN_MAX_CHARS);
      if (content) out.push({ role: "user", content });
      continue;
    }
    if (line.startsWith("ASSISTANT:")) {
      const content = clip(line.replace(/^ASSISTANT:\s*/, "").trim(), HISTORY_TURN_MAX_CHARS);
      if (content) out.push({ role: "assistant", content });
    }
  }
  return out;
}

function buildMessages(input: GenerationInput) {
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [];

  const system = process.env.MAGIC_AGENT_SYSTEM_PROMPT?.trim() || DEFAULT_MAGIC_SYSTEM_PROMPT;
  if (system) {
    messages.push({ role: "system", content: system });
  }

  messages.push(...historyToMessages(clip(input.history || "", HISTORY_CLIP_CHARS)));

  const userParts = [
    input.userMessage,
    input.locale === "en" ? "\nPlease reply in English." : "\n请用中文回答。",
  ];
  if (input.avoidRepeatOf?.trim()) {
    userParts.push(`\nPrevious assistant reply (for reference only):\n${clip(input.avoidRepeatOf.trim(), 5000)}`);
  }
  if (input.continuationTarget?.trim()) {
    userParts.push(
      "\nContinuation rule: continue only the requested target below. Do not restart from the beginning."
    );
    userParts.push(`\nContinuation target:\n${clip(input.continuationTarget.trim(), 3000)}`);
  }
  if (input.fileContext?.trim()) {
    userParts.push(`\nFile context:\n${clip(input.fileContext, 6000)}`);
  }

  messages.push({
    role: "user",
    content: userParts.join("\n"),
  });

  return messages;
}

function resolveMaxTokens(input: GenerationInput) {
  if (/(一句|very short|one line|简短)/i.test(input.userMessage || "")) {
    return Math.max(160, Math.floor(MODEL_MAX_TOKENS * 0.35));
  }
  return MODEL_MAX_TOKENS;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs = MODEL_TIMEOUT_MS): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`MODEL_TIMEOUT_${timeoutMs}`)), timeoutMs);
    promise
      .then(resolve)
      .catch(reject)
      .finally(() => {
        if (timer) clearTimeout(timer);
      });
  });
}

async function callProvider(params: {
  provider: "deepseek" | "openai";
  client: OpenAI;
  models: string[];
  input: GenerationInput;
  attemptsPerModel?: number;
}) {
  const messages = buildMessages(params.input);
  const attemptsPerModel = Math.max(1, params.attemptsPerModel || 1);
  const maxTokens = resolveMaxTokens(params.input);
  for (const model of params.models) {
    for (let attempt = 1; attempt <= attemptsPerModel; attempt += 1) {
      try {
        const completion = await params.client.chat.completions.create({
          model,
          messages,
          temperature: MODEL_TEMPERATURE,
          max_tokens: maxTokens,
        });
        const content = cleanResponseText(completion.choices?.[0]?.message?.content?.trim() || "");
        if (!content) continue;
        return {
          text: content,
          provider: params.provider,
        } satisfies GenerationResult;
      } catch (error) {
        console.warn(`${params.provider} generation failed`, { model, attempt, error });
      }
    }
  }
  return null;
}

function extractDeltaText(chunk: any): string {
  const delta = chunk?.choices?.[0]?.delta?.content;
  if (typeof delta === "string") return delta;
  if (Array.isArray(delta)) {
    return delta
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part.text === "string") return part.text;
        return "";
      })
      .join("");
  }
  return "";
}

async function callProviderStream(params: {
  provider: "deepseek" | "openai";
  client: OpenAI;
  models: string[];
  input: GenerationInput;
  onToken?: (text: string) => void;
  attemptsPerModel?: number;
}) {
  const messages = buildMessages(params.input);
  const attemptsPerModel = Math.max(1, params.attemptsPerModel || 1);
  const maxTokens = resolveMaxTokens(params.input);

  for (const model of params.models) {
    for (let attempt = 1; attempt <= attemptsPerModel; attempt += 1) {
      try {
        const stream = await params.client.chat.completions.create({
          model,
          messages,
          temperature: MODEL_TEMPERATURE,
          max_tokens: maxTokens,
          stream: true,
        });

        let text = "";
        for await (const chunk of stream as any) {
          const delta = extractDeltaText(chunk);
          if (!delta) continue;
          text += delta;
          if (params.onToken) params.onToken(delta);
        }

        const normalized = cleanResponseText(text);
        if (!normalized) continue;
        return {
          text: normalized,
          provider: params.provider,
        } satisfies GenerationResult;
      } catch (error) {
        console.warn(`${params.provider} stream generation failed`, { model, attempt, error });
      }
    }
  }

  return null;
}

async function callDeepSeek(input: GenerationInput): Promise<GenerationResult | null> {
  if (!process.env.DEEPSEEK_API_KEY) return null;

  const client = new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
  });

  const models = parseModels(process.env.DEEPSEEK_MODEL, ["deepseek-chat"]);
  return callProvider({
    provider: "deepseek",
    client,
    models,
    input,
    attemptsPerModel: 1,
  });
}

async function callOpenAI(input: GenerationInput): Promise<GenerationResult | null> {
  if (!ENABLE_OPENAI_FALLBACK || !process.env.OPENAI_API_KEY) return null;

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const models = parseModels(process.env.OPENAI_MODEL, ["gpt-4o-mini", "gpt-4.1-mini"]);

  return callProvider({
    provider: "openai",
    client,
    models,
    input,
    attemptsPerModel: 1,
  });
}

async function callDeepSeekStream(
  input: GenerationInput,
  onToken?: (text: string) => void
): Promise<GenerationResult | null> {
  if (!process.env.DEEPSEEK_API_KEY) return null;

  const client = new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
  });

  const models = parseModels(process.env.DEEPSEEK_MODEL, ["deepseek-chat"]);
  return callProviderStream({
    provider: "deepseek",
    client,
    models,
    input,
    onToken,
    attemptsPerModel: 1,
  });
}

async function callOpenAIStream(
  input: GenerationInput,
  onToken?: (text: string) => void
): Promise<GenerationResult | null> {
  if (!ENABLE_OPENAI_FALLBACK || !process.env.OPENAI_API_KEY) return null;

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const models = parseModels(process.env.OPENAI_MODEL, ["gpt-4o-mini", "gpt-4.1-mini"]);

  return callProviderStream({
    provider: "openai",
    client,
    models,
    input,
    onToken,
    attemptsPerModel: 1,
  });
}

export async function generateWithGateway(input: GenerationInput): Promise<GenerationResult> {
  const deepSeek = await withTimeout(callDeepSeek(input)).catch((error) => {
    console.warn("deepseek timeout/failure", error);
    return null;
  });
  if (deepSeek) return deepSeek;

  const openai = await withTimeout(callOpenAI(input)).catch((error) => {
    console.warn("openai timeout/failure", error);
    return null;
  });
  if (openai) return openai;

  return {
    text:
      input.locale === "zh"
        ? "模型暂时不可用，请稍后重试。"
        : "Model is temporarily unavailable. Please retry shortly.",
    provider: "rule",
  };
}

export async function generateWithGatewayStream(
  input: GenerationInput,
  onToken?: (text: string) => void
): Promise<GenerationResult> {
  const deepSeek = await withTimeout(callDeepSeekStream(input, onToken), MODEL_STREAM_TIMEOUT_MS).catch((error) => {
    console.warn("deepseek stream timeout/failure", error);
    return null;
  });
  if (deepSeek) return deepSeek;

  const openai = await withTimeout(callOpenAIStream(input, onToken), MODEL_STREAM_TIMEOUT_MS).catch((error) => {
    console.warn("openai stream timeout/failure", error);
    return null;
  });
  if (openai) return openai;

  const fallbackText =
    input.locale === "zh"
      ? "模型暂时不可用，请稍后重试。"
      : "Model is temporarily unavailable. Please retry shortly.";
  if (onToken) onToken(fallbackText);

  return {
    text: fallbackText,
    provider: "rule",
  };
}
