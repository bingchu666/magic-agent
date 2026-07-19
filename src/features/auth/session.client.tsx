"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Locale } from "@/lib/domain/types";
import { SessionUser } from "@/features/auth/session.types";

type SessionContextValue = {
  user: SessionUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  setLocale: (locale: Locale) => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);
const LOCALE_STORAGE_KEY = "magic_locale_v1";

function asLocale(value: string | null | undefined): Locale | null {
  if (value === "zh" || value === "en") return value;
  return null;
}

function getPreferredLocale(): Locale {
  if (typeof window === "undefined") return "zh";
  const saved = asLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY));
  if (saved) return saved;
  const lang = (navigator.language || "").toLowerCase();
  return lang.startsWith("zh") ? "zh" : "en";
}

function persistPreferredLocale(locale: Locale) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
}

async function fetchSession() {
  const res = await fetch("/api/auth/session", { cache: "no-store" });
  if (!res.ok) return null;
  const json = (await res.json()) as { user?: SessionUser };
  return json.user ?? null;
}

async function bootstrapGuestSession(locale: Locale) {
  const res = await fetch("/api/auth/demo-login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Guest",
      locale,
      role: "user",
    }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { user?: SessionUser };
  return json.user ?? null;
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async (preferredLocale?: Locale) => {
    let current = await fetchSession();
    if (!current) {
      current = await bootstrapGuestSession(preferredLocale || getPreferredLocale());
    }
    if (current?.locale) persistPreferredLocale(current.locale);
    setUser(current);
  };

  useEffect(() => {
    refresh(getPreferredLocale()).finally(() => setLoading(false));
  }, []);

  const setLocale = async (locale: Locale) => {
    persistPreferredLocale(locale);

    if (!user) {
      await refresh(locale);
      return;
    }

    const previous = user.locale;
    setUser((prev) => (prev ? { ...prev, locale } : prev));

    try {
      const res = await fetch("/api/auth/demo-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: user.name,
          locale,
          role: user.role,
        }),
      });
      if (!res.ok) throw new Error("Failed to switch locale");
      const json = (await res.json()) as { user?: SessionUser };
      if (json.user) {
        setUser(json.user);
      } else {
        await refresh(locale);
      }
    } catch {
      setUser((prev) => (prev ? { ...prev, locale: previous } : prev));
      await refresh(previous);
    }
  };

  const signOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    await refresh();
  };

  const value = useMemo(
    () => ({ user, loading, refresh, setLocale, signOut }),
    [user, loading]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession must be used inside SessionProvider");
  return context;
}
