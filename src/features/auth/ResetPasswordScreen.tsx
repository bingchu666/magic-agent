"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const LOCALE_STORAGE_KEY = "magic_locale_v1";
const MIN_PASSWORD_LENGTH = 6;

export function ResetPasswordScreen() {
  const router = useRouter();
  const supabase = getSupabaseBrowserClient();

  const [locale, setLocale] = useState<"zh" | "en">("zh");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (saved === "zh" || saved === "en") {
      setLocale(saved);
      return;
    }
    const browserLang = (navigator.language || "").toLowerCase();
    setLocale(browserLang.startsWith("zh") ? "zh" : "en");
  }, []);

  useEffect(() => {
    // Clicking the emailed recovery link redirects here with the auth tokens
    // in the URL; the Supabase client parses them and establishes a session.
    supabase.auth.getSession().then(({ data }) => {
      setSessionReady(!!data.session);
      setCheckingSession(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || session) {
        setSessionReady(true);
        setCheckingSession(false);
      }
    });

    return () => subscription.unsubscribe();
  }, [supabase]);

  const isZh = locale === "zh";

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(
        isZh
          ? `密码长度至少需要 ${MIN_PASSWORD_LENGTH} 位`
          : `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
      );
      return;
    }

    if (password !== confirmPassword) {
      setError(isZh ? "两次输入的密码不一致" : "Passwords do not match");
      return;
    }

    setLoading(true);

    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;

      await supabase.auth.signOut();

      setMessage(isZh ? "密码重置成功，请使用新密码登录。" : "Password reset successful. Please sign in with your new password.");
      setTimeout(() => {
        router.replace("/auth");
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : isZh ? "重置失败，请重试" : "Failed to reset password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_20%_20%,#fecdd3,transparent_35%),radial-gradient(circle_at_90%_0%,#a5f3fc,transparent_35%),linear-gradient(180deg,#f8fafc_0%,#e2e8f0_100%)] p-4">
      <div className="w-full max-w-lg rounded-[28px] border border-black/10 bg-white/90 p-8 shadow-2xl shadow-zinc-300/40 backdrop-blur">
        <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Magic Agent V1</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900">
          {isZh ? "设置新密码" : "Set a new password"}
        </h1>

        {checkingSession ? (
          <p className="mt-6 text-sm text-zinc-500">{isZh ? "正在验证链接..." : "Verifying link..."}</p>
        ) : !sessionReady ? (
          <div className="mt-6 space-y-4">
            <p className="text-xs text-rose-600">
              {isZh
                ? "链接无效或已过期，请重新申请重置密码。"
                : "This link is invalid or has expired. Please request a new one."}
            </p>
            <p className="text-center text-sm text-zinc-500">
              <Link href="/auth/forgot-password" className="font-semibold text-black underline">
                {isZh ? "重新申请" : "Request a new link"}
              </Link>
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                {isZh ? `新密码（至少 ${MIN_PASSWORD_LENGTH} 位）` : `New password (min ${MIN_PASSWORD_LENGTH} chars)`}
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={MIN_PASSWORD_LENGTH}
                className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                {isZh ? "确认新密码" : "Confirm new password"}
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={MIN_PASSWORD_LENGTH}
                className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm"
              />
            </div>

            {error && <p className="text-xs text-rose-600">{error}</p>}
            {message && <p className="text-xs text-emerald-600">{message}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-black px-4 py-3 text-sm font-semibold uppercase tracking-wide text-white disabled:opacity-40"
            >
              {loading ? "..." : isZh ? "重置密码" : "Reset password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
