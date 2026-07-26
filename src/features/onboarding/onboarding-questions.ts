import { Locale } from "@/lib/domain/types";

export type OnboardingAnswerValue = string | string[];
export type OnboardingAnswers = Record<string, OnboardingAnswerValue>;

export type OnboardingOption = {
  value: string;
  label: Record<Locale, string>;
};

export type OnboardingQuestion = {
  id: string;
  type: "single" | "multi";
  prompt: Record<Locale, string>;
  options: OnboardingOption[];
};

// Ordered list of onboarding questions. Add new questions here — the modal,
// gating logic, and progress indicator all derive from this array.
export const ONBOARDING_QUESTIONS: OnboardingQuestion[] = [
  {
    id: "magic_experience_level",
    type: "single",
    prompt: {
      zh: "你对魔术的了解程度是？",
      en: "How familiar are you with magic?",
    },
    options: [
      { value: "beginner", label: { zh: "完全没接触过", en: "Total beginner" } },
      { value: "some_exposure", label: { zh: "看过表演，了解一点", en: "Seen some, know a little" } },
      { value: "hobbyist", label: { zh: "会一些基础手法", en: "Know some basic sleights" } },
      { value: "experienced", label: { zh: "有一定经验，会多个套路", en: "Experienced, know several routines" } },
    ],
  },
  {
    id: "learning_duration",
    type: "single",
    prompt: {
      zh: "你打算/已经学习魔术多久了？",
      en: "How long have you been (or plan to be) learning magic?",
    },
    options: [
      { value: "just_starting", label: { zh: "刚开始，还没学", en: "Just starting" } },
      { value: "under_3_months", label: { zh: "3 个月以内", en: "Under 3 months" } },
      { value: "3_to_12_months", label: { zh: "3 个月到 1 年", en: "3 months to 1 year" } },
      { value: "over_1_year", label: { zh: "1 年以上", en: "Over 1 year" } },
    ],
  },
  {
    id: "target_level",
    type: "single",
    prompt: {
      zh: "你想学到什么水平？",
      en: "What level do you want to reach?",
    },
    options: [
      { value: "casual_fun", label: { zh: "朋友聚会随手表演", en: "Casual tricks for friends" } },
      { value: "confident_amateur", label: { zh: "能自信地公开表演", en: "Confidently perform in public" } },
      { value: "semi_pro", label: { zh: "达到半专业水平", en: "Semi-professional level" } },
      { value: "professional", label: { zh: "成为职业魔术师", en: "Become a professional magician" } },
    ],
  },
  {
    id: "interested_categories",
    type: "multi",
    prompt: {
      zh: "你对哪些类型的魔术感兴趣？（可多选）",
      en: "Which types of magic interest you? (select all that apply)",
    },
    options: [
      { value: "card_magic", label: { zh: "纸牌魔术", en: "Card magic" } },
      { value: "coin_magic", label: { zh: "硬币魔术", en: "Coin magic" } },
      { value: "close_up", label: { zh: "近景魔术", en: "Close-up magic" } },
      { value: "mentalism", label: { zh: "读心 / 心灵魔术", en: "Mentalism" } },
      { value: "stage_magic", label: { zh: "舞台魔术", en: "Stage magic" } },
      { value: "street_magic", label: { zh: "街头魔术", en: "Street magic" } },
    ],
  },
  {
    id: "explanation_style",
    type: "single",
    prompt: {
      zh: "你更喜欢哪种讲解方式？",
      en: "Which explanation style do you prefer?",
    },
    options: [
      { value: "step_by_step", label: { zh: "详细步骤，一步步来", en: "Detailed steps, one at a time" } },
      { value: "concise_direct", label: { zh: "简洁直接，自己摸索细节", en: "Concise and direct — I'll work out the details" } },
    ],
  },
];
