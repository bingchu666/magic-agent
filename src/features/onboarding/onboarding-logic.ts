import { OnboardingAnswers, OnboardingQuestion } from "@/features/onboarding/onboarding-questions";

export type OnboardingRecordSummary = {
  completedAt: string | null;
  skipCount: number;
};

const MAX_AUTO_OPEN_SKIPS = 3;

/** Whether the post-login onboarding modal should auto-open for this user. */
export function shouldAutoOpenOnboarding(record: OnboardingRecordSummary | null): boolean {
  if (!record) return true;
  if (record.completedAt) return false;
  if (record.skipCount >= MAX_AUTO_OPEN_SKIPS) return false;
  return true;
}

/** Index of the first question with no saved answer, so a reopened modal resumes there. */
export function firstUnansweredIndex(questions: OnboardingQuestion[], answers: OnboardingAnswers): number {
  const index = questions.findIndex((question) => !(question.id in answers));
  return index === -1 ? Math.max(questions.length - 1, 0) : index;
}
