import { recommendationConfig } from "@/lib/recommendation/config";
import { VideoProvider } from "@/lib/recommendation/types";
import { createBilibiliProvider } from "@/lib/recommendation/providers/bilibili-provider";
import { createCustomHttpProvider } from "@/lib/recommendation/providers/custom-provider";
import { createDailymotionProvider } from "@/lib/recommendation/providers/dailymotion-provider";
import { createLibraryProvider } from "@/lib/recommendation/providers/library-provider";
import { createVimeoProvider } from "@/lib/recommendation/providers/vimeo-provider";
import { createYoutubeProvider } from "@/lib/recommendation/providers/youtube-provider";

export function getActiveProviders() {
  const providers: VideoProvider[] = [
    createYoutubeProvider(),
    createBilibiliProvider(),
    createVimeoProvider(),
    createDailymotionProvider(),
    createCustomHttpProvider("douyin"),
    createCustomHttpProvider("kuaishou"),
    createLibraryProvider(),
  ];

  return providers
    .filter((provider) => provider.enabled && recommendationConfig.enabledProviders.has(provider.id))
    .sort((a, b) => b.weight - a.weight);
}
