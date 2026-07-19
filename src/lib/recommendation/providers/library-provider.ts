import { recommendationConfig } from "@/lib/recommendation/config";
import { memoryDb } from "@/lib/data/memory-db";
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
      const videos = memoryDb.listPublishedVideos(context.locale);

      return videos
        .map((video) => {
          const embedding = memoryDb.getVideoEmbedding(video.id);
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
        .sort((a, b) => (b.rawScore ?? 0) - (a.rawScore ?? 0))
        .slice(0, recommendationConfig.maxCandidatesPerProvider);
    },
  };
}
