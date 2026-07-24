import { recommendationConfig } from "@/lib/recommendation/config";
import { supabaseDb } from "@/lib/data/supabase-db";
import { VideoProvider } from "@/lib/recommendation/types";
import { buildQueryFromContext, inferDifficulty, normalizeText, pickTags } from "@/lib/recommendation/providers/common";
import { cosineSimilarity, embedText } from "@/lib/ai/embedding";

export function createLibraryProvider(): VideoProvider {
  return {
    id: "library",
    enabled: true,
    timeoutMs: recommendationConfig.defaultProviderTimeoutMs,
    weight: recommendationConfig.weights.library,
    async search(context) {
      const query = buildQueryFromContext(context);
      const queryVector = embedText(query);
      const preferredDifficulty = inferDifficulty(query);
      const videos = await supabaseDb.listPublishedVideos(context.locale);

      const scored = await Promise.all(
        videos.map(async (video) => {
          const embedding = await supabaseDb.getVideoEmbedding(video.id);
          const semantic = embedding ? cosineSimilarity(queryVector, embedding.vector) : 0;
          const difficultyBoost = video.difficulty === preferredDifficulty ? 0.1 : 0;
          return {
            id: `library:${video.id}`,
            source: "library",
            title: normalizeText(video.title),
            description: normalizeText(video.description),
            url: video.url,
            tags: pickTags(video.title, video.description, video.tags),
            difficulty: video.difficulty,
            language: video.language,
            rawScore: semantic + difficultyBoost,
            publishedAt: video.publishedAt,
          };
        })
      );

      return scored
        .sort((a, b) => (b.rawScore ?? 0) - (a.rawScore ?? 0))
        .slice(0, recommendationConfig.maxCandidatesPerProvider);
    },
  };
}
