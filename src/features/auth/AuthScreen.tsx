"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const LOCALE_STORAGE_KEY = "magic_locale_v1";

export function AuthScreen() {
  const router = useRouter();
  const supabase = getSupabaseBrowserClient();

  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [locale, setLocale] = useState<"zh" | "en">("zh");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const callbackError = params.get("error");
    if (callbackError) {
      setError(callbackError);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) throw signInError;

      if (typeof window !== "undefined") {
        window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
      }

      router.replace("/chat");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (oauthError) throw oauthError;
      // On success the SDK redirects the browser to Google — nothing else to do here.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in failed");
      setLoading(false);
    }
  };

  const handleRegister = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            name: name.trim() || email.split("@")[0],
            locale,
            role: "user",
          },
        },
      });

      if (signUpError) throw signUpError;

      if (typeof window !== "undefined") {
        window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
      }

      // Email confirmation is enabled — no session returned, user must verify first
      if (data.session) {
        router.replace("/chat");
        router.refresh();
      } else {
        setMessage(
          locale === "zh"
            ? "注册成功！请查看邮箱并点击验证链接，验证后返回登录。"
            : "Account created! Check your email for the confirmation link, then sign in."
        );
        setMode("login");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  const isZh = locale === "zh";

  return (
    <div className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_20%_20%,#fecdd3,transparent_35%),radial-gradient(circle_at_90%_0%,#a5f3fc,transparent_35%),linear-gradient(180deg,#f8fafc_0%,#e2e8f0_100%)] p-4">
      <div className="w-full max-w-lg rounded-[28px] border border-black/10 bg-white/90 p-8 shadow-2xl shadow-zinc-300/40 backdrop-blur">
        <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Magic Agent V1</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900">
          {isZh ? "登录你的魔术工作台" : "Sign in to your magic workspace"}
        </h1>

        {mode === "login" ? (
          <form onSubmit={handleLogin} className="mt-6 space-y-4">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="you@example.com"
                className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                {isZh ? "密码" : "Password"}
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm"
              />
              <div className="mt-1 text-right">
                <Link
                  href="/auth/forgot-password"
                  className="text-xs font-semibold text-zinc-500 underline hover:text-zinc-700"
                >
                  {isZh ? "忘记密码？" : "Forgot password?"}
                </Link>
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                {isZh ? "语言" : "Locale"}
              </label>
              <select
                value={locale}
                onChange={(e) => setLocale(e.target.value as "zh" | "en")}
                className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm"
              >
                <option value="zh">中文</option>
                <option value="en">English</option>
              </select>
            </div>

            {error && <p className="text-xs text-rose-600">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-black px-4 py-3 text-sm font-semibold uppercase tracking-wide text-white disabled:opacity-40"
            >
              {loading ? "..." : isZh ? "登录" : "Sign In"}
            </button>

            <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-zinc-400">
              <span className="h-px flex-1 bg-zinc-200" />
              {isZh ? "或" : "or"}
              <span className="h-px flex-1 bg-zinc-200" />
            </div>

            <button
              type="button"
              onClick={handleGoogleLogin}
              disabled={loading}
              className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm font-semibold uppercase tracking-wide text-zinc-900 hover:bg-zinc-50 disabled:opacity-40"
            >
              {loading ? "..." : isZh ? "使用 Google 登录" : "Continue with Google"}
            </button>

            <p className="text-center text-sm text-zinc-500">
              {isZh ? "还没有账号？" : "No account yet? "}
              <button
                type="button"
                onClick={() => { setMode("register"); setError(null); setMessage(null); }}
                className="font-semibold text-black underline"
              >
                {isZh ? "注册" : "Create one"}
              </button>
            </p>
          </form>
        ) : (
          <form onSubmit={handleRegister} className="mt-6 space-y-4">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                {isZh ? "昵称" : "Display Name"}
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder={isZh ? "你的昵称" : "Your name"}
                className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="you@example.com"
                className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                {isZh ? "密码（至少 6 位）" : "Password (min 6 chars)"}
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                {isZh ? "语言" : "Locale"}
              </label>
              <select
                value={locale}
                onChange={(e) => setLocale(e.target.value as "zh" | "en")}
                className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm"
              >
                <option value="zh">中文</option>
                <option value="en">English</option>
              </select>
            </div>

            {error && <p className="text-xs text-rose-600">{error}</p>}
            {message && <p className="text-xs text-emerald-600">{message}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-black px-4 py-3 text-sm font-semibold uppercase tracking-wide text-white disabled:opacity-40"
            >
              {loading ? "..." : isZh ? "注册" : "Create Account"}
            </button>

            <p className="text-center text-sm text-zinc-500">
              {isZh ? "已有账号？" : "Already have an account? "}
              <button
                type="button"
                onClick={() => { setMode("login"); setError(null); setMessage(null); }}
                className="font-semibold text-black underline"
              >
                {isZh ? "登录" : "Sign In"}
              </button>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
