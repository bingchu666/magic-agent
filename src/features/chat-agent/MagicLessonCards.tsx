"use client";

import { LessonPayload, Locale } from "@/lib/domain/types";

type Props = {
  payload: LessonPayload;
  locale: Locale;
  onQuickAsk: (prompt: string) => void;
};

function toStringArray(items: unknown): string[] {
  if (Array.isArray(items)) {
    return items.map((item) => String(item ?? "").trim()).filter(Boolean);
  }
  if (typeof items === "string") {
    const text = items.trim();
    if (!text) return [];
    return [text];
  }
  return [];
}

function Section({ title, items }: { title: string; items: unknown }) {
  const list = toStringArray(items);
  if (!list.length) return null;
  return (
    <div className="mt-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</p>
      <ul className="mt-1 space-y-1">
        {list.map((item, index) => (
          <li key={`${title}-${index}`} className="flex gap-2 text-sm leading-5 text-zinc-700">
            <span className="mt-2 h-1.5 w-1.5 rounded-full bg-zinc-400" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MagicLessonCards({ payload, locale, onQuickAsk }: Props) {
  const cards = Array.isArray(payload?.cards) ? payload.cards : [];
  const lessonSteps = Array.isArray(payload?.lesson?.steps) ? payload.lesson.steps : [];
  const nextPrompts = toStringArray(payload?.next);

  const copy = locale === "zh"
    ? {
        lesson: "教学步骤",
        audience: "观众看到",
        youSay: "你说",
        youDo: "你做",
        practice: "练习",
        checklist: "检查清单",
        mistakes: "常见问题",
        note: "安全提示",
      }
    : {
        lesson: "Lesson Steps",
        audience: "Audience Sees",
        youSay: "You Say",
        youDo: "You Do",
        practice: "Practice",
        checklist: "Checklist",
        mistakes: "Common Mistakes",
        note: "Safety Note",
      };

  return (
    <div className="space-y-3 break-words">
      <p className="text-base font-semibold leading-6 text-zinc-900">{payload.summary || "..."}</p>

      <div className="space-y-2">
        {cards.map((card, index) => (
          <div key={`card-${index}`} className="rounded-2xl border border-black/10 bg-white p-3">
            <p className="text-sm font-semibold text-zinc-900">{card.title}</p>
            <ul className="mt-2 space-y-1">
              {toStringArray(card.bullets).map((bullet, bulletIndex) => (
                <li key={`card-${index}-bullet-${bulletIndex}`} className="flex gap-2 text-sm text-zinc-700">
                  <span className="mt-2 h-1.5 w-1.5 rounded-full bg-zinc-400" />
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {lessonSteps.length ? (
        <div className="space-y-2 rounded-2xl border border-black/10 bg-white p-3">
          <p className="text-sm font-semibold text-zinc-900">{copy.lesson}</p>
          {lessonSteps.map((step, index) => {
            const compatibleStep = step as typeof step & {
              audience_sees?: unknown;
              you_say?: unknown;
              you_do?: unknown;
            };
            return (
              <div key={`step-${index}`} className="rounded-xl border border-zinc-200 p-3">
                <p className="text-sm font-semibold text-zinc-900">{step.step}</p>
                <Section title={copy.audience} items={step.audienceSees ?? compatibleStep.audience_sees} />
                <Section title={copy.youSay} items={step.youSay ?? compatibleStep.you_say} />
                <Section title={copy.youDo} items={step.youDo ?? compatibleStep.you_do} />
                <Section title={copy.practice} items={step.practice} />
              </div>
            );
          })}
        </div>
      ) : null}

      {toStringArray(payload.lesson?.checklist).length ? (
        <Section title={copy.checklist} items={payload.lesson?.checklist} />
      ) : null}

      {toStringArray(payload.lesson?.commonMistakes ?? (payload.lesson as typeof payload.lesson & { common_mistakes?: unknown })?.common_mistakes).length ? (
        <Section title={copy.mistakes} items={payload.lesson?.commonMistakes ?? (payload.lesson as typeof payload.lesson & { common_mistakes?: unknown })?.common_mistakes} />
      ) : null}

      {payload.safety ? (
        <p className="text-xs text-amber-700">
          {copy.note}: {payload.safety}
        </p>
      ) : null}

      {nextPrompts.length ? (
        <div className="flex flex-wrap gap-2 pt-1">
          {nextPrompts.slice(0, 3).map((nextPrompt, index) => (
            <button
              key={`next-${index}`}
              type="button"
              onClick={() => onQuickAsk(nextPrompt)}
              className="rounded-full border border-black/10 bg-white px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
            >
              {nextPrompt}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
