import { RecommendationContext } from "@/lib/recommendation/types";
import { recommendationConfig } from "@/lib/recommendation/config";

export async function fetchJsonWithTimeout<T>(
  url: string,
  timeoutMs: number,
  init?: RequestInit
): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(init?.headers || {}),
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as T;
    return data;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchTextWithTimeout(
  url: string,
  timeoutMs: number,
  init?: RequestInit
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml",
        ...(init?.headers || {}),
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function isLowSignalMessage(input: string) {
  const text = input.trim().toLowerCase();
  if (text.length <= 3) return true;
  return /^(你好|在吗|嗨|hi|hello|hey|yo|ok|好的|嗯|嗯嗯|继续|go on)$/i.test(text);
}

function extractUsefulHistory(conversationText: string) {
  const lines = conversationText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .reverse();

  for (const line of lines) {
    if (!/^USER:/i.test(line)) continue;
    const content = line.replace(/^USER:\s*/i, "").trim();
    if (!content || isLowSignalMessage(content)) continue;
    return content;
  }
  return "";
}

function detectTopicAnchor(input: string, locale: "zh" | "en") {
  const text = input.toLowerCase();
  if (/(纸牌|扑克牌|card|double lift|force|控牌)/i.test(text)) {
    return locale === "zh" ? "纸牌魔术 教学 练习 手法" : "card magic tutorial sleight practice";
  }
  if (/(硬币|coin|palming|掌法)/i.test(text)) {
    return locale === "zh" ? "硬币魔术 教学 练习 手法" : "coin magic tutorial sleight practice";
  }
  if (/(舞台|stage|parlor|开场|收尾)/i.test(text)) {
    return locale === "zh" ? "舞台魔术 教学 表演 节奏" : "stage magic performance routine tutorial";
  }
  if (/(心灵|mental|预测|读心)/i.test(text)) {
    return locale === "zh" ? "心灵魔术 教学 表演" : "mentalism magic tutorial performance";
  }
  return locale === "zh" ? "魔术 教学 练习" : "magic tutorial practice";
}

export function buildQueryFromContext(context: RecommendationContext) {
  const current = context.userMessage.trim();
  const historyHint = extractUsefulHistory(context.conversationText);
  const anchor = detectTopicAnchor(`${current} ${historyHint}`.trim(), context.locale);

  const composed = isLowSignalMessage(current)
    ? `${historyHint || anchor} ${anchor}`
    : `${current} ${anchor}`;

  return composed
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, recommendationConfig.maxConversationChars);
}

export function inferDifficulty(text: string) {
  const t = text.toLowerCase();
  if (/(beginner|easy|入门|初学)/i.test(t)) return "beginner" as const;
  if (/(advanced|hard|进阶|高级)/i.test(t)) return "advanced" as const;
  if (/(intermediate|中级)/i.test(t)) return "intermediate" as const;
  return "intermediate" as const;
}

const MAGIC_KEYWORDS = [
  "magic",
  "magician",
  "sleight",
  "trick",
  "illusion",
  "mentalism",
  "close-up magic",
  "stage magic",
  "魔术",
  "幻术",
  "手法",
  "错引",
];

const TOPIC_KEYWORDS = [
  "card",
  "cards",
  "coin",
  "coins",
  "deck",
  "double lift",
  "force",
  "palming",
  "mentalism",
  "close-up",
  "stage",
  "misdirection",
  "纸牌",
  "扑克牌",
  "硬币",
  "控牌",
  "双翻",
  "掌法",
  "心灵",
  "读心",
  "近景",
  "舞台",
];

const TEACHING_KEYWORDS = [
  "tutorial",
  "lesson",
  "teach",
  "teaching",
  "practice",
  "drill",
  "how to",
  "training",
  "guide",
  "explained",
  "breakdown",
  "教程",
  "教学",
  "讲解",
  "练习",
  "训练",
  "步骤",
  "流程",
  "复盘",
  "台词",
  "节奏",
];

const NEGATIVE_KEYWORDS = [
  "toy",
  "toys",
  "collector",
  "box opening",
  "morning routine",
  "assistant demo",
  "pancreas",
  "disease",
  "health",
  "medical",
  "模型",
  "医疗",
  "健康",
  "开箱",
  "盲盒",
  "daily trending",
  "trending videos",
  "hot videos",
  "tiktok",
  "tik tok",
  "王者荣耀",
  "wwe",
  "电竞",
  "gaming",
  "gameplay",
];

function sanitizeTag(tag: string) {
  return tag
    .replace(/\s+/g, " ")
    .replace(/[^a-zA-Z0-9\u4e00-\u9fff\-\s]/g, "")
    .trim()
    .slice(0, 24);
}

export function isMagicRelevant(title: string, description: string, tags: string[] = []) {
  const titleText = `${title}`.toLowerCase();
  const text = `${title} ${description}`.toLowerCase();
  const tagsText = tags.join(" ").toLowerCase();
  const fullText = `${text} ${tagsText}`;
  const hasNegative = NEGATIVE_KEYWORDS.some((keyword) =>
    fullText.includes(keyword.toLowerCase())
  );
  if (hasNegative) return false;

  const titleHasMagic = MAGIC_KEYWORDS.some((keyword) => titleText.includes(keyword.toLowerCase()));
  const titleHasTopic = TOPIC_KEYWORDS.some((keyword) => titleText.includes(keyword.toLowerCase()));
  const hasMagicSignal = MAGIC_KEYWORDS.some((keyword) => text.includes(keyword.toLowerCase()));
  const hasTopicSignal = TOPIC_KEYWORDS.some((keyword) => text.includes(keyword.toLowerCase()));
  const hasTeachingSignal =
    TEACHING_KEYWORDS.some((keyword) => text.includes(keyword.toLowerCase())) ||
    /(tutorial|lesson|practice|guide|教程|教学|练习|训练|讲解|流程)/i.test(tagsText);

  if (titleHasMagic && (titleHasTopic || hasTeachingSignal)) return true;
  if (hasMagicSignal && (hasTopicSignal || hasTeachingSignal)) return true;
  if (hasTopicSignal && hasTeachingSignal) return true;

  const hasStrictTagSupport = /(cards?|coin|mentalism|stage|纸牌|硬币|心灵|舞台)/i.test(tagsText);
  if (titleHasTopic && hasStrictTagSupport && hasMagicSignal) return true;

  return false;
}

export function pickTags(title: string, description: string, fallback: string[] = []) {
  const text = `${title} ${description}`.toLowerCase();
  const tags = new Set<string>(fallback.map(sanitizeTag).filter(Boolean));

  const rules: Array<{ pattern: RegExp; tag: string }> = [
    { pattern: /(card|cards|纸牌|扑克牌|double lift|控牌|force)/i, tag: "cards" },
    { pattern: /(coin|硬币|palming|掌法)/i, tag: "coin" },
    { pattern: /(stage|舞台|parlor|开场)/i, tag: "stage" },
    { pattern: /(kids|儿童|亲子)/i, tag: "kids" },
    { pattern: /(mental|心灵|预测|读心)/i, tag: "mentalism" },
    { pattern: /(practice|训练|练习|drill)/i, tag: "practice" },
    { pattern: /(routine|流程|set|closer|收尾)/i, tag: "routine" },
  ];

  for (const rule of rules) {
    if (rule.pattern.test(text)) tags.add(rule.tag);
  }

  return Array.from(tags).slice(0, 6);
}

export function normalizeText(input: string) {
  return input.replace(/\s+/g, " ").trim();
}
