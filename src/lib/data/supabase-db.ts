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
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { createServerClient } from "@supabase/ssr";
import { AsyncLocalStorage } from "node:async_hooks";

// ── Helpers ──────────────────────────────────────────────

/** Auto-convert camelCase keys to snake_case for DB insert/update */
function toSnake<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    // Leave values that are already objects (arrays, nested objects) as-is
    result[key.replace(/([A-Z])/g, "_$1").toLowerCase()] = value;
  }
  return result;
}

const cookieStorage = new AsyncLocalStorage<string>();

/** Wrap an async operation with a captured cookie header for SSE streams */
export function withRequestCookie<T>(cookieHeader: string, fn: () => Promise<T>): Promise<T> {
  return cookieStorage.run(cookieHeader, fn);
}

function sc() {
  const capturedCookie = cookieStorage.getStore();
  if (capturedCookie) {
    const cookieMap = new Map<string, string>();
    capturedCookie.split(";").forEach((part) => {
      const idx = part.indexOf("=");
      if (idx > 0) cookieMap.set(part.slice(0, idx).trim(), part.slice(idx + 1));
    });
    return createServerClient(
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
  return getSupabaseServerClient();
}

function typed<T>(data: unknown): T {
  return (data ?? []) as T;
}

// ── Users / Profiles ─────────────────────────────────────

export const supabaseDb = {
  async ensureUser(params: { id: string; name: string; role: UserRole; locale: Locale }): Promise<AppUser> {
    const supabase = sc();
    const { data, error } = await supabase
      .from("profiles")
      .upsert({ id: params.id, name: params.name, role: params.role, locale: params.locale })
      .select()
      .single();

    if (error || !data) {
      // Fallback: return what was requested
      return { id: params.id, name: params.name, role: params.role, locale: params.locale, createdAt: nowIso() };
    }
    return data as AppUser;
  },

  // ── Threads ────────────────────────────────────────────

  async listThreads(userId: string): Promise<Thread[]> {
    const supabase = sc();
    const { data } = await supabase
      .from("threads")
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });
    return typed<Thread[]>(data);
  },

  async getThread(threadId: string): Promise<Thread | null> {
    const supabase = sc();
    const { data } = await supabase.from("threads").select("*").eq("id", threadId).single();
    return (data as Thread) ?? null;
  },

  async createThread(userId: string, title: string): Promise<Thread> {
    const supabase = sc();
    const now = nowIso();
    const thread: Thread = {
      id: createId("thread"),
      userId,
      title,
      createdAt: now,
      updatedAt: now,
    };
    await supabase.from("threads").insert(toSnake(thread));
    return thread;
  },

  async touchThread(threadId: string): Promise<void> {
    const supabase = sc();
    await supabase.from("threads").update({ updated_at: nowIso() }).eq("id", threadId);
  },

  async deleteThread(threadId: string, userId?: string): Promise<Thread | null> {
    const supabase = sc();
    const thread = await supabaseDb.getThread(threadId);
    if (!thread) return null;
    if (userId && thread.userId !== userId) return null;

    await supabase.from("messages").delete().eq("thread_id", threadId);
    await supabase.from("thread_learning_state").delete().eq("thread_id", threadId);
    await supabase.from("threads").delete().eq("id", threadId);

    return thread;
  },

  // ── Messages ───────────────────────────────────────────

  async listMessages(threadId: string): Promise<Message[]> {
    const supabase = sc();
    const { data } = await supabase
      .from("messages")
      .select("*")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true });
    return typed<Message[]>(data);
  },

  async createMessage(payload: Omit<Message, "id" | "createdAt">): Promise<Message> {
    const supabase = sc();
    const message: Message = {
      id: createId("msg"),
      createdAt: nowIso(),
      ...payload,
    };
    await supabase.from("messages").insert(toSnake(message));
    await supabaseDb.touchThread(payload.threadId);
    return message;
  },

  // ── Videos ─────────────────────────────────────────────

  async listPublishedVideos(locale?: Locale): Promise<VideoAsset[]> {
    const supabase = sc();
    let query = supabase.from("video_assets").select("*").eq("status", "published");
    const { data } = await query;
    const videos = typed<VideoAsset[]>(data);
    if (!locale) return videos;
    return videos.filter((v) => v.language === locale || v.language === "en");
  },

  async listVideosForAdmin(): Promise<VideoAsset[]> {
    const supabase = sc();
    const { data } = await supabase
      .from("video_assets")
      .select("*")
      .order("updated_at", { ascending: false });
    return typed<VideoAsset[]>(data);
  },

  async getVideo(videoId: string): Promise<VideoAsset | null> {
    const supabase = sc();
    const { data } = await supabase.from("video_assets").select("*").eq("id", videoId).single();
    return (data as VideoAsset) ?? null;
  },

  async getVideoEmbedding(videoId: string): Promise<VideoEmbedding | null> {
    const supabase = sc();
    const { data } = await supabase.from("video_embeddings").select("*").eq("video_id", videoId).single();
    return (data as VideoEmbedding) ?? null;
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
    const supabase = sc();
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

    await supabase.from("video_assets").insert(toSnake(video));

    if (payload.tags.length > 0) {
      const tags: VideoTag[] = payload.tags.map((tag) => ({
        id: createId("vtag"),
        videoId: video.id,
        tag,
        createdAt: now,
      }));
      await supabase.from("video_tags").insert(tags.map((t: VideoTag) => toSnake(t as unknown as Record<string, unknown>)));
    }

    await supabase.from("video_embeddings").insert({
      id: createId("emb"),
      video_id: video.id,
      model: "local-hash-64",
      embedding: embedText(`${video.title} ${video.description} ${payload.tags.join(" ")}`),
      created_at: now,
    });

    return video;
  },

  async updateVideo(videoId: string, patch: Partial<Omit<VideoAsset, "id" | "createdBy" | "createdAt">>): Promise<VideoAsset | null> {
    const supabase = sc();
    const video = await supabaseDb.getVideo(videoId);
    if (!video) return null;

    const updates: Record<string, unknown> = { updated_at: nowIso() };
    if (typeof patch.title === "string") updates.title = patch.title;
    if (typeof patch.description === "string") updates.description = patch.description;
    if (typeof patch.url === "string") updates.url = patch.url;
    if (patch.language === "zh" || patch.language === "en") updates.language = patch.language;
    if (patch.difficulty) updates.difficulty = patch.difficulty;
    if (patch.tags) updates.tags = patch.tags;
    if (patch.status) updates.status = patch.status;

    await supabase.from("video_assets").update(toSnake(updates)).eq("id", videoId);

    // Update embedding
    const emb = await supabaseDb.getVideoEmbedding(videoId);
    if (emb) {
      const t = typeof updates.title === "string" ? updates.title : video.title;
      const d = typeof updates.description === "string" ? updates.description : video.description;
      const tags = Array.isArray(updates.tags) ? updates.tags : video.tags;
      await supabase.from("video_embeddings").update({
        embedding: embedText(`${t} ${d} ${tags.join(" ")}`),
      }).eq("id", emb.id);
    }

    // Sync tags if changed
    if (Array.isArray(patch.tags)) {
      await supabase.from("video_tags").delete().eq("video_id", videoId);
      const tags: VideoTag[] = patch.tags.map((tag) => ({
        id: createId("vtag"),
        videoId,
        tag,
        createdAt: nowIso(),
      }));
      if (tags.length > 0) {
        await supabase.from("video_tags").insert(tags.map((t: VideoTag) => toSnake(t as unknown as Record<string, unknown>)));
      }
    }

    return await supabaseDb.getVideo(videoId);
  },

  async publishVideo(videoId: string): Promise<VideoAsset | null> {
    const supabase = sc();
    const now = nowIso();
    await supabase.from("video_assets").update({
      status: "published",
      published_at: now,
      updated_at: now,
    }).eq("id", videoId);

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
    const supabase = sc();
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
    await supabase.from("file_assets").insert(toSnake(file));
    return file;
  },

  async listFiles(userId: string): Promise<FileAsset[]> {
    const supabase = sc();
    const now = Date.now();
    const { data } = await supabase
      .from("file_assets")
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });

    const files = typed<FileAsset[]>(data);
    // Mark expired files
    for (const file of files) {
      if (new Date(file.expiresAt).getTime() < now && file.status !== "expired") {
        file.status = "expired";
        await supabase.from("file_assets").update({ status: "expired", updated_at: nowIso() }).eq("id", file.id);
      }
    }
    return files;
  },

  async getFile(fileId: string): Promise<FileAsset | null> {
    const supabase = sc();
    const { data } = await supabase.from("file_assets").select("*").eq("id", fileId).single();
    const file = (data as FileAsset) ?? null;
    if (file && new Date(file.expiresAt).getTime() < Date.now() && file.status !== "expired") {
      file.status = "expired";
      await supabase.from("file_assets").update({ status: "expired", updated_at: nowIso() }).eq("id", file.id);
    }
    return file;
  },

  async saveUpload(fileId: string, buffer: ArrayBuffer): Promise<void> {
    const supabase = sc();
    await supabase.storage.from("file-uploads").upload(`uploads/${fileId}`, buffer, { upsert: true });
  },

  async getUpload(fileId: string): Promise<ArrayBuffer | null> {
    const supabase = sc();
    const { data, error } = await supabase.storage.from("file-uploads").download(`uploads/${fileId}`);
    if (error || !data) return null;
    return data.arrayBuffer();
  },

  async createFileJob(fileId: string, userId: string): Promise<FileJob> {
    const supabase = sc();
    const now = nowIso();
    const job: FileJob = {
      id: createId("job"),
      fileId,
      userId,
      status: "queued",
      createdAt: now,
      updatedAt: now,
    };
    await supabase.from("file_jobs").insert(toSnake(job));
    return job;
  },

  async updateFileJob(jobId: string, status: FileJobStatus, patch?: Partial<FileJob>): Promise<FileJob | null> {
    const supabase = sc();
    await supabase.from("file_jobs").update({ ...patch, status, updated_at: nowIso() }).eq("id", jobId);
    const { data } = await supabase.from("file_jobs").select("*").eq("id", jobId).single();
    return (data as FileJob) ?? null;
  },

  async getFileJob(jobId: string): Promise<FileJob | null> {
    const supabase = sc();
    const { data } = await supabase.from("file_jobs").select("*").eq("id", jobId).single();
    return (data as FileJob) ?? null;
  },

  async listAllFileJobs(): Promise<FileJob[]> {
    const supabase = sc();
    const { data } = await supabase.from("file_jobs").select("*").order("created_at", { ascending: false });
    return typed<FileJob[]>(data);
  },

  async listFileJobs(fileId: string): Promise<FileJob[]> {
    const supabase = sc();
    const { data } = await supabase
      .from("file_jobs")
      .select("*")
      .eq("file_id", fileId)
      .order("created_at", { ascending: false });
    return typed<FileJob[]>(data);
  },

  async updateFile(fileId: string, patch: Partial<FileAsset>): Promise<FileAsset | null> {
    const supabase = sc();
    await supabase.from("file_assets").update({ ...patch, updated_at: nowIso() }).eq("id", fileId);
    return supabaseDb.getFile(fileId);
  },

  async deleteFile(fileId: string, userId?: string): Promise<FileAsset | null> {
    const supabase = sc();
    const file = await supabaseDb.getFile(fileId);
    if (!file) return null;
    if (userId && file.userId !== userId) return null;

    await supabase.from("file_jobs").delete().eq("file_id", fileId);
    await supabase.from("file_insights").delete().eq("file_id", fileId);
    await supabase.from("file_assets").delete().eq("id", fileId);

    // Clean up storage
    await supabase.storage.from("file-uploads").remove([`uploads/${fileId}`]);

    return file;
  },

  // ── File Insights ──────────────────────────────────────

  async createFileInsight(payload: Omit<FileInsight, "id" | "createdAt">): Promise<FileInsight> {
    const supabase = sc();
    const insight: FileInsight = {
      id: createId("insight"),
      createdAt: nowIso(),
      ...payload,
    };
    await supabase.from("file_insights").insert(toSnake(insight));
    return insight;
  },

  async listFileInsightsByIds(userId: string, ids: string[]): Promise<FileInsight[]> {
    if (ids.length === 0) return [];
    const supabase = sc();
    const { data } = await supabase
      .from("file_insights")
      .select("*")
      .eq("user_id", userId)
      .in("file_id", ids);
    return typed<FileInsight[]>(data);
  },

  async listRecentFileInsights(userId: string, locale: Locale, limit = 3): Promise<FileInsight[]> {
    const supabase = sc();
    const { data } = await supabase
      .from("file_insights")
      .select("*")
      .eq("user_id", userId)
      .eq("locale", locale)
      .order("created_at", { ascending: false })
      .limit(limit);
    return typed<FileInsight[]>(data);
  },

  // ── Audit Logs ─────────────────────────────────────────

  async createAuditLog(payload: Omit<AuditLog, "id" | "createdAt">): Promise<AuditLog> {
    const supabase = sc();
    const log: AuditLog = {
      id: createId("audit"),
      createdAt: nowIso(),
      ...payload,
    };
    await supabase.from("audit_logs").insert(toSnake(log));
    return log;
  },

  async listAuditLogs(limit = 120): Promise<AuditLog[]> {
    const supabase = sc();
    const { data } = await supabase
      .from("audit_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    return typed<AuditLog[]>(data);
  },

  // ── Events ─────────────────────────────────────────────

  async createEvent(payload: Omit<Event, "id" | "createdAt">): Promise<Event> {
    const supabase = sc();
    const event: Event = {
      id: createId("event"),
      createdAt: nowIso(),
      ...payload,
    };
    await supabase.from("events").insert(toSnake(event));
    return event;
  },

  async listEvents(limit = 200): Promise<Event[]> {
    const supabase = sc();
    const { data } = await supabase
      .from("events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    return typed<Event[]>(data);
  },

  // ── Recommendations (event-based) ──────────────────────

  async listRecentlyRecommendedVideoIdsByThread(threadId: string, userId: string, limit = 9): Promise<string[]> {
    const supabase = sc();
    const { data } = await supabase
      .from("events")
      .select("*")
      .eq("user_id", userId)
      .eq("name", "chat_completion")
      .order("created_at", { ascending: false });

    const events = typed<Event[]>(data);
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
    const supabase = sc();
    const { data } = await supabase
      .from("events")
      .select("*")
      .eq("user_id", userId)
      .eq("name", "chat_completion")
      .order("created_at", { ascending: false });

    const events = typed<Event[]>(data);
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
    const supabase = sc();
    const { data } = await supabase
      .from("thread_learning_state")
      .select("*")
      .eq("thread_id", threadId)
      .single();
    return (data as ThreadLearningState) ?? null;
  },

  async upsertThreadLearningState(payload: Omit<ThreadLearningState, "updatedAt">): Promise<ThreadLearningState> {
    const supabase = sc();
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
      await supabase.from("thread_learning_state").update(toSnake(next)).eq("thread_id", payload.threadId);
    } else {
      await supabase.from("thread_learning_state").insert(toSnake(next));
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
    const supabase = sc();
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

    await supabase.from("trick_chunks").insert({
      trick_id: trick.id,
      content: chunkText,
      embedding,
    });

    return trick;
  },

  async listTricks() {
    const supabase = sc();
    const { data } = await supabase
      .from("tricks")
      .select("*")
      .order("created_at", { ascending: false });
    return typed<Record<string, unknown>[]>(data);
  },

  async searchTrickChunks(queryText: string, matchCount = 5) {
    const supabase = sc();
    const embedding = await embedTrickText(queryText, "query");
    const { data, error } = await supabase.rpc("hybrid_search_trick_chunks", {
      query_text: queryText,
      query_embedding: embedding,
      match_count: matchCount,
    });

    if (error) {
      throw new Error(`Failed to search trick chunks: ${error.message}`);
    }
    return typed<Record<string, unknown>[]>(data);
  },
};
