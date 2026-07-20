import { pgTable, text, timestamp, integer, jsonb, vector, real, uuid } from "drizzle-orm/pg-core";

// ============================================================
// EXISTING TABLES — matching the current memory-db.ts structure
// ============================================================

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  role: text("role").notNull(), // "user" | "admin"
  locale: text("locale").notNull(), // "en" | "zh"
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const threads = pgTable("threads", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const messages = pgTable("messages", {
  id: text("id").primaryKey(),
  threadId: text("thread_id").notNull(),
  userId: text("user_id").notNull(),
  role: text("role").notNull(), // "user" | "assistant" | "system"
  content: text("content").notNull(),
  locale: text("locale").notNull(), // "en" | "zh"
  attachmentIds: jsonb("attachment_ids").$type<string[]>(),
  lessonPayload: jsonb("lesson_payload").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const videoAssets = pgTable("video_assets", {
  id: text("id").primaryKey(),
  createdBy: text("created_by").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  url: text("url").notNull(),
  language: text("language").notNull(), // "en" | "zh"
  difficulty: text("difficulty").notNull(), // "beginner" | "intermediate" | "advanced"
  status: text("status").notNull(), // "draft" | "published"
  tags: jsonb("tags").$type<string[]>().default([]),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true, mode: "string" }),
});

export const videoTags = pgTable("video_tags", {
  id: text("id").primaryKey(),
  videoId: text("video_id").notNull(),
  tag: text("tag").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

// Note: kept as jsonb (not pgvector) since these currently use the simple
// "local-hash-64" placeholder embedding, not a real semantic model. Left
// as-is to avoid touching working video-recommendation logic. The new
// trickChunks table below uses real pgvector + real embeddings instead.
export const videoEmbeddings = pgTable("video_embeddings", {
  id: text("id").primaryKey(),
  videoId: text("video_id").notNull(),
  model: text("model").notNull(),
  vector: jsonb("vector").$type<number[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const fileAssets = pgTable("file_assets", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  storageKey: text("storage_key").notNull(),
  status: text("status").notNull(),
  previewText: text("preview_text"),
  summaryZh: text("summary_zh"),
  summaryEn: text("summary_en"),
  translatedZh: text("translated_zh"),
  translatedEn: text("translated_en"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
});

export const fileJobs = pgTable("file_jobs", {
  id: text("id").primaryKey(),
  fileId: text("file_id").notNull(),
  userId: text("user_id").notNull(),
  status: text("status").notNull(), // "queued" | "processing" | "done" | "failed"
  startedAt: timestamp("started_at", { withTimezone: true, mode: "string" }),
  finishedAt: timestamp("finished_at", { withTimezone: true, mode: "string" }),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const fileInsights = pgTable("file_insights", {
  id: text("id").primaryKey(),
  fileId: text("file_id").notNull(),
  userId: text("user_id").notNull(),
  kind: text("kind").notNull(), // "summary" | "translation" | "key_points"
  locale: text("locale").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const auditLogs = pgTable("audit_logs", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  action: text("action").notNull(),
  details: text("details").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const events = pgTable("events", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const threadLearningState = pgTable("thread_learning_state", {
  threadId: text("thread_id").primaryKey(),
  goalTopic: text("goal_topic"),
  goalConfidence: real("goal_confidence"),
  learningRequestType: text("learning_request_type"),
  lastRecommendationAt: timestamp("last_recommendation_at", { withTimezone: true, mode: "string" }),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

// ============================================================
// NEW: text-based trick knowledge base (RAG), same design as the
// original Python/Supabase pipeline — just added into this project's DB.
// ============================================================

export const tricks = pgTable("tricks", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  effectDescription: text("effect_description"),
  methodSummary: text("method_summary"),
  difficulty: text("difficulty"), // "beginner" | "intermediate" | "advanced"
  propsNeeded: jsonb("props_needed").$type<string[]>().default([]),
  tags: jsonb("tags").$type<string[]>().default([]),
  source: text("source"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const trickChunks = pgTable("trick_chunks", {
  id: uuid("id").primaryKey().defaultRandom(),
  trickId: uuid("trick_id").notNull(),
  content: text("content").notNull(),
  embedding: vector("embedding", { dimensions: 1024 }), // matches Voyage AI voyage-3
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});