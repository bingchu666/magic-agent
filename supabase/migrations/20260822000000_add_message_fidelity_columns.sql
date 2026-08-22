-- Full fidelity for quoted passages + grounding badges (Phase D).
--
-- Today `quotedText` (the passage a follow-up question referenced) gets
-- merged into the plain message text before it's sent, and
-- `groundingChecked`/`knowledgeSources` (the "cited the knowledge base"
-- badge) only ever live in client React state — neither is persisted. A
-- card reloaded on a second device shows correct message text but loses
-- the quoted-passage blockquote styling and the grounding badge for old
-- messages. These columns close that gap. All nullable — existing rows
-- stay valid with quotedText/groundingChecked/knowledgeSources unset,
-- which the client already renders as "no quoted passage" / "no grounding
-- badge" (its pre-Phase-D default for any message it didn't just stream).
ALTER TABLE messages ADD COLUMN IF NOT EXISTS quoted_text TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS grounding_checked BOOLEAN;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS knowledge_sources JSONB;
