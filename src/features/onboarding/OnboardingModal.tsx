"use client";

import { useState } from "react";
import { ArrowRight, X } from "lucide-react";
import clsx from "clsx";
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
    <div className="magic-onboarding-backdrop">
      <div className="magic-onboarding-modal">
        <div className="magic-onboarding-head">
          <p className="magic-onboarding-eyebrow">
            {isZh ? `问题 ${index + 1} / ${questions.length}` : `Question ${index + 1} / ${questions.length}`}
          </p>
          <button
            type="button"
            onClick={() => onClose(answers)}
            disabled={saving}
            aria-label={isZh ? "关闭问卷" : "Close survey"}
            className="magic-onboarding-close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="magic-onboarding-track" aria-hidden="true">
          {questions.map((item, itemIndex) => (
            <i key={item.id} className={clsx(itemIndex < index && "is-done")} />
          ))}
        </div>

        <h2>{isZh ? question.prompt.zh : question.prompt.en}</h2>

        <div className="magic-onboarding-options">
          {question.type === "single"
            ? question.options.map((option) => {
                const selected = answers[question.id] === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    disabled={saving}
                    onClick={() => handleSingleSelect(option.value)}
                    className={clsx("magic-onboarding-option", selected && "is-selected")}
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
                    className={clsx("magic-onboarding-option", selected && "is-selected")}
                  >
                    {isZh ? option.label.zh : option.label.en}
                  </button>
                );
              })}
        </div>

        {error ? <p className="magic-form-notice is-error">{error}</p> : null}

        <div className="magic-onboarding-footer">
          <button type="button" onClick={handleSkip} disabled={saving} className="magic-onboarding-skip">
            {isZh ? "跳过" : "Skip"}
          </button>

          {question.type === "multi" ? (
            <button
              type="button"
              onClick={handleMultiConfirm}
              disabled={saving || multiSelection.length === 0}
              className="magic-onboarding-next"
            >
              <span>{saving ? "..." : isLast ? (isZh ? "完成" : "Finish") : isZh ? "下一步" : "Next"}</span>
              <ArrowRight size={14} />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
