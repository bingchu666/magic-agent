import {
  AppUser,
  AuditLog,
  DbTables,
  Event,
  FileAsset,
  FileInsight,
  FileJob,
  FileJobStatus,
  Locale,
  Message,
  Thread,
  ThreadLearningState,
  VideoAsset,
  VideoDifficulty,
  VideoEmbedding,
  VideoTag,
  VideoRecommendation,
} from "@/lib/domain/types";
import { createId, nowIso } from "@/lib/domain/utils";
import { embedText } from "@/lib/ai/embedding";

type MemoryState = DbTables & {
  uploads: Record<string, ArrayBuffer>;
  thread_learning_state: Record<string, ThreadLearningState>;
};

const DAY_MS = 24 * 60 * 60 * 1000;

const seededVideos: Array<
  Pick<VideoAsset, "title" | "description" | "url" | "language" | "difficulty" | "tags">
> = [
  {
    title: "Ambitious Card 3-minute opener",
    description: "Close-up opener focused on structure, audience focus, and clean ending.",
    url: "https://www.youtube.com/watch?v=3M2fINQvU3M",
    language: "en",
    difficulty: "beginner",
    tags: ["cards", "opener", "close-up"],
  },
  {
    title: "硬币消失与再现完整流程",
    description: "近景硬币流程，重点是消失节奏、再现时机和眼神误导。",
    url: "https://www.bilibili.com/video/BV1bV41117qv",
    language: "zh",
    difficulty: "intermediate",
    tags: ["coin", "misdirection", "close-up"],
  },
  {
    title: "Table hopping reset strategy",
    description: "Fast reset routine design for restaurant walkaround workers.",
    url: "https://www.youtube.com/watch?v=TG6NQf7HSkY",
    language: "en",
    difficulty: "advanced",
    tags: ["table-hopping", "reset", "performance"],
  },
  {
    title: "纸牌控牌稳定性训练",
    description: "聚焦 break、double lift 与错引时机，适合每日训练。",
    url: "https://www.bilibili.com/video/BV1xx411c7mD",
    language: "zh",
    difficulty: "beginner",
    tags: ["cards", "practice", "fundamentals"],
  },
  {
    title: "Double Lift Consistency Drill",
    description: "How to keep your double lift indistinguishable from a single turnover.",
    url: "https://www.youtube.com/watch?v=i8sV7J9Q6dA",
    language: "en",
    difficulty: "beginner",
    tags: ["cards", "double-lift", "practice"],
  },
  {
    title: "经典 force 控制台词设计",
    description: "讲解 force 阶段的语言诱导和停顿控制，避免观众察觉。",
    url: "https://www.bilibili.com/video/BV1r7411Q7rV",
    language: "zh",
    difficulty: "intermediate",
    tags: ["cards", "force", "patter"],
  },
  {
    title: "Coin Across Audience Management",
    description: "Managing spectator focus for coin across without rushing reveals.",
    url: "https://www.youtube.com/watch?v=yZ2KoB4IX9o",
    language: "en",
    difficulty: "intermediate",
    tags: ["coin", "audience", "timing"],
  },
  {
    title: "硬币掌法基础与角度处理",
    description: "硬币掌法、转手角度与观众视角下的风险点。",
    url: "https://www.bilibili.com/video/BV1jW411n7uY",
    language: "zh",
    difficulty: "beginner",
    tags: ["coin", "palming", "fundamentals"],
  },
  {
    title: "Stage Opener: Silk to Cane pacing",
    description: "A stage opener blueprint for timing, music cues, and audience framing.",
    url: "https://www.youtube.com/watch?v=XKXl6S4bx7g",
    language: "en",
    difficulty: "advanced",
    tags: ["stage", "opener", "pacing"],
  },
  {
    title: "舞台开场30秒建立期待感",
    description: "舞台表演首30秒控场方法，避免开场冷场。",
    url: "https://www.bilibili.com/video/BV1tJ411B7kR",
    language: "zh",
    difficulty: "intermediate",
    tags: ["stage", "opener", "audience"],
  },
  {
    title: "Kids Show Energy Control",
    description: "How to control tempo and engagement in family-friendly performances.",
    url: "https://www.youtube.com/watch?v=VW7kT5gK9o0",
    language: "en",
    difficulty: "intermediate",
    tags: ["kids", "performance", "audience"],
  },
  {
    title: "儿童场魔术互动节奏",
    description: "儿童场互动设计与节奏收放，减少失控风险。",
    url: "https://www.bilibili.com/video/BV1Fs411b7rY",
    language: "zh",
    difficulty: "beginner",
    tags: ["kids", "interaction", "performance"],
  },
  {
    title: "Mentalism one-ahead structure",
    description: "Build a one-ahead routine with clear conviction points and reveal beats.",
    url: "https://www.youtube.com/watch?v=5rFQ9N8M3jQ",
    language: "en",
    difficulty: "advanced",
    tags: ["mentalism", "structure", "reveal"],
  },
  {
    title: "心灵魔术揭示时机训练",
    description: "训练揭示时机与停顿，提升心灵效果的冲击力。",
    url: "https://www.bilibili.com/video/BV1zE411z7af",
    language: "zh",
    difficulty: "advanced",
    tags: ["mentalism", "timing", "reveal"],
  },
  {
    title: "Close-up set closer design",
    description: "How to close a 10-minute close-up set with a memorable final beat.",
    url: "https://www.youtube.com/watch?v=p2kYlHq0YqA",
    language: "en",
    difficulty: "intermediate",
    tags: ["close-up", "closer", "routine"],
  },
  {
    title: "近景收尾反转设计",
    description: "近景流程最后30秒的收尾反转，增强记忆点。",
    url: "https://www.bilibili.com/video/BV1w7411K7mY",
    language: "zh",
    difficulty: "intermediate",
    tags: ["close-up", "closer", "routine"],
  },
];

