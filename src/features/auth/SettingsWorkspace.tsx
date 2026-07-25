"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/features/auth/session.client";
import { useOnboarding } from "@/features/onboarding/OnboardingProvider";
import { t } from "@/lib/ui/i18n";

export function SettingsWorkspace() {
  const { user, setLocale, signOut } = useSession();
  const { ready: onboardingReady, openManually: openOnboarding } = useOnboarding();
  const router = useRouter();
  const locale = user?.locale ?? "zh";
  const copy = t(locale);

  const [deleteState, setDeleteState] = useState<"idle" | "confirm" | "loading">("idle");
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDeleteAccount = async () => {
    setDeleteState("loading");
    setDeleteError(null);

    try {
      const res = await fetch("/api/auth/delete-account", { method: "POST" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error || "Failed to delete account");
      }
      await signOut();
      router.replace("/auth");
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Unknown error");
      setDeleteState("idle");
    }
  };

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
          {locale === "zh" ? "新手问卷" : "Onboarding Survey"}
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          {locale === "zh"
            ? "补充或修改你的魔术学习偏好，帮助我们更好地为你推荐内容。"
            : "Fill in or update your magic learning preferences to help us recommend better content."}
        </p>
        <button
          type="button"
          onClick={openOnboarding}
          disabled={!onboardingReady}
          className="mt-3 rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 transition disabled:opacity-40"
        >
          {locale === "zh" ? "打开问卷" : "Open survey"}
        </button>
      </div>

      <div className="rounded-3xl border border-black/10 bg-white/85 p-4 shadow-sm backdrop-blur">
        <p className="text-sm font-semibold text-zinc-900">
          {locale === "zh" ? "账户信息" : "Account"}
        </p>
        <p className="mt-1 text-sm text-zinc-700">
          {locale === "zh" ? "邮箱" : "Email"}: {user?.id ? "已绑定" : "—"}
        </p>
        <p className="text-sm text-zinc-700">
          {locale === "zh" ? "昵称" : "Name"}: {user?.name}
        </p>
        <p className="text-sm text-zinc-700">
          {locale === "zh" ? "角色" : "Role"}: {user?.role}
        </p>
      </div>

      {/* Sign Out */}
      <div className="rounded-3xl border border-black/10 bg-white/85 p-4 shadow-sm backdrop-blur">
        <p className="text-sm font-semibold text-zinc-900">
          {locale === "zh" ? "退出登录" : "Sign Out"}
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          {locale === "zh"
            ? "退出后需要重新登录才能访问。"
            : "You will need to sign in again to access the app."}
        </p>
        <button
          type="button"
          onClick={() => signOut().then(() => router.replace("/auth"))}
          className="mt-3 rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 transition"
        >
          {locale === "zh" ? "退出登录" : "Sign Out"}
        </button>
      </div>

      {/* Delete Account */}
      <div className="rounded-3xl border border-rose-200 bg-rose-50/60 p-4 shadow-sm backdrop-blur">
        <p className="text-sm font-semibold text-rose-800">
          {locale === "zh" ? "注销账号" : "Delete Account"}
        </p>
        <p className="mt-1 text-xs text-rose-600">
          {locale === "zh"
            ? "此操作不可撤销，将永久删除你的所有数据、对话和文件。"
            : "This action is irreversible. All your data, conversations, and files will be permanently deleted."}
        </p>

        {deleteState === "loading" ? (
          <button
            type="button"
            disabled
            className="mt-3 rounded-xl bg-rose-400 px-4 py-2 text-sm font-semibold text-white cursor-wait transition"
          >
            {locale === "zh" ? "注销中…" : "Deleting..."}
          </button>
        ) : deleteState === "confirm" ? (
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={handleDeleteAccount}
              className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 transition"
            >
              {locale === "zh" ? "确认注销" : "Confirm Delete"}
            </button>
            <button
              type="button"
              onClick={() => { setDeleteState("idle"); setDeleteError(null); }}
              className="rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 transition"
            >
              {locale === "zh" ? "取消" : "Cancel"}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setDeleteState("confirm")}
            className="mt-3 rounded-xl border border-rose-300 bg-white px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100 transition"
          >
            {locale === "zh" ? "注销账号" : "Delete Account"}
          </button>
        )}

        {deleteError && (
          <p className="mt-2 text-xs text-rose-700">{deleteError}</p>
        )}
      </div>
    </div>
  );
}
