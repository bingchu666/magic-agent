-- Adds folders (named containers for organizing root-level conversations)
-- and knowledge_cards (the parent/child/related/branch tree + per-card UI
-- metadata that previously lived only in browser localStorage under
-- STORAGE_KEY "magic_atlas_glass_stage_v2"). Message content itself is
-- already persisted via the existing threads/messages tables — this only
-- adds the tree/metadata layer on top, plus folder assignment for root
-- cards.

CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  sort_order DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE knowledge_cards (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  thread_id TEXT REFERENCES threads(id) ON DELETE RESTRICT,
  parent_id TEXT REFERENCES knowledge_cards(id) ON DELETE RESTRICT,
  folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
  relation TEXT NOT NULL CHECK (relation IN ('root', 'child', 'related', 'branch')),
  title TEXT NOT NULL,
  question TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'error')),
  unread BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Only root cards belong to a folder — child/related/branch cards inherit
  -- their root's folder visually and never carry their own value.
  CHECK (relation = 'root' OR folder_id IS NULL),
  -- Root cards have no parent; every other relation must have one.
  CHECK ((relation = 'root') = (parent_id IS NULL))
);

CREATE UNIQUE INDEX idx_knowledge_cards_thread ON knowledge_cards(thread_id) WHERE thread_id IS NOT NULL;
CREATE INDEX idx_knowledge_cards_user_created ON knowledge_cards(user_id, created_at DESC);
CREATE INDEX idx_knowledge_cards_folder ON knowledge_cards(folder_id);
CREATE INDEX idx_folders_user_sort ON folders(user_id, sort_order);

ALTER TABLE folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own folders" ON folders FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins read all folders" ON folders FOR SELECT USING (public.is_admin());

CREATE POLICY "Users manage own knowledge cards" ON knowledge_cards FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins read all knowledge cards" ON knowledge_cards FOR SELECT USING (public.is_admin());
