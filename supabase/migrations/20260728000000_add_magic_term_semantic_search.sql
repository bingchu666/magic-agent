-- Semantic fallback for magic term glossary lookups: given a query embedding,
-- return the closest magic_term_chunks rows by cosine similarity. Used when
-- an exact term-string match fails (e.g. a Chinese concept phrase vs. this
-- English-only dictionary).
CREATE OR REPLACE FUNCTION public.match_magic_term_chunks(
  query_embedding vector(1024),
  match_count INTEGER DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  term_id UUID,
  term TEXT,
  definition TEXT,
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
    chunk.term_id,
    term.term,
    term.definition,
    chunk.content,
    (1 - (chunk.embedding <=> query_embedding))::DOUBLE PRECISION AS similarity
  FROM public.magic_term_chunks AS chunk
  JOIN public.magic_terms AS term ON term.id = chunk.term_id
  ORDER BY similarity DESC
  LIMIT LEAST(GREATEST(match_count, 1), 20);
$$;

REVOKE ALL ON FUNCTION public.match_magic_term_chunks(vector, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_magic_term_chunks(vector, INTEGER) TO authenticated;
