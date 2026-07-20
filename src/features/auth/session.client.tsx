"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Locale } from "@/lib/domain/types";
import { SessionUser, supabaseUserToSessionUser } from "@/features/auth/session.types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type SessionContextValue = {
  user: SessionUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  setLocale: (locale: Locale) => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);
const LOCALE_STORAGE_KEY = "magic_locale_v1";

function getPreferredLocale(): Locale {
  if (typeof window === "undefined") return "zh";
  const saved = window.localStorage.getItem(LOCALE_STORAGE_KEY);
  if (saved === "zh" || saved === "en") return saved;
  const lang = (navigator.language || "").toLowerCase();
  return lang.startsWith("zh") ? "zh" : "en";
}

function persistPreferredLocale(locale: Locale) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = getSupabaseBrowserClient();

  const refresh = async () => {
    const { data } = await supabase.auth.getSession();
    const current = data.session?.user ?? null;
    setUser(current ? supabaseUserToSessionUser(current) : null);
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const u = data.session?.user ?? null;
      setUser(u ? supabaseUserToSessionUser(u) : null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null;
      setUser(u ? supabaseUserToSessionUser(u) : null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const setLocale = async (locale: Locale) => {
    persistPreferredLocale(locale);
    if (!user) return;

    const previous = user.locale;
    setUser((prev) => (prev ? { ...prev, locale } : prev));

    try {
      await supabase.auth.updateUser({ data: { locale } });
      await supabase.from("profiles").update({ locale }).eq("id", user.id);
    } catch {
      setUser((prev) => (prev ? { ...prev, locale: previous } : prev));
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
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
