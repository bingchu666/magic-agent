"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const LOCALE_STORAGE_KEY = "magic_locale_v1";

export function AuthScreen() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [locale, setLocale] = useState<"zh" | "en">("zh");
  const [role, setRole] = useState<"user" | "admin">("user");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/demo-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || "Magic User",
          locale,
          role,
        }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error || "Login failed");
      }

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

  return (
    <div className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_20%_20%,#fecdd3,transparent_35%),radial-gradient(circle_at_90%_0%,#a5f3fc,transparent_35%),linear-gradient(180deg,#f8fafc_0%,#e2e8f0_100%)] p-4">
      <div className="w-full max-w-lg rounded-[28px] border border-black/10 bg-white/90 p-8 shadow-2xl shadow-zinc-300/40 backdrop-blur">
        <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Magic Agent V1</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900">
          {locale === "zh" ? "登录并开始你的魔术工作台" : "Sign in to your magic workspace"}
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          {locale === "zh"
            ? "当前为内测登录模式，可选择 User/Admin 角色。"
            : "Preview login mode with User/Admin role selection."}
        </p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              {locale === "zh" ? "昵称" : "Display Name"}
            </label>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={locale === "zh" ? "例如：Bingchu" : "e.g. Bingchu"}
              className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                {locale === "zh" ? "语言" : "Locale"}
              </label>
              <select
                value={locale}
                onChange={(event) => setLocale(event.target.value as "zh" | "en")}
                className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm"
              >
                <option value="zh">中文</option>
                <option value="en">English</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Role</label>
              <select
                value={role}
                onChange={(event) => setRole(event.target.value as "user" | "admin")}
                className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm"
              >
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>

          {error ? <p className="text-xs text-rose-600">{error}</p> : null}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-black px-4 py-3 text-sm font-semibold uppercase tracking-wide text-white disabled:opacity-40"
          >
            {loading ? "..." : locale === "zh" ? "进入 Magic Agent" : "Enter Magic Agent"}
          </button>
        </form>
      </div>
    </div>
  );
}
