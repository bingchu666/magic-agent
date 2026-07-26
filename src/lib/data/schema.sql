-- ============================================================
-- Magic Agent — Supabase Production Schema
-- ============================================================

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
SET search_path = public, extensions;

-- 1. Profiles table (replaces old "users" table)
--    Shares PK with auth.users via trigger on signup.
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  locale TEXT NOT NULL DEFAULT 'zh' CHECK (locale IN ('zh', 'en')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Business tables — all reference profiles.id
CREATE TABLE threads (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  title_pending BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant')),
  content TEXT NOT NULL,
  locale TEXT NOT NULL CHECK (locale IN ('zh', 'en')),
  attachment_ids TEXT[],
  lesson_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE video_assets (
  id TEXT PRIMARY KEY,
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  url TEXT NOT NULL,
  language TEXT NOT NULL CHECK (language IN ('zh', 'en')),
  difficulty TEXT NOT NULL CHECK (difficulty IN ('beginner', 'intermediate', 'advanced')),
  status TEXT NOT NULL CHECK (status IN ('draft', 'published')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ
);

CREATE TABLE video_tags (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES video_assets(id) ON DELETE RESTRICT,
  tag TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE video_embeddings (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES video_assets(id) ON DELETE RESTRICT,
  model TEXT NOT NULL,
  embedding vector(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE file_assets (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size BIGINT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('uploaded', 'processing', 'ready', 'failed', 'expired')),
  storage_key TEXT NOT NULL,
  preview_text TEXT,
  summary_zh TEXT,
  summary_en TEXT,
  translated_zh TEXT,
  translated_en TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE file_jobs (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES file_assets(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'done', 'failed')),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE file_insights (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES file_assets(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('summary', 'translation', 'key_points')),
  locale TEXT NOT NULL CHECK (locale IN ('zh', 'en')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  details TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Post-signup onboarding questionnaire (answers, skip/close state).
CREATE TABLE public.user_onboarding (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  completed_at TIMESTAMPTZ,
  skip_count INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE thread_learning_state (
  thread_id TEXT PRIMARY KEY REFERENCES threads(id) ON DELETE RESTRICT,
  goal_topic TEXT,
  goal_confidence REAL NOT NULL DEFAULT 0,
  learning_request_type TEXT NOT NULL DEFAULT 'general' CHECK (learning_request_type IN ('practice', 'explanation', 'routine', 'patter', 'general')),
  last_recommendation_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tricks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL UNIQUE,
  effect_description TEXT NOT NULL DEFAULT '',
  method_summary TEXT NOT NULL DEFAULT '',
  difficulty TEXT NOT NULL DEFAULT 'beginner' CHECK (difficulty IN ('beginner', 'intermediate', 'advanced')),
  props_needed JSONB NOT NULL DEFAULT '[]'::jsonb,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  source TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE trick_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trick_id UUID NOT NULL REFERENCES tricks(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  embedding vector(1024) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Indexes
CREATE INDEX idx_threads_user_updated ON threads(user_id, updated_at DESC);
CREATE INDEX idx_messages_thread_created ON messages(thread_id, created_at ASC);
CREATE INDEX idx_file_assets_user_updated ON file_assets(user_id, updated_at DESC);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at DESC);
CREATE INDEX idx_events_created ON events(created_at DESC);
CREATE INDEX idx_trick_chunks_trick ON trick_chunks(trick_id);
CREATE INDEX idx_trick_chunks_embedding ON trick_chunks USING hnsw (embedding vector_cosine_ops);

-- 4. Auto-create profile row when a new user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, name, role, locale)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    'user',
    COALESCE(NEW.raw_user_meta_data->>'locale', 'zh')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Avoid recursive profile RLS checks and keep authorization in the database.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

CREATE OR REPLACE FUNCTION public.hybrid_search_trick_chunks(
  query_text TEXT,
  query_embedding vector(1024),
  match_count INTEGER DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  trick_id UUID,
  title TEXT,
  content TEXT,
  similarity DOUBLE PRECISION
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
  SELECT
    chunk.id,
    chunk.trick_id,
    trick.title,
    chunk.content,
    (
      0.85 * (1 - (chunk.embedding <=> query_embedding)) +
      0.15 * ts_rank_cd(
        to_tsvector('simple', trick.title || ' ' || chunk.content),
        plainto_tsquery('simple', query_text)
      )
    )::DOUBLE PRECISION AS similarity
  FROM public.trick_chunks AS chunk
  JOIN public.tricks AS trick ON trick.id = chunk.trick_id
  ORDER BY similarity DESC
  LIMIT LEAST(GREATEST(match_count, 1), 20);
$$;

REVOKE ALL ON FUNCTION public.hybrid_search_trick_chunks(TEXT, vector, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hybrid_search_trick_chunks(TEXT, vector, INTEGER) TO authenticated;

-- 5. Row-Level Security — enable on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_onboarding ENABLE ROW LEVEL SECURITY;
ALTER TABLE thread_learning_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE tricks ENABLE ROW LEVEL SECURITY;
ALTER TABLE trick_chunks ENABLE ROW LEVEL SECURITY;

-- 6. RLS Policies

-- Profiles
CREATE POLICY "Users read own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users update own profile" ON profiles FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "Admins read all profiles" ON profiles FOR SELECT USING (public.is_admin());

-- Authenticated users may update preferences, never their authorization role.
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (name, locale) ON public.profiles TO authenticated;

-- Threads
CREATE POLICY "Users manage own threads" ON threads FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins read all threads" ON threads FOR SELECT USING (public.is_admin());

-- Messages
CREATE POLICY "Users manage own messages" ON messages FOR ALL USING (
  auth.uid() = user_id AND EXISTS (
    SELECT 1 FROM threads WHERE threads.id = messages.thread_id AND threads.user_id = auth.uid()
  )
) WITH CHECK (
  auth.uid() = user_id AND EXISTS (
    SELECT 1 FROM threads WHERE threads.id = messages.thread_id AND threads.user_id = auth.uid()
  )
);
CREATE POLICY "Admins read all messages" ON messages FOR SELECT USING (public.is_admin());

-- File assets
CREATE POLICY "Users manage own files" ON file_assets FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins read all files" ON file_assets FOR SELECT USING (public.is_admin());

-- File jobs
CREATE POLICY "Users manage own file jobs" ON file_jobs FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins read all file jobs" ON file_jobs FOR SELECT USING (public.is_admin());

-- File insights
CREATE POLICY "Users manage own insights" ON file_insights FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins read all insights" ON file_insights FOR SELECT USING (public.is_admin());

-- Video assets: published videos visible to all logged-in users; management admin-only
CREATE POLICY "Anyone can view published videos" ON video_assets FOR SELECT USING (auth.uid() IS NOT NULL AND status = 'published');
CREATE POLICY "Admins manage all videos" ON video_assets FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Video tags
CREATE POLICY "Anyone can read video tags" ON video_tags FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Admins manage video tags" ON video_tags FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Video embeddings
CREATE POLICY "Anyone can read video embeddings" ON video_embeddings FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Admins manage video embeddings" ON video_embeddings FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Events
CREATE POLICY "Users read own events" ON events FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own events" ON events FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins read all events" ON events FOR SELECT USING (public.is_admin());

-- Audit logs
CREATE POLICY "Users read own audit logs" ON audit_logs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins read all audit logs" ON audit_logs FOR SELECT USING (public.is_admin());
CREATE POLICY "Admins insert audit logs" ON audit_logs FOR INSERT WITH CHECK (
  public.is_admin() AND auth.uid() = user_id
);

-- User onboarding
CREATE POLICY "Users manage own onboarding" ON public.user_onboarding FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins read all onboarding" ON public.user_onboarding FOR SELECT USING (public.is_admin());

-- Thread learning state
CREATE POLICY "Users manage own learning state" ON thread_learning_state FOR ALL USING (
  EXISTS (SELECT 1 FROM threads WHERE id = thread_learning_state.thread_id AND user_id = auth.uid())
) WITH CHECK (
  EXISTS (SELECT 1 FROM threads WHERE id = thread_learning_state.thread_id AND user_id = auth.uid())
);
CREATE POLICY "Admins read all learning state" ON thread_learning_state FOR SELECT USING (public.is_admin());

-- The application reads the curated knowledge base; writes use the service role.
CREATE POLICY "Authenticated users read tricks" ON tricks FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users read trick chunks" ON trick_chunks FOR SELECT USING (auth.uid() IS NOT NULL);

-- Private file bucket. Object paths are uploads/{userId}/{generatedName}.
INSERT INTO storage.buckets (id, name, public)
VALUES ('file-uploads', 'file-uploads', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Users read own uploaded files" ON storage.objects FOR SELECT USING (
  bucket_id = 'file-uploads' AND (storage.foldername(name))[2] = auth.uid()::TEXT
);
CREATE POLICY "Users create own uploaded files" ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'file-uploads' AND (storage.foldername(name))[2] = auth.uid()::TEXT
);
CREATE POLICY "Users update own uploaded files" ON storage.objects FOR UPDATE USING (
  bucket_id = 'file-uploads' AND (storage.foldername(name))[2] = auth.uid()::TEXT
) WITH CHECK (
  bucket_id = 'file-uploads' AND (storage.foldername(name))[2] = auth.uid()::TEXT
);
CREATE POLICY "Users delete own uploaded files" ON storage.objects FOR DELETE USING (
  bucket_id = 'file-uploads' AND (storage.foldername(name))[2] = auth.uid()::TEXT
);
