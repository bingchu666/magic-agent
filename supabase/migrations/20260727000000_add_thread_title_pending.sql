-- Adds the flag that marks a thread's title as still the immediate
-- truncated placeholder awaiting the background AI title-upgrade call.
ALTER TABLE threads ADD COLUMN IF NOT EXISTS title_pending BOOLEAN NOT NULL DEFAULT false;
