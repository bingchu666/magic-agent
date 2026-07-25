"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

type MessageVersionSwitcherProps = {
  index: number;
  total: number;
  onChange: (nextIndex: number) => void;
  prevLabel: string;
  nextLabel: string;
  disabled?: boolean;
};

export function MessageVersionSwitcher({
  index,
  total,
  onChange,
  prevLabel,
  nextLabel,
  disabled,
}: MessageVersionSwitcherProps) {
  return (
    <div className="flex items-center gap-1 text-xs text-zinc-500">
      <button
        type="button"
        onClick={() => onChange(index - 1)}
        disabled={disabled || index <= 0}
        aria-label={prevLabel}
        title={prevLabel}
        className="rounded p-0.5 transition hover:bg-zinc-200 hover:text-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>
      <span className="tabular-nums">
        {index + 1}/{total}
      </span>
      <button
        type="button"
        onClick={() => onChange(index + 1)}
        disabled={disabled || index >= total - 1}
        aria-label={nextLabel}
        title={nextLabel}
        className="rounded p-0.5 transition hover:bg-zinc-200 hover:text-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
