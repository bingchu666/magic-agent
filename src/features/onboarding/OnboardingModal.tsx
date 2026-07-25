"use client";

import { useState } from "react";
import { Locale } from "@/lib/domain/types";
import { OnboardingAnswers, OnboardingQuestion } from "@/features/onboarding/onboarding-questions";

type OnboardingModalProps = {
  questions: OnboardingQuestion[];
  initialAnswers: OnboardingAnswers;
  startIndex: number;
  locale: Locale;
  saving: boolean;
  error: string | null;
  onClose: (answers: OnboardingAnswers) => void;
  onFinish: (answers: OnboardingAnswers) => void;
};

function initialMultiSelection(question: OnboardingQuestion | undefined, answers: OnboardingAnswers): string[] {
  if (!question) return [];
  const existing = answers[question.id];
  return Array.isArray(existing) ? existing : [];
}

export function OnboardingModal({
  questions,
  initialAnswers,
  startIndex,
  locale,
  saving,
  error,
  onClose,
  onFinish,
}: OnboardingModalProps) {
  const [index, setIndex] = useState(() => Math.min(Math.max(startIndex, 0), questions.length - 1));
  const [answers, setAnswers] = useState<OnboardingAnswers>(initialAnswers);
  const [multiSelection, setMultiSelection] = useState<string[]>(() =>
    initialMultiSelection(questions[Math.min(Math.max(startIndex, 0), questions.length - 1)], initialAnswers)
  );

  const isZh = locale === "zh";
  const question = questions[index];
  const isLast = index === questions.length - 1;

  const advance = (nextAnswers: OnboardingAnswers) => {
    if (isLast) {
      onFinish(nextAnswers);
      return;
    }
    const nextIndex = index + 1;
    setIndex(nextIndex);
    setMultiSelection(initialMultiSelection(questions[nextIndex], nextAnswers));
  };

  const handleSingleSelect = (value: string) => {
    const nextAnswers = { ...answers, [question.id]: value };
    setAnswers(nextAnswers);
    advance(nextAnswers);
  };

  const toggleMultiOption = (value: string) => {
    setMultiSelection((prev) => (prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value]));
  };

  const handleMultiConfirm = () => {
    const nextAnswers = { ...answers, [question.id]: multiSelection };
    setAnswers(nextAnswers);
    advance(nextAnswers);
  };

  const handleSkip = () => {
    advance(answers);
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-[28px] border border-black/10 bg-white p-8 shadow-2xl">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
            {isZh ? `问题 ${index + 1} / ${questions.length}` : `Question ${index + 1} / ${questions.length}`}
          </p>
          <button
            type="button"
            onClick={() => onClose(answers)}
            disabled={saving}
            className="text-xs font-semibold text-zinc-400 hover:text-zinc-700 disabled:opacity-40"
          >
            {isZh ? "关闭 ✕" : "Close ✕"}
          </button>
        </div>

        <h2 className="mt-3 text-xl font-semibold tracking-tight text-zinc-900">
          {isZh ? question.prompt.zh : question.prompt.en}
        </h2>

        <div className="mt-5 space-y-2">
          {question.type === "single"
            ? question.options.map((option) => {
                const selected = answers[question.id] === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    disabled={saving}
                    onClick={() => handleSingleSelect(option.value)}
                    className={`w-full rounded-xl border px-4 py-3 text-left text-sm transition disabled:opacity-40 ${
                      selected ? "border-black bg-black text-white" : "border-zinc-300 hover:bg-zinc-50"
                    }`}
                  >
                    {isZh ? option.label.zh : option.label.en}
                  </button>
                );
              })
            : question.options.map((option) => {
                const selected = multiSelection.includes(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    disabled={saving}
                    onClick={() => toggleMultiOption(option.value)}
                    className={`w-full rounded-xl border px-4 py-3 text-left text-sm transition disabled:opacity-40 ${
                      selected ? "border-black bg-black text-white" : "border-zinc-300 hover:bg-zinc-50"
                    }`}
                  >
                    {isZh ? option.label.zh : option.label.en}
                  </button>
                );
              })}
        </div>

        {error && <p className="mt-3 text-xs text-rose-600">{error}</p>}

        <div className="mt-6 flex items-center justify-between">
          <button
            type="button"
            onClick={handleSkip}
            disabled={saving}
            className="text-sm font-semibold text-zinc-500 underline disabled:opacity-40"
          >
            {isZh ? "跳过" : "Skip"}
          </button>

          {question.type === "multi" && (
            <button
              type="button"
              onClick={handleMultiConfirm}
              disabled={saving || multiSelection.length === 0}
              className="rounded-xl bg-black px-4 py-2 text-sm font-semibold uppercase tracking-wide text-white disabled:opacity-40"
            >
              {saving ? "..." : isLast ? (isZh ? "完成" : "Finish") : isZh ? "下一步" : "Next"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
