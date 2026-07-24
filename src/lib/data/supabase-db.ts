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
  UserRole,
  VideoAsset,
  VideoDifficulty,
  VideoEmbedding,
  VideoTag,
  VideoRecommendation,
} from "@/lib/domain/types";
import { createId, nowIso } from "@/lib/domain/utils";
import { embedText } from "@/lib/ai/embedding";
import { embedTrickText } from "@/lib/ai/trick-embedding";
import { buildTrickKeywordPlan, rankKeywordTricks } from "@/lib/ai/trick-keyword-search";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { createServerClient } from "@supabase/ssr";
import { AsyncLocalStorage } from "node:async_hooks";
import { fromDatabaseRow, fromDatabaseRows, toDatabaseRow } from "@/lib/data/case-mapper";

// ── Helpers ──────────────────────────────────────────────

type RequestCookieStore = {
  cookieHeader: string;
  client?: ReturnType<typeof createServerClient>;
};

const cookieStorage = new AsyncLocalStorage<RequestCookieStore>();

/** Wrap an async operation with a captured cookie header for SSE streams */
export function withRequestCookie<T>(cookieHeader: string, fn: () => Promise<T>): Promise<T> {
  return cookieStorage.run({ cookieHeader }, fn);
}

async function sc() {
  const store = cookieStorage.getStore();
  if (store) {
    // Reuse one client for the whole streamed request instead of constructing
    // (and re-parsing the cookie header) a new one on every DB call.
    if (!store.client) {
      const cookieMap = new Map<string, string>();
      store.cookieHeader.split(";").forEach((part) => {
        const idx = part.indexOf("=");
        if (idx > 0) cookieMap.set(part.slice(0, idx).trim(), part.slice(idx + 1));
      });
      store.client = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          cookies: {
            get(name: string) { return cookieMap.get(name); },
            set() {},
            remove() {},
          },
        }
      );
    }
    return store.client;
  }
  return getSupabaseServerClient();
}

function assertNoError(error: { message?: string } | null, action: string) {
  if (error) throw new Error(`${action}: ${error.message ?? "database error"}`);
}

function parseVector(value: unknown): number[] {
  if (Array.isArray(value)) return value.map(Number).filter(Number.isFinite);
  if (typeof value !== "string") return [];
  return value
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map(Number)
    .filter(Number.isFinite);
}

function mapVideo(data: unknown): VideoAsset | null {
  const row = fromDatabaseRow<VideoAsset & { videoTags?: Array<{ tag?: unknown }> }>(data);
  if (!row) return null;
  return {
    ...row,
    tags: Array.isArray(row.videoTags)
      ? row.videoTags.map((item) => String(item.tag ?? "")).filter(Boolean)
      : [],
  };
}

async function searchTricksByKeyword(queryText: string, matchCount: number) {
  const plan = buildTrickKeywordPlan(queryText);
  if (plan.terms.length === 0 && !plan.broadMagicRequest) return [];

  const supabase = await sc();
  const columns = "id,title,method_summary,difficulty,props_needed,tags";
  const candidateLimit = Math.min(30, Math.max(matchCount * 3, 8));

  const result = plan.terms.length > 0
    ? await supabase
        .from("tricks")
        .select(columns)
        .or(
          plan.terms
            .flatMap((term) => [
              `title.ilike.%${term}%`,
              `method_summary.ilike.%${term}%`,
            ])
            .join(",")
        )
        .limit(candidateLimit)
    : await supabase
        .from("tricks")
        .select(columns)
        .eq("difficulty", "beginner")
        .order("created_at", { ascending: true })
        .limit(candidateLimit);

  if (result.error) {
    throw new Error(`Failed to search trick keywords: ${result.error.message}`);
  }

  return rankKeywordTricks(
    (result.data || []) as Record<string, unknown>[],
    plan.terms,
    matchCount
  );
}

// ── Users / Profiles ─────────────────────────────────────

