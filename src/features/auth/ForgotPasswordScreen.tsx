"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Mail } from "lucide-react";
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
      setError(
        err instanceof Error ? err.message : isZh ? "发送失败，请重试" : "Failed to send reset email"
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="magic-auth-panel">
      <div className="magic-auth-form-wrap">
        <div className="magic-auth-form-heading">
          <span>Magic Agent</span>
          <h2>{isZh ? "重置密码" : "Reset your password"}</h2>
          <p>
            {isZh
              ? "输入你的注册邮箱，我们会发送一个重置密码的链接给你。"
              : "Enter your account email and we'll send you a link to reset your password."}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="magic-auth-form">
          <label>
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              placeholder="you@example.com"
            />
          </label>

          {error ? <p className="magic-form-notice is-error">{error}</p> : null}
          {message ? <p className="magic-form-notice is-success">{message}</p> : null}

          <button type="submit" className="magic-auth-submit" disabled={loading}>
            <span>
              {loading ? (isZh ? "发送中…" : "Sending…") : isZh ? "发送重置链接" : "Send reset link"}
            </span>
            <Mail size={17} />
          </button>
        </form>

        <Link href="/auth" className="magic-auth-back-link">
          <ArrowLeft size={13} />
          {isZh ? "返回登录" : "Back to sign in"}
        </Link>
      </div>
    </div>
  );
}
