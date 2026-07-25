"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import clsx from "clsx";

type CopyMessageButtonProps = {
  content: string;
  label: string;
  copiedLabel: string;
  className?: string;
};

const COPIED_RESET_MS = 1500;

export function CopyMessageButton({ content, label, copiedLabel, className }: CopyMessageButtonProps) {
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
    };
  }, []);

  const handleCopy = async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = window.setTimeout(() => setCopied(false), COPIED_RESET_MS);
    } catch {
      // Clipboard access denied or unavailable — nothing sensible to fall back to here.
    }
  };

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      aria-label={copied ? copiedLabel : label}
      title={copied ? copiedLabel : label}
      className={clsx(
        "inline-flex items-center justify-center rounded-md p-1 text-zinc-400 transition hover:bg-zinc-200 hover:text-zinc-700",
        className
      )}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}