function buildSeedState(): MemoryState {
  const now = nowIso();
  const systemUser: AppUser = {
    id: "system",
    name: "System",
    role: "admin",
    locale: "en",
    createdAt: now,
  };

  const videoAssets: VideoAsset[] = seededVideos.map((video) => {
    const id = createId("video");
    return {
      id,
      createdBy: systemUser.id,
      title: video.title,
      description: video.description,
      url: video.url,
      language: video.language,
      difficulty: video.difficulty,
      status: "published",
      tags: video.tags,
      createdAt: now,
      updatedAt: now,
      publishedAt: now,
    };
  });

  const videoTags: VideoTag[] = videoAssets.flatMap((video) =>
    video.tags.map((tag) => ({
      id: createId("vtag"),
      videoId: video.id,
      tag,
      createdAt: now,
    }))
  );

  const embeddings: VideoEmbedding[] = videoAssets.map((video) => ({
    id: createId("emb"),
    videoId: video.id,
    model: "local-hash-64",
    vector: embedText(`${video.title} ${video.description} ${video.tags.join(" ")}`),
    createdAt: now,
  }));

  return {
    users: [systemUser],
    threads: [],
    messages: [],
    video_assets: videoAssets,
    video_tags: videoTags,
    video_embeddings: embeddings,
    file_assets: [],
    file_jobs: [],
    file_insights: [],
    audit_logs: [],
    events: [],
    thread_learning_state: {},
    uploads: {},
  };
}

declare global {
  var __MAGIC_MEMORY_DB__: MemoryState | undefined;
}

function db(): MemoryState {
  if (!global.__MAGIC_MEMORY_DB__) {
    global.__MAGIC_MEMORY_DB__ = buildSeedState();
  }
  return global.__MAGIC_MEMORY_DB__;
}

export function resetMemoryDbForTests() {
  global.__MAGIC_MEMORY_DB__ = buildSeedState();
}

