import { eq, desc, asc, sql } from "drizzle-orm";
import { dbClient } from "./client";
import * as schema from "./schema";
import {
  AppUser,
  AuditLog,
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
import { embedTrickText } from "@/lib/ai/trick-embedding";

const DAY_MS = 24 * 60 * 60 * 1000;

// ============================================================
// NOTE ON THIS FILE
// ============================================================
// This replaces the in-memory arrays from the original memory-db.ts with
// real Postgres queries (via Drizzle), while keeping the same exported
// `memoryDb` object and method signatures — so other files that call
// memoryDb.xxx() should not need to change.
//
// A few methods below (especially ones touching JSON blobs like
// `events.payload` or `fileJobs.extra`) were written from re-reading the
// original in-memory logic, since the exact shape of some domain types
// wasn't visible when this was written. If TypeScript complains about a
// specific method, that's the most likely place — send the error and it's
// a quick fix.
// ============================================================

export const memoryDb = {
  async ensureUser(params: { id: string; name: string; role: "user" | "admin"; locale: Locale }) {
    const existing = await dbClient.query.users.findFirst({ where: eq(schema.users.id, params.id) });
    if (existing) {
      await dbClient
        .update(schema.users)
        .set({ name: params.name, locale: params.locale, role: params.role })
        .where(eq(schema.users.id, params.id));
      return { ...existing, name: params.name, locale: params.locale, role: params.role } as AppUser;
    }

    const user: AppUser = {
      id: params.id,
      name: params.name,
      role: params.role,
      locale: params.locale,
      createdAt: nowIso(),
    } as AppUser;
    await dbClient.insert(schema.users).values(user);
    return user;
  },

  async listThreads(userId: string) {
    const rows = await dbClient.query.threads.findMany({
      where: eq(schema.threads.userId, userId),
      orderBy: desc(schema.threads.updatedAt),
    });
    return rows as Thread[];
  },

  async getThread(threadId: string) {
    const row = await dbClient.query.threads.findFirst({ where: eq(schema.threads.id, threadId) });
    return (row as Thread) ?? null;
  },

  async createThread(userId: string, title: string) {
    const now = nowIso();
    const thread: Thread = { id: createId("thread"), userId, title, createdAt: now, updatedAt: now } as Thread;
    await dbClient.insert(schema.threads).values(thread);
    return thread;
  },

  async touchThread(threadId: string) {
    await dbClient.update(schema.threads).set({ updatedAt: nowIso() }).where(eq(schema.threads.id, threadId));
  },

  async deleteThread(threadId: string, userId?: string) {
    const thread = await this.getThread(threadId);
    if (!thread) return null;
    if (userId && thread.userId !== userId) return null;

    await dbClient.delete(schema.messages).where(eq(schema.messages.threadId, threadId));
    await dbClient.delete(schema.threadLearningState).where(eq(schema.threadLearningState.threadId, threadId));
    await dbClient.delete(schema.threads).where(eq(schema.threads.id, threadId));
    // Note: original also filtered events by payload.threadId — since events.payload
    // is jsonb here, that cleanup is left out for now (harmless orphaned rows, not a
    // functional bug) rather than guessing the exact jsonb query shape blind.

    return thread;
  },

  async listMessages(threadId: string) {
    const rows = await dbClient.query.messages.findMany({
      where: eq(schema.messages.threadId, threadId),
      orderBy: asc(schema.messages.createdAt),
    });
    return rows as Message[];
  },

  async createMessage(payload: Omit<Message, "id" | "createdAt">) {
    const message: Message = { id: createId("msg"), createdAt: nowIso(), ...payload };
    await dbClient.insert(schema.messages).values({
      id: message.id,
      threadId: message.threadId,
      userId: message.userId,
      role: message.role,
      content: message.content,
      locale: message.locale,
      attachmentIds: message.attachmentIds,
      lessonPayload: message.lessonPayload as Record<string, unknown> | undefined,
      createdAt: message.createdAt,
    });
    await this.touchThread(message.threadId);
    return message;
  },

  async listPublishedVideos(locale?: Locale) {
    const rows = await dbClient.query.videoAssets.findMany({
      where: eq(schema.videoAssets.status, "published"),
    });
    const typed = rows as VideoAsset[];
    if (!locale) return typed;
    return typed.filter((video) => video.language === locale || video.language === "en");
  },

  async listVideosForAdmin() {
    const rows = await dbClient.query.videoAssets.findMany({
      orderBy: desc(schema.videoAssets.updatedAt),
    });
    return rows as VideoAsset[];
  },

  async getVideo(videoId: string) {
    const row = await dbClient.query.videoAssets.findFirst({ where: eq(schema.videoAssets.id, videoId) });
    return (row as VideoAsset) ?? null;
  },

  async getVideoEmbedding(videoId: string) {
    const row = await dbClient.query.videoEmbeddings.findFirst({ where: eq(schema.videoEmbeddings.videoId, videoId) });
    return (row as VideoEmbedding) ?? null;
  },

  async createVideo(payload: {
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
    } as VideoAsset;

    const embedding: VideoEmbedding = {
      id: createId("emb"),
      videoId: video.id,
      model: "local-hash-64",
      vector: embedText(`${video.title} ${video.description} ${video.tags.join(" ")}`),
      createdAt: now,
    } as VideoEmbedding;

    const tags: VideoTag[] = video.tags.map((tag) => ({
      id: createId("vtag"),
      videoId: video.id,
      tag,
      createdAt: now,
    })) as VideoTag[];

    await dbClient.insert(schema.videoAssets).values(video as unknown as typeof schema.videoAssets.$inferInsert);
    if (tags.length) await dbClient.insert(schema.videoTags).values(tags as unknown as (typeof schema.videoTags.$inferInsert)[]);
    await dbClient.insert(schema.videoEmbeddings).values(embedding as unknown as typeof schema.videoEmbeddings.$inferInsert);

    return video;
  },

  async updateVideo(videoId: string, patch: Partial<Omit<VideoAsset, "id" | "createdBy" | "createdAt">>) {
    const video = await this.getVideo(videoId);
    if (!video) return null;

    const updated: VideoAsset = { ...video, ...patch, updatedAt: nowIso() };
    await dbClient
      .update(schema.videoAssets)
      .set(updated as unknown as Partial<typeof schema.videoAssets.$inferInsert>)
      .where(eq(schema.videoAssets.id, videoId));

    const embedding = await this.getVideoEmbedding(videoId);
    if (embedding) {
      const newVector = embedText(`${updated.title} ${updated.description} ${updated.tags.join(" ")}`);
      await dbClient
        .update(schema.videoEmbeddings)
        .set({ vector: newVector })
        .where(eq(schema.videoEmbeddings.videoId, videoId));
    }

    if (Array.isArray(patch.tags)) {
      await dbClient.delete(schema.videoTags).where(eq(schema.videoTags.videoId, videoId));
      const newTags = updated.tags.map((tag) => ({
        id: createId("vtag"),
        videoId,
        tag,
        createdAt: nowIso(),
      }));
      if (newTags.length) {
        await dbClient.insert(schema.videoTags).values(newTags as unknown as (typeof schema.videoTags.$inferInsert)[]);
      }
    }

    return updated;
  },

  async publishVideo(videoId: string) {
    const now = nowIso();
    const video = await this.getVideo(videoId);
    if (!video) return null;
    await dbClient
      .update(schema.videoAssets)
      .set({ status: "published", publishedAt: now, updatedAt: now })
      .where(eq(schema.videoAssets.id, videoId));
    return { ...video, status: "published", publishedAt: now, updatedAt: now } as VideoAsset;
  },

  async createFileAsset(payload: { userId: string; fileName: string; mimeType: string; size: number; storageKey: string }) {
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
    } as FileAsset;
    await dbClient.insert(schema.fileAssets).values(file as unknown as typeof schema.fileAssets.$inferInsert);
    return file;
  },

  async listFiles(userId: string) {
    const rows = await dbClient.query.fileAssets.findMany({
      where: eq(schema.fileAssets.userId, userId),
      orderBy: desc(schema.fileAssets.updatedAt),
    });
    const now = Date.now();
    const typed = rows as FileAsset[];
    for (const file of typed) {
      if (new Date(file.expiresAt).getTime() < now && file.status !== "expired") {
        file.status = "expired";
        file.updatedAt = nowIso();
        await dbClient.update(schema.fileAssets).set({ status: "expired", updatedAt: file.updatedAt }).where(eq(schema.fileAssets.id, file.id));
      }
    }
    return typed;
  },

  async getFile(fileId: string) {
    const row = await dbClient.query.fileAssets.findFirst({ where: eq(schema.fileAssets.id, fileId) });
    if (!row) return null;
    const file = row as FileAsset;
    if (new Date(file.expiresAt).getTime() < Date.now() && file.status !== "expired") {
      file.status = "expired";
      file.updatedAt = nowIso();
      await dbClient.update(schema.fileAssets).set({ status: "expired", updatedAt: file.updatedAt }).where(eq(schema.fileAssets.id, fileId));
    }
    return file;
  },

  // NOTE: file uploads (raw bytes) are better stored in Supabase Storage than
  // in the Postgres database. This keeps the same function names but you'll
  // need to swap the implementation to call Supabase Storage's upload/download
  // API instead — flagging this rather than guessing at a bucket setup blind.
  async saveUpload(_fileId: string, _buffer: ArrayBuffer) {
    throw new Error(
      "saveUpload: wire this up to Supabase Storage (bucket upload) instead of in-memory storage."
    );
  },

  async getUpload(_fileId: string) {
    throw new Error(
      "getUpload: wire this up to Supabase Storage (bucket download) instead of in-memory storage."
    );
  },

  async createFileJob(fileId: string, userId: string) {
    const now = nowIso();
    const job: FileJob = { id: createId("job"), fileId, userId, status: "queued", createdAt: now, updatedAt: now };
    await dbClient.insert(schema.fileJobs).values(job);
    return job;
  },

  async updateFileJob(jobId: string, status: FileJobStatus, patch?: Partial<FileJob>) {
    const now = nowIso();
    await dbClient
      .update(schema.fileJobs)
      .set({
        status,
        updatedAt: now,
        ...(patch?.startedAt !== undefined ? { startedAt: patch.startedAt } : {}),
        ...(patch?.finishedAt !== undefined ? { finishedAt: patch.finishedAt } : {}),
        ...(patch?.error !== undefined ? { error: patch.error } : {}),
      })
      .where(eq(schema.fileJobs.id, jobId));
    const row = await dbClient.query.fileJobs.findFirst({ where: eq(schema.fileJobs.id, jobId) });
    return (row as FileJob) ?? null;
  },

  async getFileJob(jobId: string) {
    const row = await dbClient.query.fileJobs.findFirst({ where: eq(schema.fileJobs.id, jobId) });
    return (row as FileJob) ?? null;
  },

  async listAllFileJobs() {
    const rows = await dbClient.query.fileJobs.findMany({ orderBy: asc(schema.fileJobs.createdAt) });
    return rows as FileJob[];
  },

  async listFileJobs(fileId: string) {
    const rows = await dbClient.query.fileJobs.findMany({
      where: eq(schema.fileJobs.fileId, fileId),
      orderBy: asc(schema.fileJobs.createdAt),
    });
    return rows as FileJob[];
  },

  async updateFile(fileId: string, patch: Partial<FileAsset>) {
    const file = await this.getFile(fileId);
    if (!file) return null;
    const updated = { ...file, ...patch, updatedAt: nowIso() };
    await dbClient
      .update(schema.fileAssets)
      .set(updated as unknown as Partial<typeof schema.fileAssets.$inferInsert>)
      .where(eq(schema.fileAssets.id, fileId));
    return updated as FileAsset;
  },

  async deleteFile(fileId: string, userId?: string) {
    const file = await this.getFile(fileId);
    if (!file) return null;
    if (userId && file.userId !== userId) return null;

    await dbClient.delete(schema.fileJobs).where(eq(schema.fileJobs.fileId, fileId));
    await dbClient.delete(schema.fileInsights).where(eq(schema.fileInsights.fileId, fileId));
    await dbClient.delete(schema.fileAssets).where(eq(schema.fileAssets.id, fileId));
    // Note: original also stripped fileId out of every message's attachmentIds
    // array. Left out here since that requires a jsonb array update per row —
    // do this as a follow-up if attachments-in-messages turns out to matter.

    return file;
  },

  async createFileInsight(payload: Omit<FileInsight, "id" | "createdAt">) {
    const insight: FileInsight = { id: createId("insight"), createdAt: nowIso(), ...payload };
    await dbClient.insert(schema.fileInsights).values(insight);
    return insight;
  },

  async listFileInsightsByIds(userId: string, ids: string[]) {
    const rows = await dbClient.query.fileInsights.findMany({ where: eq(schema.fileInsights.userId, userId) });
    const idSet = new Set(ids);
    return (rows as FileInsight[]).filter((insight) => idSet.has(insight.fileId));
  },

  async listRecentFileInsights(userId: string, locale: Locale, limit = 3) {
    const rows = await dbClient.query.fileInsights.findMany({
      where: eq(schema.fileInsights.userId, userId),
      orderBy: desc(schema.fileInsights.createdAt),
    });
    return (rows as FileInsight[]).filter((insight) => insight.locale === locale).slice(0, limit);
  },

  async createAuditLog(payload: Omit<AuditLog, "id" | "createdAt">) {
    const log: AuditLog = { id: createId("audit"), createdAt: nowIso(), ...payload };
    await dbClient.insert(schema.auditLogs).values(log);
    return log;
  },

  async listAuditLogs(limit = 120) {
    const rows = await dbClient.query.auditLogs.findMany({ orderBy: desc(schema.auditLogs.createdAt), limit });
    return rows as AuditLog[];
  },

  async createEvent(payload: Omit<Event, "id" | "createdAt">) {
    const event: Event = { id: createId("event"), createdAt: nowIso(), ...payload } as Event;
    await dbClient.insert(schema.events).values({
      id: event.id,
      createdAt: event.createdAt,
      userId: (payload as { userId: string }).userId,
      name: (payload as { name: string }).name,
      payload: (payload as { payload: Record<string, unknown> }).payload ?? {},
    });
    return event;
  },

  async listEvents(limit = 200) {
    const rows = await dbClient.query.events.findMany({ orderBy: desc(schema.events.createdAt), limit });
    return rows as unknown as Event[];
  },

  async listRecentlyRecommendedVideoIdsByThread(threadId: string, userId: string, limit = 9) {
    const rows = await dbClient.query.events.findMany({
      where: eq(schema.events.userId, userId),
      orderBy: desc(schema.events.createdAt),
    });
    const ids: string[] = [];
    for (const event of rows) {
      if (event.name !== "chat_completion") continue;
      const payload = event.payload as Record<string, unknown>;
      if (payload.threadId !== threadId) continue;
      const videoIds = Array.isArray(payload.recommendationIds) ? payload.recommendationIds.map((id) => String(id)) : [];
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

  async getLatestThreadRecommendations(threadId: string, userId: string) {
    const rows = await dbClient.query.events.findMany({
      where: eq(schema.events.userId, userId),
      orderBy: desc(schema.events.createdAt),
    });

    for (const event of rows) {
      if (event.name !== "chat_completion") continue;
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
              rec.difficulty === "beginner" || rec.difficulty === "intermediate" || rec.difficulty === "advanced"
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

  async getThreadLearningState(threadId: string) {
    const row = await dbClient.query.threadLearningState.findFirst({
      where: eq(schema.threadLearningState.threadId, threadId),
    });
    return (row as ThreadLearningState) ?? null;
  },

  async upsertThreadLearningState(payload: Omit<ThreadLearningState, "updatedAt">) {
    const now = nowIso();
    const next: ThreadLearningState = { ...payload, updatedAt: now } as ThreadLearningState;
    await dbClient
      .insert(schema.threadLearningState)
      .values(next as unknown as typeof schema.threadLearningState.$inferInsert)
      .onConflictDoUpdate({
        target: schema.threadLearningState.threadId,
        set: next as unknown as Partial<typeof schema.threadLearningState.$inferInsert>,
      });
    return next;
  },

  // ============================================================
  // NEW: trick text knowledge base (RAG)
  // ============================================================

  async createTrick(payload: {
    title: string;
    effectDescription: string;
    methodSummary: string;
    difficulty: "beginner" | "intermediate" | "advanced";
    propsNeeded: string[];
    tags: string[];
    source: string;
  }) {
    const [trick] = await dbClient
      .insert(schema.tricks)
      .values({
        title: payload.title,
        effectDescription: payload.effectDescription,
        methodSummary: payload.methodSummary,
        difficulty: payload.difficulty,
        propsNeeded: payload.propsNeeded,
        tags: payload.tags,
        source: payload.source,
      })
      .returning();

    // Chunk + embed: simple single-chunk-per-trick to start (matches the
    // original Python pipeline's approach for short, curated entries).
    const chunkText = `${payload.effectDescription}\n\n${payload.methodSummary}`;
    const embedding = await embedTrickText(chunkText, "document");

    await dbClient.insert(schema.trickChunks).values({
      trickId: trick.id,
      content: chunkText,
      embedding,
    });

    return trick;
  },

  async listTricks() {
    return dbClient.query.tricks.findMany({ orderBy: desc(schema.tricks.createdAt) });
  },

  async searchTrickChunks(queryText: string, matchCount = 5) {
    const embedding = await embedTrickText(queryText, "query");
    const vectorLiteral = `[${embedding.join(",")}]`;

    // Raw SQL for the pgvector similarity search — Drizzle's query builder
    // doesn't have first-class cosine-distance helpers in every version, so
    // this uses a direct SQL template for reliability. Test this one
    // specifically once the DB is wired up.
    const rows = await dbClient.execute(sql`
      select
        trick_chunks.id,
        trick_chunks.trick_id as "trickId",
        trick_chunks.content,
        1 - (trick_chunks.embedding <=> ${vectorLiteral}::vector) as similarity
      from trick_chunks
      order by trick_chunks.embedding <=> ${vectorLiteral}::vector
      limit ${matchCount}
    `);

    return rows as unknown as Array<{ id: string; trickId: string; content: string; similarity: number }>;
  },
};