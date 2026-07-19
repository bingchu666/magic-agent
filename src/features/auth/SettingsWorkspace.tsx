"use client";

import { useSession } from "@/features/auth/session.client";
import { t } from "@/lib/ui/i18n";

export function SettingsWorkspace() {
  const { user, setLocale } = useSession();
  const locale = user?.locale ?? "zh";
  const copy = t(locale);

  return (
    <div className="space-y-4">
      <div className="rounded-3xl border border-black/10 bg-white/85 p-4 shadow-sm backdrop-blur">
        <h1 className="text-xl font-semibold text-zinc-900">{copy.settings}</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {locale === "zh"
            ? "管理语言偏好、会话信息和账户状态。"
            : "Manage language preference, session info, and account state."}
        </p>
      </div>

      <div className="rounded-3xl border border-black/10 bg-white/85 p-4 shadow-sm backdrop-blur">
        <p className="text-sm font-semibold text-zinc-900">{copy.localeLabel}</p>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => setLocale("zh")}
            className={`rounded-full px-3 py-1 text-sm ${locale === "zh" ? "bg-black text-white" : "bg-zinc-100 text-zinc-700"}`}
          >
            中文
          </button>
          <button
            type="button"
            onClick={() => setLocale("en")}
            className={`rounded-full px-3 py-1 text-sm ${locale === "en" ? "bg-black text-white" : "bg-zinc-100 text-zinc-700"}`}
          >
            English
          </button>
        </div>
      </div>

      <div className="rounded-3xl border border-black/10 bg-white/85 p-4 shadow-sm backdrop-blur">
        <p className="text-sm font-semibold text-zinc-900">
          {locale === "zh" ? "账户信息" : "Account"}
        </p>
        <p className="mt-1 text-sm text-zinc-700">ID: {user?.id}</p>
        <p className="text-sm text-zinc-700">Name: {user?.name}</p>
        <p className="text-sm text-zinc-700">Role: {user?.role}</p>
      </div>
    </div>
  );
}