export const supabaseDb = {
  async ensureUser(params: { id: string; name: string; role: UserRole; locale: Locale }): Promise<AppUser> {
    const supabase = await sc();
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", params.id)
      .maybeSingle();

    assertNoError(error, "Failed to load user profile");
    const profile = fromDatabaseRow<AppUser>(data);
    if (!profile) throw new Error("User profile is missing");
    return profile;
  },

  // ── Threads ────────────────────────────────────────────

  async listThreads(userId: string): Promise<Thread[]> {
    const supabase = await sc();
    const { data, error } = await supabase
      .from("threads")
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });
    assertNoError(error, "Failed to list threads");
    return fromDatabaseRows<Thread>(data);
  },

  async getThread(threadId: string): Promise<Thread | null> {
    const supabase = await sc();
    const { data, error } = await supabase.from("threads").select("*").eq("id", threadId).maybeSingle();
    assertNoError(error, "Failed to load thread");
    return fromDatabaseRow<Thread>(data);
  },

  async createThread(userId: string, title: string): Promise<Thread> {
    const supabase = await sc();
    const now = nowIso();
    const thread: Thread = {
      id: createId("thread"),
      userId,
      title,
      createdAt: now,
      updatedAt: now,
    };
    const { error } = await supabase.from("threads").insert(toDatabaseRow(thread));
    assertNoError(error, "Failed to create thread");
    return thread;
  },

  async touchThread(threadId: string): Promise<void> {
    const supabase = await sc();
    const { error } = await supabase.from("threads").update({ updated_at: nowIso() }).eq("id", threadId);
    assertNoError(error, "Failed to update thread");
  },

  async deleteThread(threadId: string, userId?: string): Promise<Thread | null> {
    const supabase = await sc();
    const thread = await supabaseDb.getThread(threadId);
    if (!thread) return null;
    if (userId && thread.userId !== userId) return null;

    const { error: messageError } = await supabase.from("messages").delete().eq("thread_id", threadId);
    assertNoError(messageError, "Failed to delete thread messages");
    const { error: learningStateError } = await supabase.from("thread_learning_state").delete().eq("thread_id", threadId);
    assertNoError(learningStateError, "Failed to delete thread learning state");
    const { error: threadError } = await supabase.from("threads").delete().eq("id", threadId);
    assertNoError(threadError, "Failed to delete thread");

    return thread;
  },

  // ── Messages ───────────────────────────────────────────

  async listMessages(threadId: string): Promise<Message[]> {
    const supabase = await sc();
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true });
    assertNoError(error, "Failed to list messages");
    return fromDatabaseRows<Message>(data);
  },

  async createMessage(payload: Omit<Message, "id" | "createdAt">): Promise<Message> {
    const supabase = await sc();
    const message: Message = {
      id: createId("msg"),
      createdAt: nowIso(),
      ...payload,
    };
    const { error } = await supabase.from("messages").insert(toDatabaseRow(message));
    assertNoError(error, "Failed to create message");
    await supabaseDb.touchThread(payload.threadId);
    return message;
  },

  // ── Videos ─────────────────────────────────────────────

  async listPublishedVideos(locale?: Locale): Promise<VideoAsset[]> {
    const supabase = await sc();
    const { data, error } = await supabase
      .from("video_assets")
      .select("*, video_tags(tag)")
      .eq("status", "published");
    assertNoError(error, "Failed to list published videos");
    const videos = Array.isArray(data)
      ? data.map(mapVideo).filter((video): video is VideoAsset => video !== null)
      : [];
    if (!locale) return videos;
    return videos.filter((v) => v.language === locale || v.language === "en");
  },

  async listVideosForAdmin(): Promise<VideoAsset[]> {
    const supabase = await sc();
    const { data, error } = await supabase
      .from("video_assets")
      .select("*, video_tags(tag)")
      .order("updated_at", { ascending: false });
    assertNoError(error, "Failed to list videos");
    return Array.isArray(data)
      ? data.map(mapVideo).filter((video): video is VideoAsset => video !== null)
      : [];
  },

  async getVideo(videoId: string): Promise<VideoAsset | null> {
    const supabase = await sc();
    const { data, error } = await supabase
      .from("video_assets")
      .select("*, video_tags(tag)")
      .eq("id", videoId)
      .maybeSingle();
    assertNoError(error, "Failed to load video");
    return mapVideo(data);
  },

  async getVideoEmbedding(videoId: string): Promise<VideoEmbedding | null> {
    const supabase = await sc();
    const { data, error } = await supabase
      .from("video_embeddings")
      .select("*")
      .eq("video_id", videoId)
      .maybeSingle();
    assertNoError(error, "Failed to load video embedding");
    const row = fromDatabaseRow<Omit<VideoEmbedding, "vector"> & { embedding?: unknown }>(data);
    if (!row) return null;
    const { embedding, ...fields } = row;
    return { ...fields, vector: parseVector(embedding) } as VideoEmbedding;
  },

  async createVideo(payload: {
    createdBy: string;
    title: string;
    description: string;
    url: string;
    language: Locale;
    difficulty: VideoDifficulty;
    tags: string[];
  }): Promise<VideoAsset> {
    const supabase = await sc();
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

    const videoRow = toDatabaseRow(video);
    delete videoRow.tags;
    const { error: videoError } = await supabase.from("video_assets").insert(videoRow);
    assertNoError(videoError, "Failed to create video");

    if (payload.tags.length > 0) {
      const tags: VideoTag[] = payload.tags.map((tag) => ({
        id: createId("vtag"),
        videoId: video.id,
        tag,
        createdAt: now,
      }));
      const { error: tagError } = await supabase
        .from("video_tags")
        .insert(tags.map((tag) => toDatabaseRow(tag)));
      if (tagError) await supabase.from("video_assets").delete().eq("id", video.id);
      assertNoError(tagError, "Failed to create video tags");
    }

    const { error: embeddingError } = await supabase.from("video_embeddings").insert({
      id: createId("emb"),
      video_id: video.id,
      model: "local-hash-64",
      embedding: embedText(`${video.title} ${video.description} ${payload.tags.join(" ")}`),
      created_at: now,
    });
    if (embeddingError) {
      await supabase.from("video_tags").delete().eq("video_id", video.id);
      await supabase.from("video_assets").delete().eq("id", video.id);
    }
    assertNoError(embeddingError, "Failed to create video embedding");

    return video;
  },

  async updateVideo(videoId: string, patch: Partial<Omit<VideoAsset, "id" | "createdBy" | "createdAt">>): Promise<VideoAsset | null> {
    const supabase = await sc();
    const video = await supabaseDb.getVideo(videoId);
    if (!video) return null;

    const updates: Record<string, unknown> = { updatedAt: nowIso() };
    if (typeof patch.title === "string") updates.title = patch.title;
    if (typeof patch.description === "string") updates.description = patch.description;
    if (typeof patch.url === "string") updates.url = patch.url;
    if (patch.language === "zh" || patch.language === "en") updates.language = patch.language;
    if (patch.difficulty) updates.difficulty = patch.difficulty;
    if (patch.status) updates.status = patch.status;

    const { error: updateError } = await supabase
      .from("video_assets")
      .update(toDatabaseRow(updates))
      .eq("id", videoId);
    assertNoError(updateError, "Failed to update video");

    // Update embedding
    const emb = await supabaseDb.getVideoEmbedding(videoId);
    if (emb) {
      const t = typeof updates.title === "string" ? updates.title : video.title;
      const d = typeof updates.description === "string" ? updates.description : video.description;
      const nextTags = Array.isArray(patch.tags) ? patch.tags : video.tags;
      const { error: embeddingError } = await supabase.from("video_embeddings").update({
        embedding: embedText(`${t} ${d} ${nextTags.join(" ")}`),
      }).eq("id", emb.id);
      assertNoError(embeddingError, "Failed to update video embedding");
    }

    // Sync tags if changed
    if (Array.isArray(patch.tags)) {
      const { error: deleteTagError } = await supabase.from("video_tags").delete().eq("video_id", videoId);
      assertNoError(deleteTagError, "Failed to replace video tags");
      const tags: VideoTag[] = patch.tags.map((tag) => ({
        id: createId("vtag"),
        videoId,
        tag,
        createdAt: nowIso(),
      }));
      if (tags.length > 0) {
        const { error: tagError } = await supabase
          .from("video_tags")
          .insert(tags.map((tag) => toDatabaseRow(tag)));
        assertNoError(tagError, "Failed to update video tags");
      }
    }

    return await supabaseDb.getVideo(videoId);
  },

  async publishVideo(videoId: string): Promise<VideoAsset | null> {
    const supabase = await sc();
    const now = nowIso();
    const { error } = await supabase.from("video_assets").update({
      status: "published",
      published_at: now,
      updated_at: now,
    }).eq("id", videoId);
    assertNoError(error, "Failed to publish video");

    return supabaseDb.getVideo(videoId);
  },

  // ── Files ──────────────────────────────────────────────

  async createFileAsset(payload: {
    userId: string;
    fileName: string;
    mimeType: string;
    size: number;
    storageKey: string;
  }): Promise<FileAsset> {
    const supabase = await sc();
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
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    };
    const { error } = await supabase.from("file_assets").insert(toDatabaseRow(file));
    assertNoError(error, "Failed to create file");
    return file;
  },

  async listFiles(userId: string): Promise<FileAsset[]> {
    const supabase = await sc();
    const now = Date.now();
    const { data, error } = await supabase
      .from("file_assets")
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });

    assertNoError(error, "Failed to list files");
    const files = fromDatabaseRows<FileAsset>(data);
    // Mark expired files
    for (const file of files) {
      if (new Date(file.expiresAt).getTime() < now && file.status !== "expired") {
        file.status = "expired";
        const { error: expiryError } = await supabase
          .from("file_assets")
          .update({ status: "expired", updated_at: nowIso() })
          .eq("id", file.id);
        assertNoError(expiryError, "Failed to expire file");
      }
    }
    return files;
  },

  async getFile(fileId: string): Promise<FileAsset | null> {
    const supabase = await sc();
    const { data, error } = await supabase.from("file_assets").select("*").eq("id", fileId).maybeSingle();
    assertNoError(error, "Failed to load file");
    const file = fromDatabaseRow<FileAsset>(data);
    if (file && new Date(file.expiresAt).getTime() < Date.now() && file.status !== "expired") {
      file.status = "expired";
      const { error: expiryError } = await supabase
        .from("file_assets")
        .update({ status: "expired", updated_at: nowIso() })
        .eq("id", file.id);
      assertNoError(expiryError, "Failed to expire file");
    }
    return file;
  },

  async saveUpload(fileId: string, buffer: ArrayBuffer): Promise<void> {
    const supabase = await sc();
    const file = await supabaseDb.getFile(fileId);
    if (!file) throw new Error("File metadata not found");
    const { error } = await supabase.storage.from("file-uploads").upload(file.storageKey, buffer, { upsert: true });
    assertNoError(error, "Failed to upload file");
  },

  async getUpload(fileId: string): Promise<ArrayBuffer | null> {
    const supabase = await sc();
    const file = await supabaseDb.getFile(fileId);
    if (!file) return null;
    const { data, error } = await supabase.storage.from("file-uploads").download(file.storageKey);
    if (error || !data) return null;
    return data.arrayBuffer();
  },

  async createFileJob(fileId: string, userId: string): Promise<FileJob> {
    const supabase = await sc();
    const now = nowIso();
    const job: FileJob = {
      id: createId("job"),
      fileId,
      userId,
      status: "queued",
      createdAt: now,
      updatedAt: now,
    };
    const { error } = await supabase.from("file_jobs").insert(toDatabaseRow(job));
    assertNoError(error, "Failed to create file job");
    return job;
  },

  async updateFileJob(jobId: string, status: FileJobStatus, patch?: Partial<FileJob>): Promise<FileJob | null> {
    const supabase = await sc();
    const { error: updateError } = await supabase
      .from("file_jobs")
      .update(toDatabaseRow({ ...patch, status, updatedAt: nowIso() }))
      .eq("id", jobId);
    assertNoError(updateError, "Failed to update file job");
    const { data, error } = await supabase.from("file_jobs").select("*").eq("id", jobId).maybeSingle();
    assertNoError(error, "Failed to load updated file job");
    return fromDatabaseRow<FileJob>(data);
  },

  async getFileJob(jobId: string): Promise<FileJob | null> {
    const supabase = await sc();
    const { data, error } = await supabase.from("file_jobs").select("*").eq("id", jobId).maybeSingle();
    assertNoError(error, "Failed to load file job");
    return fromDatabaseRow<FileJob>(data);
  },

  async listAllFileJobs(): Promise<FileJob[]> {
    const supabase = await sc();
    const { data, error } = await supabase.from("file_jobs").select("*").order("created_at", { ascending: false });
    assertNoError(error, "Failed to list file jobs");
    return fromDatabaseRows<FileJob>(data);
  },

  async listFileJobs(fileId: string): Promise<FileJob[]> {
    const supabase = await sc();
    const { data, error } = await supabase
      .from("file_jobs")
      .select("*")
      .eq("file_id", fileId)
      .order("created_at", { ascending: false });
    assertNoError(error, "Failed to list file jobs");
    return fromDatabaseRows<FileJob>(data);
  },

  async updateFile(fileId: string, patch: Partial<FileAsset>): Promise<FileAsset | null> {
    const supabase = await sc();
    const { error } = await supabase
      .from("file_assets")
      .update(toDatabaseRow({ ...patch, updatedAt: nowIso() }))
      .eq("id", fileId);
    assertNoError(error, "Failed to update file");
    return supabaseDb.getFile(fileId);
  },

  async deleteFile(fileId: string, userId?: string): Promise<FileAsset | null> {
    const supabase = await sc();
    const file = await supabaseDb.getFile(fileId);
    if (!file) return null;
    if (userId && file.userId !== userId) return null;

    const { error: jobsError } = await supabase.from("file_jobs").delete().eq("file_id", fileId);
    assertNoError(jobsError, "Failed to delete file jobs");
    const { error: insightsError } = await supabase.from("file_insights").delete().eq("file_id", fileId);
    assertNoError(insightsError, "Failed to delete file insights");
    const { error: fileError } = await supabase.from("file_assets").delete().eq("id", fileId);
    assertNoError(fileError, "Failed to delete file");

    // Clean up storage
    const { error: storageError } = await supabase.storage.from("file-uploads").remove([file.storageKey]);
    assertNoError(storageError, "Failed to delete stored file");

    return file;
  },

  // ── File Insights ──────────────────────────────────────

  async createFileInsight(payload: Omit<FileInsight, "id" | "createdAt">): Promise<FileInsight> {
    const supabase = await sc();
    const insight: FileInsight = {
      id: createId("insight"),
      createdAt: nowIso(),
      ...payload,
    };
    const { error } = await supabase.from("file_insights").insert(toDatabaseRow(insight));
    assertNoError(error, "Failed to create file insight");
    return insight;
  },

  async listFileInsightsByIds(userId: string, ids: string[]): Promise<FileInsight[]> {
    if (ids.length === 0) return [];
    const supabase = await sc();
    const { data, error } = await supabase
      .from("file_insights")
      .select("*")
      .eq("user_id", userId)
      .in("file_id", ids);
    assertNoError(error, "Failed to list file insights");
    return fromDatabaseRows<FileInsight>(data);
  },

  async listRecentFileInsights(userId: string, locale: Locale, limit = 3): Promise<FileInsight[]> {
    const supabase = await sc();
    const { data, error } = await supabase
      .from("file_insights")
      .select("*")
      .eq("user_id", userId)
      .eq("locale", locale)
      .order("created_at", { ascending: false })
      .limit(limit);
    assertNoError(error, "Failed to list recent file insights");
    return fromDatabaseRows<FileInsight>(data);
  },

  // ── Audit Logs ─────────────────────────────────────────

  async createAuditLog(payload: Omit<AuditLog, "id" | "createdAt">): Promise<AuditLog> {
    const supabase = await sc();
    const log: AuditLog = {
      id: createId("audit"),
      createdAt: nowIso(),
      ...payload,
    };
    const { error } = await supabase.from("audit_logs").insert(toDatabaseRow(log));
    assertNoError(error, "Failed to create audit log");
    return log;
  },

  async listAuditLogs(limit = 120): Promise<AuditLog[]> {
    const supabase = await sc();
    const { data, error } = await supabase
      .from("audit_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    assertNoError(error, "Failed to list audit logs");
    return fromDatabaseRows<AuditLog>(data);
  },

  // ── Events ─────────────────────────────────────────────

  async createEvent(payload: Omit<Event, "id" | "createdAt">): Promise<Event> {
    const supabase = await sc();
    const event: Event = {
      id: createId("event"),
      createdAt: nowIso(),
      ...payload,
    };
    const { error } = await supabase.from("events").insert(toDatabaseRow(event));
    assertNoError(error, "Failed to create event");
    return event;
  },

  async listEvents(limit = 200): Promise<Event[]> {
    const supabase = await sc();
    const { data, error } = await supabase
      .from("events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    assertNoError(error, "Failed to list events");
    return fromDatabaseRows<Event>(data);
  },

  // ── Recommendations (event-based) ──────────────────────

  async listRecentlyRecommendedVideoIdsByThread(threadId: string, userId: string, limit = 9): Promise<string[]> {
    const supabase = await sc();
    const { data, error } = await supabase
      .from("events")
      .select("*")
      .eq("user_id", userId)
      .eq("name", "chat_completion")
      .order("created_at", { ascending: false });

    assertNoError(error, "Failed to list recommendation events");
    const events = fromDatabaseRows<Event>(data);
    const ids: string[] = [];
    for (const event of events) {
      const payload = event.payload as Record<string, unknown>;
      if (payload.threadId !== threadId) continue;
      const videoIds = Array.isArray(payload.recommendationIds)
        ? payload.recommendationIds.map((id) => String(id))
        : [];
      for (const id of videoIds) {
        if (!ids.includes(id)) ids.push(id);
        if (ids.length >= limit) return ids;
      }
    }
    return ids;
  },

  async getLatestThreadRecommendations(threadId: string, userId: string): Promise<VideoRecommendation[]> {
    const supabase = await sc();
    const { data, error } = await supabase
      .from("events")
      .select("*")
      .eq("user_id", userId)
      .eq("name", "chat_completion")
      .order("created_at", { ascending: false });

    assertNoError(error, "Failed to load recommendation events");
    const events = fromDatabaseRows<Event>(data);
    for (const event of events) {
      const payload = event.payload as Record<string, unknown>;
      if (payload.threadId !== threadId) continue;
      if (!Array.isArray(payload.recommendationItems)) continue;

      const items = payload.recommendationItems
        .map((item) => {
          const rec = item as Partial<VideoRecommendation>;
          if (!rec?.id || !rec?.title || !rec?.url || !rec?.source) return null;
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
            tags: Array.isArray(rec.tags) ? rec.tags.map((t) => String(t)) : [],
            difficulty:
              rec.difficulty === "beginner" || rec.difficulty === "intermediate" || rec.difficulty === "advanced"
                ? rec.difficulty
                : "intermediate" as VideoDifficulty,
            reason: rec.reason ? String(rec.reason) : "",
            score: Number(rec.score || rec.matchScore || 0),
          } as VideoRecommendation;
        })
        .filter((item): item is VideoRecommendation => item !== null);

      if (items.length > 0) return items;
    }
    return [];
  },

  // ── Thread Learning State ──────────────────────────────

  async getThreadLearningState(threadId: string): Promise<ThreadLearningState | null> {
    const supabase = await sc();
    const { data, error } = await supabase
      .from("thread_learning_state")
      .select("*")
      .eq("thread_id", threadId)
      .maybeSingle();
    assertNoError(error, "Failed to load thread learning state");
    return fromDatabaseRow<ThreadLearningState>(data);
  },

  async upsertThreadLearningState(payload: Omit<ThreadLearningState, "updatedAt">): Promise<ThreadLearningState> {
    const supabase = await sc();
    const existing = await supabaseDb.getThreadLearningState(payload.threadId);
    const next: ThreadLearningState = {
      threadId: payload.threadId,
      goalTopic: payload.goalTopic,
      goalConfidence: payload.goalConfidence,
      learningRequestType: payload.learningRequestType,
      lastRecommendationAt: payload.lastRecommendationAt,
      updatedAt: nowIso(),
    };

    if (existing) {
      const { error } = await supabase
        .from("thread_learning_state")
        .update(toDatabaseRow(next))
        .eq("thread_id", payload.threadId);
      assertNoError(error, "Failed to update thread learning state");
    } else {
      const { error } = await supabase.from("thread_learning_state").insert(toDatabaseRow(next));
      assertNoError(error, "Failed to create thread learning state");
    }
    return next;
  },

  // ── Tricks (RAG knowledge base) ─────────────────────────

  async createTrick(payload: {
    title: string;
    effectDescription: string;
    methodSummary: string;
    difficulty: "beginner" | "intermediate" | "advanced";
    propsNeeded: string[];
    tags: string[];
    source: string;
  }) {
    const supabase = await sc();
    const { data: trick, error } = await supabase
      .from("tricks")
      .insert({
        title: payload.title,
        effect_description: payload.effectDescription,
        method_summary: payload.methodSummary,
        difficulty: payload.difficulty,
        props_needed: payload.propsNeeded,
        tags: payload.tags,
        source: payload.source,
      })
      .select()
      .single();

    if (error || !trick) {
      throw new Error(`Failed to create trick: ${error?.message ?? "unknown error"}`);
    }

    // Chunk + embed: simple single-chunk-per-trick to start (matches the
    // original Python pipeline's approach for short, curated entries).
    const chunkText = `${payload.effectDescription}\n\n${payload.methodSummary}`;
    const embedding = await embedTrickText(chunkText, "document");

    const { error: chunkError } = await supabase.from("trick_chunks").insert({
      trick_id: trick.id,
      content: chunkText,
      embedding,
    });
    assertNoError(chunkError, "Failed to create trick embedding");

    return fromDatabaseRow<Record<string, unknown>>(trick) ?? trick;
  },

  async listTricks() {
    const supabase = await sc();
    const { data, error } = await supabase
      .from("tricks")
      .select("*")
      .order("created_at", { ascending: false });
    assertNoError(error, "Failed to list tricks");
    return fromDatabaseRows<Record<string, unknown>>(data);
  },

  async searchTrickChunks(queryText: string, matchCount = 5) {
    console.time("searchTrickChunks:total");
    if (process.env.VOYAGE_API_KEY) {
      try {
        const supabase = await sc();
        console.time("embedTrickText");
        const embedding = await embedTrickText(queryText, "query");
        console.timeEnd("embedTrickText");

        console.time("searchTrickChunks:vectorRPC");
        const { data, error } = await supabase.rpc("hybrid_search_trick_chunks", {
          query_text: queryText,
          query_embedding: embedding,
          match_count: matchCount,
        });
        console.timeEnd("searchTrickChunks:vectorRPC");

        if (error) {
          throw new Error(`Failed to search trick chunks: ${error.message}`);
        }
        const semanticRows = fromDatabaseRows<Record<string, unknown>>(data).map((row) => ({
          ...row,
          searchMode: "semantic",
        }));
        if (semanticRows.length > 0) {
          console.timeEnd("searchTrickChunks:total");
          return semanticRows;
        }
      } catch (error) {
        console.warn("Semantic knowledge retrieval failed; trying keyword fallback", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    console.time("searchTrickChunks:keywordFallback");
    const keywordRows = await searchTricksByKeyword(queryText, matchCount);
    console.timeEnd("searchTrickChunks:keywordFallback");
    console.timeEnd("searchTrickChunks:total");
    return keywordRows;
  },
};
