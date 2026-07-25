"use client";

import { useState } from "react";
import clsx from "clsx";

type QuickOptionsPromptProps = {
  question: string;
  options: string[];
  onSelect: (option: string) => void;
};

export function QuickOptionsPrompt({ question, options, onSelect }: QuickOptionsPromptProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const answered = selected !== null;

  const handleSelect = (option: string) => {
    if (answered) return;
    setSelected(option);
    onSelect(option);
  };

  return (
    <div className="mt-2 rounded-xl border border-zinc-200 bg-white p-3">
      <p className="text-sm font-medium text-zinc-700">{question}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((option) => {
          const isSelected = selected === option;
          return (
            <button
              key={option}
              type="button"
              disabled={answered}
              onClick={() => handleSelect(option)}
              className={clsx(
                "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                isSelected
                  ? "border-[#202123] bg-[#202123] text-white"
                  : answered
                  ? "cursor-not-allowed border-zinc-200 bg-zinc-100 text-zinc-400"
                  : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"
              )}
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}