export const memoryDb = {
  ensureUser(params: { id: string; name: string; role: "user" | "admin"; locale: Locale }) {
    const state = db();
    const existing = state.users.find((item) => item.id === params.id);
    if (existing) {
      existing.name = params.name;
      existing.locale = params.locale;
      existing.role = params.role;
      return existing;
    }

    const user: AppUser = {
      id: params.id,
      name: params.name,
      role: params.role,
      locale: params.locale,
      createdAt: nowIso(),
    };
    state.users.push(user);
    return user;
  },

  listThreads(userId: string) {
    return db()
      .threads
      .filter((thread) => thread.userId === userId)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  },

  getThread(threadId: string) {
    return db().threads.find((thread) => thread.id === threadId) ?? null;
  },

  createThread(userId: string, title: string) {
    const now = nowIso();
    const thread: Thread = {
      id: createId("thread"),
      userId,
      title,
      createdAt: now,
      updatedAt: now,
    };
    db().threads.push(thread);
    return thread;
  },

  touchThread(threadId: string) {
    const thread = this.getThread(threadId);
    if (thread) thread.updatedAt = nowIso();
  },

  deleteThread(threadId: string, userId?: string) {
    const state = db();
    const thread = state.threads.find((item) => item.id === threadId) ?? null;
    if (!thread) return null;
    if (userId && thread.userId !== userId) return null;

    state.threads = state.threads.filter((item) => item.id !== threadId);
    state.messages = state.messages.filter((item) => item.threadId !== threadId);
    state.events = state.events.filter((event) => {
      if (userId && event.userId !== userId) return true;
      const payload = event.payload as Record<string, unknown>;
      return payload.threadId !== threadId;
    });
    delete state.thread_learning_state[threadId];

    return thread;
  },

  listMessages(threadId: string) {
    return db()
      .messages
      .filter((message) => message.threadId === threadId)
      .sort((a, b) => (a.createdAt > b.createdAt ? 1 : -1));
  },

  createMessage(payload: Omit<Message, "id" | "createdAt">) {
    const message: Message = {
      id: createId("msg"),
      createdAt: nowIso(),
      ...payload,
    };
    db().messages.push(message);
    this.touchThread(payload.threadId);
    return message;
  },

  listPublishedVideos(locale?: Locale) {
    return db().video_assets.filter((video) => {
      if (video.status !== "published") return false;
      if (!locale) return true;
      return video.language === locale || video.language === "en";
    });
  },

  listVideosForAdmin() {
    return [...db().video_assets].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  },

  getVideo(videoId: string) {
    return db().video_assets.find((video) => video.id === videoId) ?? null;
  },

  getVideoEmbedding(videoId: string) {
    return db().video_embeddings.find((emb) => emb.videoId === videoId) ?? null;
  },

  createVideo(payload: {
    createdBy: string;
    title: string;
    description: string;
    url: string;
    language: Locale;
    difficulty: VideoDifficulty;
    tags: string[];
  }) {
    const now = nowIso();
    const video: VideoAsset = {
      id: createId("video"),
      createdBy: payload.createdBy,
      title: payload.title,
      description: payload.description,
      url: payload.url,
      language: payload.language,
      difficulty: payload.difficulty,
      tags: payload.tags,
      status: "draft",
      createdAt: now,
      updatedAt: now,
    };

    const embedding: VideoEmbedding = {
      id: createId("emb"),
      videoId: video.id,
      model: "local-hash-64",
      vector: embedText(`${video.title} ${video.description} ${video.tags.join(" ")}`),
      createdAt: now,
    };

    const tags: VideoTag[] = video.tags.map((tag) => ({
      id: createId("vtag"),
      videoId: video.id,
      tag,
      createdAt: now,
    }));

    db().video_assets.push(video);
    db().video_tags.push(...tags);
    db().video_embeddings.push(embedding);
    return video;
  },

  updateVideo(videoId: string, patch: Partial<Omit<VideoAsset, "id" | "createdBy" | "createdAt">>) {
    const video = this.getVideo(videoId);
    if (!video) return null;

    if (typeof patch.title === "string") video.title = patch.title;
    if (typeof patch.description === "string") video.description = patch.description;
    if (typeof patch.url === "string") video.url = patch.url;
    if (patch.language === "zh" || patch.language === "en") video.language = patch.language;
    if (
      patch.difficulty === "beginner" ||
      patch.difficulty === "intermediate" ||
      patch.difficulty === "advanced"
    ) {
      video.difficulty = patch.difficulty;
    }
    if (Array.isArray(patch.tags)) video.tags = patch.tags;
    if (patch.status === "draft" || patch.status === "published") video.status = patch.status;

    video.updatedAt = nowIso();

    const embedding = this.getVideoEmbedding(videoId);
    if (embedding) {
      embedding.vector = embedText(`${video.title} ${video.description} ${video.tags.join(" ")}`);
    }

    if (Array.isArray(patch.tags)) {
      const state = db();
      state.video_tags = state.video_tags.filter((tag) => tag.videoId !== video.id);
      state.video_tags.push(
        ...video.tags.map((tag) => ({
          id: createId("vtag"),
          videoId: video.id,
          tag,
          createdAt: nowIso(),
        }))
      );
    }

    return video;
  },

  publishVideo(videoId: string) {
    const video = this.getVideo(videoId);
    if (!video) return null;
    const now = nowIso();
    video.status = "published";
    video.publishedAt = now;
    video.updatedAt = now;
    return video;
  },

  createFileAsset(payload: {
    userId: string;
    fileName: string;
    mimeType: string;
    size: number;
    storageKey: string;
  }) {
    const now = new Date();
    const file: FileAsset = {
      id: createId("file"),
      userId: payload.userId,
      fileName: payload.fileName,
      mimeType: payload.mimeType,
      size: payload.size,
      storageKey: payload.storageKey,
      status: "uploaded",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 30 * DAY_MS).toISOString(),
    };
    db().file_assets.push(file);
    return file;
  },

  listFiles(userId: string) {
    const now = Date.now();
    return db()
      .file_assets
      .filter((file) => file.userId === userId)
      .map((file) => {
        if (new Date(file.expiresAt).getTime() < now && file.status !== "expired") {
          file.status = "expired";
          file.updatedAt = nowIso();
        }
        return file;
      })
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  },

  getFile(fileId: string) {
    const file = db().file_assets.find((item) => item.id === fileId) ?? null;
    if (!file) return null;
    if (new Date(file.expiresAt).getTime() < Date.now() && file.status !== "expired") {
      file.status = "expired";
      file.updatedAt = nowIso();
    }
    return file;
  },

  saveUpload(fileId: string, buffer: ArrayBuffer) {
    db().uploads[fileId] = buffer;
  },

  getUpload(fileId: string) {
    return db().uploads[fileId] ?? null;
  },

  createFileJob(fileId: string, userId: string) {
    const now = nowIso();
    const job: FileJob = {
      id: createId("job"),
      fileId,
      userId,
      status: "queued",
      createdAt: now,
      updatedAt: now,
    };
    db().file_jobs.push(job);
    return job;
  },

  updateFileJob(jobId: string, status: FileJobStatus, patch?: Partial<FileJob>) {
    const job = db().file_jobs.find((item) => item.id === jobId);
    if (!job) return null;
    job.status = status;
    Object.assign(job, patch ?? {});
    job.updatedAt = nowIso();
    return job;
  },

  getFileJob(jobId: string) {
    return db().file_jobs.find((job) => job.id === jobId) ?? null;
  },

  listAllFileJobs() {
    return [...db().file_jobs].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  },

  listFileJobs(fileId: string) {
    return db()
      .file_jobs
      .filter((job) => job.fileId === fileId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  },

  updateFile(fileId: string, patch: Partial<FileAsset>) {
    const file = this.getFile(fileId);
    if (!file) return null;
    Object.assign(file, patch);
    file.updatedAt = nowIso();
    return file;
  },

  deleteFile(fileId: string, userId?: string) {
    const state = db();
    const index = state.file_assets.findIndex((item) => item.id === fileId);
    if (index < 0) return null;
    const target = state.file_assets[index];
    if (userId && target.userId !== userId) return null;

    state.file_assets.splice(index, 1);
    state.file_jobs = state.file_jobs.filter((job) => job.fileId !== fileId);
    state.file_insights = state.file_insights.filter((insight) => insight.fileId !== fileId);
    delete state.uploads[fileId];

    for (const message of state.messages) {
      if (!Array.isArray(message.attachmentIds) || message.attachmentIds.length === 0) continue;
      message.attachmentIds = message.attachmentIds.filter((id) => id !== fileId);
    }

    return target;
  },

  createFileInsight(payload: Omit<FileInsight, "id" | "createdAt">) {
    const insight: FileInsight = {
      id: createId("insight"),
      createdAt: nowIso(),
      ...payload,
    };
    db().file_insights.push(insight);
    return insight;
  },

  listFileInsightsByIds(userId: string, ids: string[]) {
    const idSet = new Set(ids);
    return db().file_insights.filter((insight) => insight.userId === userId && idSet.has(insight.fileId));
  },

  listRecentFileInsights(userId: string, locale: Locale, limit = 3) {
    return db()
      .file_insights
      .filter((insight) => insight.userId === userId && insight.locale === locale)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, limit);
  },

  createAuditLog(payload: Omit<AuditLog, "id" | "createdAt">) {
    const log: AuditLog = {
      id: createId("audit"),
      createdAt: nowIso(),
      ...payload,
    };
    db().audit_logs.push(log);
    return log;
  },

  listAuditLogs(limit = 120) {
    return [...db().audit_logs]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, limit);
  },

  createEvent(payload: Omit<Event, "id" | "createdAt">) {
    const event: Event = {
      id: createId("event"),
      createdAt: nowIso(),
      ...payload,
    };
    db().events.push(event);
    return event;
  },

  listEvents(limit = 200) {
    return [...db().events]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, limit);
  },

  listRecentlyRecommendedVideoIdsByThread(threadId: string, userId: string, limit = 9) {
    const ids: string[] = [];
    const events = [...db().events]
      .filter((event) => event.userId === userId && event.name === "chat_completion")
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

    for (const event of events) {
      const payload = event.payload as Record<string, unknown>;
      if (payload.threadId !== threadId) continue;
      const videoIds = Array.isArray(payload.recommendationIds)
        ? payload.recommendationIds.map((id) => String(id))
        : [];
      const recommendationUrls = Array.isArray(payload.recommendationUrls)
        ? payload.recommendationUrls.map((url) => String(url))
        : [];
      for (const id of videoIds) {
        if (!ids.includes(id)) ids.push(id);
        if (ids.length >= limit) return ids;
      }
      for (const url of recommendationUrls) {
        if (!ids.includes(url)) ids.push(url);
        if (ids.length >= limit) return ids;
      }
    }

    return ids;
  },

  getLatestThreadRecommendations(threadId: string, userId: string) {
    const events = [...db().events]
      .filter((event) => event.userId === userId && event.name === "chat_completion")
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

    for (const event of events) {
      const payload = event.payload as Record<string, unknown>;
      if (payload.threadId !== threadId) continue;
      if (!Array.isArray(payload.recommendationItems)) continue;

      const items = payload.recommendationItems
        .map((item) => {
          const rec = item as Partial<VideoRecommendation>;
          if (!rec || typeof rec !== "object") return null;
          if (!rec.id || !rec.title || !rec.url || !rec.source) return null;
          return {
            id: String(rec.id),
            title: String(rec.title),
            url: String(rec.url),
            source: String(rec.source),
            verified: Boolean(rec.verified),
            matchScore: Number(rec.matchScore || rec.score || 0),
            normalizedUrl: rec.normalizedUrl ? String(rec.normalizedUrl) : undefined,
            thumbnail: rec.thumbnail ? String(rec.thumbnail) : undefined,
            duration: rec.duration ? String(rec.duration) : undefined,
            qualityScore: Number(rec.qualityScore || 0),
            playableCheckedAt: rec.playableCheckedAt ? String(rec.playableCheckedAt) : undefined,
            goalTopic: rec.goalTopic ? String(rec.goalTopic) : null,
            tags: Array.isArray(rec.tags) ? rec.tags.map((tag) => String(tag)) : [],
            difficulty:
              rec.difficulty === "beginner" ||
              rec.difficulty === "intermediate" ||
              rec.difficulty === "advanced"
                ? rec.difficulty
                : "intermediate",
            reason: rec.reason ? String(rec.reason) : "",
            score: Number(rec.score || rec.matchScore || 0),
          } as VideoRecommendation;
        })
        .filter((item): item is VideoRecommendation => {
          if (!item) return false;
          if (item.source.includes("search")) return false;
          if (/\/results\?|\/search\?|search_query=|keyword=/i.test(item.url)) return false;
          return true;
        });

      if (items.length) return items;
    }

    return [] as VideoRecommendation[];
  },

  getThreadLearningState(threadId: string) {
    return db().thread_learning_state[threadId] ?? null;
  },

  upsertThreadLearningState(payload: Omit<ThreadLearningState, "updatedAt">) {
    const state = db();
    const current = state.thread_learning_state[payload.threadId];
    const next: ThreadLearningState = {
      threadId: payload.threadId,
      goalTopic: payload.goalTopic,
      goalConfidence: payload.goalConfidence,
      learningRequestType: payload.learningRequestType,
      lastRecommendationAt: payload.lastRecommendationAt,
      updatedAt: nowIso(),
    };
    state.thread_learning_state[payload.threadId] = {
      ...(current || {}),
      ...next,
    };
    return state.thread_learning_state[payload.threadId];
  },
};
