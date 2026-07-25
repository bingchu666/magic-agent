"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useSession } from "@/features/auth/session.client";
import { OnboardingModal } from "@/features/onboarding/OnboardingModal";
import { firstUnansweredIndex, shouldAutoOpenOnboarding } from "@/features/onboarding/onboarding-logic";
import { ONBOARDING_QUESTIONS, OnboardingAnswers } from "@/features/onboarding/onboarding-questions";

type OnboardingRecord = {
  answers: OnboardingAnswers;
  completedAt: string | null;
  skipCount: number;
};

type OnboardingContextValue = {
  ready: boolean;
  openManually: () => void;
};

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function useOnboarding() {
  const ctx = useContext(OnboardingContext);
  if (!ctx) throw new Error("useOnboarding must be used inside OnboardingProvider");
  return ctx;
}

async function fetchOnboarding(): Promise<OnboardingRecord> {
  const res = await fetch("/api/onboarding", { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load onboarding");
  const json = await res.json();
  return json.item as OnboardingRecord;
}

async function saveOnboarding(payload: {
  answers: OnboardingAnswers;
  complete?: boolean;
  incrementSkip?: boolean;
}): Promise<OnboardingRecord> {
  const res = await fetch("/api/onboarding", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json?.error || "Failed to save onboarding");
  }
  const json = await res.json();
  return json.item as OnboardingRecord;
}

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: sessionLoading } = useSession();
  const locale = user?.locale ?? "zh";

  const [record, setRecord] = useState<OnboardingRecord | null>(null);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [startIndex, setStartIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchedForUserRef = useRef<string | null>(null);

  useEffect(() => {
    if (sessionLoading || !user) return;
    if (fetchedForUserRef.current === user.id) return;
    fetchedForUserRef.current = user.id;

    fetchOnboarding()
      .then((item) => {
        setRecord(item);
        setReady(true);
        if (shouldAutoOpenOnboarding(item)) {
          setStartIndex(firstUnansweredIndex(ONBOARDING_QUESTIONS, item.answers));
          setOpen(true);
        }
      })
      .catch(() => {
        // Not critical to the rest of the app — just skip auto-open this session.
        setReady(true);
      });
  }, [sessionLoading, user]);

  const openManually = useCallback(() => {
    setStartIndex(0);
    setError(null);
    setOpen(true);
  }, []);

  const handleClose = useCallback(async (answers: OnboardingAnswers) => {
    setSaving(true);
    setError(null);
    try {
      const updated = await saveOnboarding({ answers, incrementSkip: true });
      setRecord(updated);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }, []);

  const handleFinish = useCallback(async (answers: OnboardingAnswers) => {
    setSaving(true);
    setError(null);
    try {
      const updated = await saveOnboarding({ answers, complete: true });
      setRecord(updated);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }, []);

  return (
    <OnboardingContext.Provider value={{ ready, openManually }}>
      {children}
      {open && user && (
        <OnboardingModal
          questions={ONBOARDING_QUESTIONS}
          initialAnswers={record?.answers ?? {}}
          startIndex={startIndex}
          locale={locale}
          saving={saving}
          error={error}
          onClose={handleClose}
          onFinish={handleFinish}
        />
      )}
    </OnboardingContext.Provider>
  );
}
