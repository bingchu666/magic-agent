import { describe, expect, it } from "vitest";
import { firstUnansweredIndex, shouldAutoOpenOnboarding } from "@/features/onboarding/onboarding-logic";
import { OnboardingQuestion } from "@/features/onboarding/onboarding-questions";

const questions: OnboardingQuestion[] = [
  { id: "q1", type: "single", prompt: { zh: "", en: "" }, options: [] },
  { id: "q2", type: "single", prompt: { zh: "", en: "" }, options: [] },
  { id: "q3", type: "multi", prompt: { zh: "", en: "" }, options: [] },
];

describe("shouldAutoOpenOnboarding", () => {
  it("opens for a user with no onboarding record yet", () => {
    expect(shouldAutoOpenOnboarding(null)).toBe(true);
  });

  it("does not open once completed", () => {
    expect(shouldAutoOpenOnboarding({ completedAt: "2026-01-01T00:00:00Z", skipCount: 0 })).toBe(false);
  });

  it("stays open while under the skip cap", () => {
    expect(shouldAutoOpenOnboarding({ completedAt: null, skipCount: 2 })).toBe(true);
  });

  it("stops opening once skip_count reaches the cap", () => {
    expect(shouldAutoOpenOnboarding({ completedAt: null, skipCount: 3 })).toBe(false);
  });

  it("stops opening beyond the skip cap", () => {
    expect(shouldAutoOpenOnboarding({ completedAt: null, skipCount: 5 })).toBe(false);
  });
});

describe("firstUnansweredIndex", () => {
  it("returns 0 when nothing has been answered", () => {
    expect(firstUnansweredIndex(questions, {})).toBe(0);
  });

  it("resumes at the first question without a saved answer", () => {
    expect(firstUnansweredIndex(questions, { q1: "a" })).toBe(1);
  });

  it("falls back to the last question once everything is answered", () => {
    expect(firstUnansweredIndex(questions, { q1: "a", q2: "b", q3: ["c"] })).toBe(2);
  });
});
