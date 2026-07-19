import { Locale, VideoDifficulty, VideoRecommendation } from "@/lib/domain/types";

export type RecommendationContext = {
  locale: Locale;
  userId: string;
  threadId: string;
  userMessage: string;
  conversationText: string;
  limit: number;
  now: string;
};

export type VideoCandidate = {
  id: string;
  source: string;
  title: string;
  description: string;
  url: string;
  tags: string[];
  difficulty: VideoDifficulty;
  language: Locale | "multi";
  thumbnail?: string;
  duration?: string;
  publishedAt?: string;
  rawScore?: number;
};

export type VerifiedCandidate = VideoCandidate & {
  verified: true;
  normalizedUrl: string;
  playableCheckedAt: string;
};

export type ProviderResult = {
  provider: string;
  items: VideoCandidate[];
  error?: string;
  elapsedMs: number;
};

export type VideoProvider = {
  id: string;
  enabled: boolean;
  timeoutMs: number;
  weight: number;
  search: (context: RecommendationContext) => Promise<VideoCandidate[]>;
};

export type FusionOutput = VideoRecommendation[];
