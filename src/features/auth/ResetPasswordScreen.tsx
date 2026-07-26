"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, KeyRound } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { PasswordInput } from "@/features/auth/PasswordInput";

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
      setSessionReady(Boolean(data.session));
      setCheckingSession(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
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

      setMessage(
        isZh
          ? "密码重置成功，请使用新密码登录。"
          : "Password reset successful. Please sign in with your new password."
      );
      setTimeout(() => {
        router.replace("/auth");
      }, 1500);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : isZh ? "重置失败，请重试" : "Failed to reset password"
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
          <h2>{isZh ? "设置新密码" : "Set a new password"}</h2>
          {!checkingSession && sessionReady ? (
            <p>{isZh ? "为你的账号设置一个新密码。" : "Choose a new password for your account."}</p>
          ) : null}
        </div>

        {checkingSession ? (
          <p className="magic-auth-status">{isZh ? "正在验证链接…" : "Verifying link…"}</p>
        ) : !sessionReady ? (
          <div className="magic-auth-notice-block">
            <p className="magic-form-notice is-error">
              {isZh
                ? "链接无效或已过期，请重新申请重置密码。"
                : "This link is invalid or has expired. Please request a new one."}
            </p>
            <Link href="/auth/forgot-password" className="magic-auth-back-link">
              <ArrowLeft size={13} />
              {isZh ? "重新申请" : "Request a new link"}
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="magic-auth-form">
            <label>
              <span>
                {isZh
                  ? `新密码（至少 ${MIN_PASSWORD_LENGTH} 位）`
                  : `New password (min. ${MIN_PASSWORD_LENGTH})`}
              </span>
              <PasswordInput
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={MIN_PASSWORD_LENGTH}
                placeholder="••••••••"
                showLabel={isZh ? "显示密码" : "Show password"}
                hideLabel={isZh ? "隐藏密码" : "Hide password"}
              />
            </label>

            <label>
              <span>{isZh ? "确认新密码" : "Confirm new password"}</span>
              <PasswordInput
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
                minLength={MIN_PASSWORD_LENGTH}
                placeholder="••••••••"
                showLabel={isZh ? "显示密码" : "Show password"}
                hideLabel={isZh ? "隐藏密码" : "Hide password"}
              />
            </label>

            {error ? <p className="magic-form-notice is-error">{error}</p> : null}
            {message ? <p className="magic-form-notice is-success">{message}</p> : null}

            <button type="submit" className="magic-auth-submit" disabled={loading}>
              <span>{loading ? (isZh ? "提交中…" : "Submitting…") : isZh ? "重置密码" : "Reset password"}</span>
              <KeyRound size={17} />
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
