import { ChatIntent } from "@/lib/domain/types";

const translationPattern = /(翻译|translate|中文|english|rewrite|改写)/i;
const analysisPattern = /(分析|总结|summary|review|读取|read this file|explain this)/i;

export function detectIntent(message: string): ChatIntent {
  if (translationPattern.test(message)) return "translation";
  if (analysisPattern.test(message)) return "analysis";
  return "chat";
}
