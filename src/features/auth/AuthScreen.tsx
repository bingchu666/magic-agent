"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  BookOpenText,
  Check,
  Languages,
  Network,
  Sparkles,
} from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { PasswordInput } from "@/features/auth/PasswordInput";

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
    <div className="magic-auth-page">
      <section className="magic-auth-story">
        <div className="magic-auth-orbit orbit-one" />
        <div className="magic-auth-orbit orbit-two" />
        <div className="magic-auth-story-inner">
          <div className="magic-auth-brand">
            <span>
              <Sparkles size={18} />
            </span>
            <div>
              <strong>Magic Agent</strong>
              <small>Practice · Explore · Understand</small>
            </div>
          </div>

          <div className="magic-auth-hero">
            <p>{isZh ? "AI 驱动的练习与知识工作台" : "AI-powered practice and knowledge workspace"}</p>
            <h1>
              {isZh ? (
                <>
                  不只得到答案。
                  <br />
                  <em>看见思考的结构。</em>
                </>
              ) : (
                <>
                  Go beyond answers.
                  <br />
                  <em>See the structure.</em>
                </>
              )}
            </h1>
            <span>
              {isZh
                ? "从一次对话出发，把术语、资料、练习与自己的理解连接成持续生长的知识地图。"
                : "Turn conversations, sources, practice, and your own understanding into a living knowledge map."}
            </span>
          </div>

          <div className="magic-auth-map" aria-hidden="true">
            <div className="map-node node-root">
              <Sparkles size={14} />
            </div>
            <i className="map-line line-one" />
            <div className="map-node node-one">
              <Network size={14} />
            </div>
            <i className="map-line line-two" />
            <div className="map-node node-two">
              <BookOpenText size={14} />
            </div>
            <i className="map-line line-three" />
            <div className="map-node node-three">
              <Check size={14} />
            </div>
          </div>

          <div className="magic-auth-features">
            <div>
              <Network size={15} />
              <span>{isZh ? "层级对话" : "Hierarchical dialogue"}</span>
            </div>
            <div>
              <BookOpenText size={15} />
              <span>{isZh ? "文档理解" : "Document intelligence"}</span>
            </div>
            <div>
              <Sparkles size={15} />
              <span>{isZh ? "个性化陪练" : "Personal coaching"}</span>
            </div>
          </div>
        </div>
      </section>

      <section className="magic-auth-panel">
        <div className="magic-auth-form-wrap">
          <div className="magic-auth-form-heading">
            <span>{mode === "login" ? (isZh ? "欢迎回来" : "Welcome back") : (isZh ? "创建工作空间" : "Create your workspace")}</span>
            <h2>
              {mode === "login"
                ? isZh
                  ? "继续你的探索"
                  : "Continue exploring"
                : isZh
                  ? "建立你的思维宇宙"
                  : "Build your thinking universe"}
            </h2>
            <p>
              {mode === "login"
                ? isZh
                  ? "你的对话、资料和知识地图都在等你。"
                  : "Your conversations, sources, and maps are waiting."
                : isZh
                  ? "从第一个问题开始，让知识逐层展开。"
                  : "Start with one question and let knowledge unfold."}
            </p>
          </div>

          <div className="magic-auth-tabs" role="tablist" aria-label={isZh ? "登录或注册" : "Login or register"}>
            <button
              type="button"
              className={mode === "login" ? "is-active" : ""}
              onClick={() => {
                setMode("login");
                setError(null);
                setMessage(null);
              }}
            >
              {isZh ? "登录" : "Sign in"}
            </button>
            <button
              type="button"
              className={mode === "register" ? "is-active" : ""}
              onClick={() => {
                setMode("register");
                setError(null);
                setMessage(null);
              }}
            >
              {isZh ? "注册" : "Register"}
            </button>
          </div>

          <form
            onSubmit={mode === "login" ? handleLogin : handleRegister}
            className="magic-auth-form"
          >
            {mode === "register" ? (
              <label>
                <span>{isZh ? "昵称" : "Display name"}</span>
                <input
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  placeholder={isZh ? "我们该如何称呼你？" : "How should we call you?"}
                />
              </label>
            ) : null}

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

            <label>
              <span>{mode === "register" ? (isZh ? "密码（至少 6 位）" : "Password (min. 6)") : isZh ? "密码" : "Password"}</span>
              <PasswordInput
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={6}
                placeholder="••••••••"
                showLabel={isZh ? "显示密码" : "Show password"}
                hideLabel={isZh ? "隐藏密码" : "Hide password"}
              />
            </label>

            {mode === "login" ? (
              <p className="magic-auth-forgot">
                <Link href="/auth/forgot-password">{isZh ? "忘记密码？" : "Forgot password?"}</Link>
              </p>
            ) : null}

            <label>
              <span>{isZh ? "界面语言" : "Interface language"}</span>
              <div className="magic-auth-select">
                <Languages size={15} />
                <select
                  value={locale}
                  onChange={(event) => setLocale(event.target.value as "zh" | "en")}
                >
                  <option value="zh">中文</option>
                  <option value="en">English</option>
                </select>
              </div>
            </label>

            {error ? <p className="magic-form-notice is-error">{error}</p> : null}
            {message ? <p className="magic-form-notice is-success">{message}</p> : null}

            <button type="submit" className="magic-auth-submit" disabled={loading}>
              <span>
                {loading
                  ? isZh
                    ? "连接中…"
                    : "Connecting…"
                  : mode === "login"
                    ? isZh
                      ? "进入工作台"
                      : "Enter workspace"
                    : isZh
                      ? "创建账号"
                      : "Create account"}
              </span>
              <ArrowRight size={17} />
            </button>
          </form>

          <p className="magic-auth-terms">
            {isZh ? "继续即表示你同意在学习与创作场景中负责任地使用 AI。" : "Continue to use AI responsibly for learning and creation."}
          </p>
        </div>
      </section>
    </div>
  );
}
