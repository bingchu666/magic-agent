export type Locale = "zh" | "en";
export type UserRole = "user" | "admin";

export type AppUser = {
  id: string;
  name: string;
  role: UserRole;
  locale: Locale;
  createdAt: string;
};

export type Thread = {
  id: string;
  userId: string;
  title: string;
  // True while `title` is still the immediate truncated placeholder set at
  // creation time and a short AI-generated title upgrade is still pending.
  titlePending?: boolean;
  parentThreadId?: string | null;
  sourceTerm?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ThreadLearningState = {
  threadId: string;
  goalTopic: string | null;
  goalConfidence: number;
  learningRequestType: "practice" | "explanation" | "routine" | "patter" | "general";
  lastRecommendationAt: string | null;
  updatedAt: string;
};

export type UserOnboarding = {
  userId: string;
  answers: Record<string, string | string[]>;
  completedAt: string | null;
  skipCount: number;
  updatedAt: string;
};

export type MessageRole = "user" | "assistant" | "system";

export type LessonCard = {
  title: string;
  bullets: string[];
};

export type LessonStep = {
  step: string;
  audienceSees: string[];
  youSay: string[];
  youDo: string[];
  practice: string[];
};

export type LessonPayload = {
  summary: string;
  cards: LessonCard[];
  next: string[];
  safety?: string;
  lesson?: {
    steps: LessonStep[];
    checklist: string[];
    commonMistakes: string[];
  };
};

export type Message = {
  id: string;
  threadId: string;
  userId: string;
  role: MessageRole;
  content: string;
  locale: Locale;
  attachmentIds?: string[];
  lessonPayload?: LessonPayload;
  createdAt: string;
};

export type VideoDifficulty = "beginner" | "intermediate" | "advanced";
export type VideoStatus = "draft" | "published";

export type VideoAsset = {
  id: string;
  createdBy: string;
  title: string;
  description: string;
  url: string;
  language: Locale;
  difficulty: VideoDifficulty;
  status: VideoStatus;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
};

export type VideoEmbedding = {
  id: string;
  videoId: string;
  model: string;
  vector: number[];
  createdAt: string;
};

export type VideoTag = {
  id: string;
  videoId: string;
  tag: string;
  createdAt: string;
};

export type FileStatus = "uploaded" | "processing" | "ready" | "failed" | "expired";

export type FileAsset = {
  id: string;
  userId: string;
  fileName: string;
  mimeType: string;
  size: number;
  status: FileStatus;
  storageKey: string;
  previewText?: string;
  summaryZh?: string;
  summaryEn?: string;
  translatedZh?: string;
  translatedEn?: string;
  createdAt: string;
  expiresAt: string;
  updatedAt: string;
};

export type FileJobStatus = "queued" | "processing" | "done" | "failed";

export type FileJob = {
  id: string;
  fileId: string;
  userId: string;
  status: FileJobStatus;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

export type FileInsight = {
  id: string;
  fileId: string;
  userId: string;
  kind: "summary" | "translation" | "key_points";
  locale: Locale;
  content: string;
  createdAt: string;
};

export type AuditLog = {
  id: string;
  userId: string;
  action: string;
  details: string;
  createdAt: string;
};

export type Event = {
  id: string;
  userId: string;
  name: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type VideoRecommendation = {
  id: string;
  title: string;
  url: string;
  source: string;
  verified: boolean;
  matchScore: number;
  normalizedUrl?: string;
  thumbnail?: string;
  duration?: string;
  qualityScore?: number;
  playableCheckedAt?: string;
  goalTopic?: string | null;
  tags: string[];
  difficulty: VideoDifficulty;
  reason: string;
  score: number;
};

export type ChatIntent = "chat" | "lesson" | "translation" | "analysis";

export type SafetyResult = {
  mode: "allow" | "downgrade";
  reason?: string;
  userFacingNotice?: string;
};

/** A matched knowledge-base entry, tagged by which table it came from so the
 * UI never conflates a trick hit with a glossary hit (or a magician bio hit). */
export type KnowledgeSourceRef = {
  title: string;
  source: "trick" | "term" | "person";
};

export type AgentOutput = {
  text: string;
  locale: Locale;
  intent: ChatIntent;
  cards?: LessonPayload;
  recommendations: VideoRecommendation[];
  recommendationRefreshed: boolean;
  refreshReason: "learning_intent" | "topic_shift" | "keep_previous";
  goalTopic: string | null;
  usedFileInsights: FileInsight[];
  knowledgeSources: KnowledgeSourceRef[];
  safety: SafetyResult;
  provider: "deepseek" | "openai" | "rule";
};

export type ChatStreamRequest = {
  threadId?: string;
  userMessage: string;
  locale: Locale;
  attachmentIds?: string[];
  clientHistory?: ChatHistoryMessage[];
  responseMode?: "plain" | "annotated";
  /**
   * Knowledge sources the caller already resolved before sending this
   * message (e.g. a glossary hit whose definition was appended into
   * userMessage as forced reference material). Merged into the server's own
   * retrieval-derived knowledgeSources so the "hit the knowledge base" UI
   * state and citation instructions reflect it too.
   */
  presetKnowledgeSources?: KnowledgeSourceRef[];
};

export type ChatHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

export type SseEventType =
  | "token"
  | "cards"
  | "video_recommendations"
  | "thread"
  | "done"
  | "error";

export type ChatSsePayloadMap = {
  token: { text: string };
  cards: LessonPayload;
  video_recommendations: { items: VideoRecommendation[] };
  thread: { threadId: string; messageId: string; title: string };
  done: {
    messageId: string;
    provider: AgentOutput["provider"];
    recommendationRefreshed: boolean;
    refreshReason: AgentOutput["refreshReason"];
    goalTopic: string | null;
    knowledgeSources: KnowledgeSourceRef[];
    annotatedText?: string;
  };
  error: { message: string };
};

export type DbTables = {
  users: AppUser[];
  threads: Thread[];
  messages: Message[];
  video_assets: VideoAsset[];
  video_tags: VideoTag[];
  video_embeddings: VideoEmbedding[];
  file_assets: FileAsset[];
  file_jobs: FileJob[];
  file_insights: FileInsight[];
  audit_logs: AuditLog[];
  events: Event[];
};
