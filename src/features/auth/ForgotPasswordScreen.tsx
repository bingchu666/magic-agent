"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const LOCALE_STORAGE_KEY = "magic_locale_v1";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ForgotPasswordScreen() {
  const supabase = getSupabaseBrowserClient();

  const [email, setEmail] = useState("");
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

  const isZh = locale === "zh";

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setMessage(null);

    const trimmedEmail = email.trim();
    if (!EMAIL_PATTERN.test(trimmedEmail)) {
      setError(isZh ? "请输入有效的邮箱地址" : "Please enter a valid email address");
      return;
    }

    setLoading(true);

    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
        redirectTo: `${window.location.origin}/auth/reset-password`,
      });

      if (resetError) throw resetError;

      setMessage(
        isZh
          ? "如果该邮箱已注册，我们已发送重置密码的链接，请查收邮件。"
          : "If that email is registered, we've sent a password reset link — check your inbox."
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : isZh ? "发送失败，请重试" : "Failed to send reset email");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_20%_20%,#fecdd3,transparent_35%),radial-gradient(circle_at_90%_0%,#a5f3fc,transparent_35%),linear-gradient(180deg,#f8fafc_0%,#e2e8f0_100%)] p-4">
      <div className="w-full max-w-lg rounded-[28px] border border-black/10 bg-white/90 p-8 shadow-2xl shadow-zinc-300/40 backdrop-blur">
        <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Magic Agent V1</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900">
          {isZh ? "重置密码" : "Reset your password"}
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          {isZh
            ? "输入你的注册邮箱，我们会发送一个重置密码的链接给你。"
            : "Enter your account email and we'll send you a link to reset your password."}
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
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

          {error && <p className="text-xs text-rose-600">{error}</p>}
          {message && <p className="text-xs text-emerald-600">{message}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-black px-4 py-3 text-sm font-semibold uppercase tracking-wide text-white disabled:opacity-40"
          >
            {loading ? "..." : isZh ? "发送重置链接" : "Send reset link"}
          </button>

          <p className="text-center text-sm text-zinc-500">
            <Link href="/auth" className="font-semibold text-black underline">
              {isZh ? "返回登录" : "Back to sign in"}
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
