import { Locale, SafetyResult } from "@/lib/domain/types";

const exposurePattern = /(完整揭秘|具体秘密|全部机关|exact secret|full secret|expose|reveal everything)/i;
const harmfulPattern = /(作弊|诈骗|欺骗他人获利|steal|fraud|illegal)/i;

export function applySafetyPolicy(message: string, locale: Locale): SafetyResult {
  if (harmfulPattern.test(message)) {
    return {
      mode: "downgrade",
      reason: "harmful_request",
      userFacingNotice:
        locale === "zh"
          ? "这个请求可能涉及不当用途。我可以改为提供安全、合法的表演建议。"
          : "This request may be unsafe. I can switch to safe and legal performance guidance.",
    };
  }

  if (exposurePattern.test(message)) {
    return {
      mode: "downgrade",
      reason: "secret_exposure",
      userFacingNotice:
        locale === "zh"
          ? "我不能提供完整揭秘，但可以给你公开可练的流程、台词和练习路径。"
          : "I cannot provide full exposure, but I can provide safe practice flow, patter, and drills.",
    };
  }

  return { mode: "allow" };
}
