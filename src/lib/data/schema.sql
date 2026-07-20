-- ============================================================
-- Magic Agent — Supabase Production Schema
-- ============================================================

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
  embedding VECTOR(64) NOT NULL,
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

CREATE TABLE thread_learning_state (
  thread_id TEXT PRIMARY KEY REFERENCES threads(id) ON DELETE RESTRICT,
  goal_topic TEXT,
  goal_confidence REAL NOT NULL DEFAULT 0,
  learning_request_type TEXT NOT NULL DEFAULT 'general' CHECK (learning_request_type IN ('practice', 'explanation', 'routine', 'patter', 'general')),
  last_recommendation_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Indexes
CREATE INDEX idx_threads_user_updated ON threads(user_id, updated_at DESC);
CREATE INDEX idx_messages_thread_created ON messages(thread_id, created_at ASC);
CREATE INDEX idx_file_assets_user_updated ON file_assets(user_id, updated_at DESC);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at DESC);
CREATE INDEX idx_events_created ON events(created_at DESC);

-- 4. Auto-create profile row when a new user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, name, role, locale)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'user'),
    COALESCE(NEW.raw_user_meta_data->>'locale', 'zh')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

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
ALTER TABLE thread_learning_state ENABLE ROW LEVEL SECURITY;

-- 6. RLS Policies

-- Profiles
CREATE POLICY "Users read own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users update own profile" ON profiles FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "Admins read all profiles" ON profiles FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- Threads
CREATE POLICY "Users manage own threads" ON threads FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins read all threads" ON threads FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- Messages
CREATE POLICY "Users manage own messages" ON messages FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins read all messages" ON messages FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- File assets
CREATE POLICY "Users manage own files" ON file_assets FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins read all files" ON file_assets FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- File jobs
CREATE POLICY "Users manage own file jobs" ON file_jobs FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins read all file jobs" ON file_jobs FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- File insights
CREATE POLICY "Users manage own insights" ON file_insights FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins read all insights" ON file_insights FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- Video assets: published videos visible to all logged-in users; management admin-only
CREATE POLICY "Anyone can view published videos" ON video_assets FOR SELECT USING (status = 'published');
CREATE POLICY "Admins manage all videos" ON video_assets FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- Video tags
CREATE POLICY "Anyone can read video tags" ON video_tags FOR SELECT USING (true);
CREATE POLICY "Admins manage video tags" ON video_tags FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- Video embeddings
CREATE POLICY "Anyone can read video embeddings" ON video_embeddings FOR SELECT USING (true);
CREATE POLICY "Admins manage video embeddings" ON video_embeddings FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- Events
CREATE POLICY "Users read own events" ON events FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own events" ON events FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins read all events" ON events FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- Audit logs
CREATE POLICY "Users read own audit logs" ON audit_logs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins read all audit logs" ON audit_logs FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- Thread learning state
CREATE POLICY "Users manage own learning state" ON thread_learning_state FOR ALL USING (
  EXISTS (SELECT 1 FROM threads WHERE id = thread_learning_state.thread_id AND user_id = auth.uid())
) WITH CHECK (
  EXISTS (SELECT 1 FROM threads WHERE id = thread_learning_state.thread_id AND user_id = auth.uid())
);
CREATE POLICY "Admins read all learning state" ON thread_learning_state FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);
