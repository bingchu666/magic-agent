export type LearningRequestType = "practice" | "explanation" | "routine" | "patter" | "general";

export type LearningSignal = {
  hasLearningIntent: boolean;
  goalTopic: string | null;
  goalConfidence: number;
  learningRequestType: LearningRequestType;
};

const GREETING_ONLY = /^(你好|您好|在吗|嗨|hello|hi|hey|yo|ok|好的|嗯|继续|在不在)[!?？。,\s]*$/i;

const LEARNING_VERBS = [
  /练/i,
  /学/i,
  /教我/i,
  /讲解/i,
  /推荐/i,
  /优化/i,
  /流程/i,
  /台词/i,
  /思路/i,
  /practice/i,
  /learn/i,
  /teach/i,
  /train/i,
  /recommend/i,
  /routine/i,
  /coaching/i,
];

const TOPIC_RULES: Array<{ topic: string; pattern: RegExp }> = [
  { topic: "纸牌魔术", pattern: /(纸牌|扑克牌|cards?|double lift|force|pass|控牌|card magic)/i },
  { topic: "硬币魔术", pattern: /(硬币|coin|palming|掌法|coin magic)/i },
  { topic: "舞台魔术", pattern: /(舞台|stage|opener|closer|parlor|stage magic)/i },
  { topic: "心灵魔术", pattern: /(心灵|mentalism|读心|预测|mind reading)/i },
  { topic: "儿童场互动", pattern: /(儿童|kids|亲子|family show)/i },
  { topic: "观众管理与错引", pattern: /(misdirection|错引|观众管理|attention control)/i },
  { topic: "台词与节奏", pattern: /(台词|patter|节奏|timing|presentation)/i },
];

const REQUEST_TYPE_RULES: Array<{ type: LearningRequestType; pattern: RegExp }> = [
  { type: "practice", pattern: /(练|练习|训练|drill|practice|稳定性|consistency)/i },
  { type: "explanation", pattern: /(讲解|解释|原理|why|explain|concept)/i },
  { type: "routine", pattern: /(流程|routine|开场|收尾|opener|closer)/i },
  { type: "patter", pattern: /(台词|patter|脚本|讲词|presentation)/i },
];

export function inferLearningRequestType(text: string): LearningRequestType {
  const input = text.trim();
  for (const rule of REQUEST_TYPE_RULES) {
    if (rule.pattern.test(input)) return rule.type;
  }
  return "general";
}

export function extractGoalTopic(text: string) {
  const input = text.trim();
  if (!input) {
    return {
      goalTopic: null as string | null,
      goalConfidence: 0,
    };
  }

  for (const rule of TOPIC_RULES) {
    if (rule.pattern.test(input)) {
      return {
        goalTopic: rule.topic,
        goalConfidence: 0.92,
      };
    }
  }

  const hasVerb = LEARNING_VERBS.some((regex) => regex.test(input));
  if (hasVerb && input.length >= 4) {
    const compact = input.replace(/[。！？!?]+/g, " ").replace(/\s+/g, " ").trim();
    const clipped = compact.length > 32 ? `${compact.slice(0, 32)}...` : compact;
    return {
      goalTopic: clipped || null,
      goalConfidence: 0.62,
    };
  }

  return {
    goalTopic: null as string | null,
    goalConfidence: 0,
  };
}

export function hasLearningIntent(text: string) {
  return extractLearningSignal(text).hasLearningIntent;
}

export function extractLearningSignal(text: string): LearningSignal {
  const input = text.trim();
  if (!input || GREETING_ONLY.test(input)) {
    return {
      hasLearningIntent: false,
      goalTopic: null,
      goalConfidence: 0,
      learningRequestType: "general",
    };
  }

  const { goalTopic, goalConfidence } = extractGoalTopic(input);
  const hasVerb = LEARNING_VERBS.some((regex) => regex.test(input));
  const hasIntent = Boolean(goalTopic) || (hasVerb && input.length >= 4);

  return {
    hasLearningIntent: hasIntent,
    goalTopic,
    goalConfidence,
    learningRequestType: inferLearningRequestType(input),
  };
}

function normalizeTopic(topic: string | null | undefined) {
  return (topic || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
}

export function hasTopicShift(previousTopic: string | null | undefined, nextTopic: string | null | undefined) {
  if (!previousTopic || !nextTopic) return false;
  const prev = normalizeTopic(previousTopic);
  const next = normalizeTopic(nextTopic);
  if (!prev || !next) return false;
  return prev !== next;
}
