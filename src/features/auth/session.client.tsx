"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
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

function persistPreferredLocale(locale: Locale) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  const loadUser = useCallback(async (current: Awaited<ReturnType<typeof supabase.auth.getUser>>["data"]["user"]) => {
    if (!current) return null;
    const { data: profile } = await supabase
      .from("profiles")
      .select("name, role, locale")
      .eq("id", current.id)
      .maybeSingle();
    return supabaseUserToSessionUser(current, profile);
  }, [supabase]);

  const refresh = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const current = data.session?.user ?? null;
    setUser(await loadUser(current));
  }, [loadUser, supabase]);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      const u = data.session?.user ?? null;
      setUser(await loadUser(u));
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null;
      setTimeout(() => {
        loadUser(u).then(setUser);
      }, 0);
    });

    return () => subscription.unsubscribe();
  }, [loadUser, supabase]);

  const setLocale = useCallback(async (locale: Locale) => {
    persistPreferredLocale(locale);
    if (!user) return;

    const previous = user.locale;
    setUser((prev) => (prev ? { ...prev, locale } : prev));

    try {
      const { error: authError } = await supabase.auth.updateUser({ data: { locale } });
      if (authError) throw authError;
      const { error: profileError } = await supabase.from("profiles").update({ locale }).eq("id", user.id);
      if (profileError) throw profileError;
    } catch {
      setUser((prev) => (prev ? { ...prev, locale: previous } : prev));
    }
  }, [supabase, user]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
  }, [supabase]);

  const value = useMemo(
    () => ({ user, loading, refresh, setLocale, signOut }),
    [user, loading, refresh, setLocale, signOut]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession must be used inside SessionProvider");
  return context;
}
