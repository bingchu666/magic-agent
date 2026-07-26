"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Globe2,
  LogOut,
  ShieldAlert,
  Sparkles,
  UserRound,
} from "lucide-react";
import { useSession } from "@/features/auth/session.client";
import { t } from "@/lib/ui/i18n";

export function SettingsWorkspace() {
  const { user, setLocale, signOut } = useSession();
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
    <div className="magic-page magic-settings-page">
      <header className="magic-page-hero">
        <div>
          <span>
            <Sparkles size={14} />
            Personal workspace
          </span>
          <h1>{locale === "zh" ? "让工作台更像你" : "Make the workspace yours"}</h1>
          <p>
            {locale === "zh"
              ? "管理语言、身份和账户边界。你的知识地图与资料不会受视觉偏好影响。"
              : "Manage language, identity, and account boundaries without affecting your knowledge maps."}
          </p>
        </div>
        <div className="magic-page-stat">
          <strong>{locale === "zh" ? "中文" : "EN"}</strong>
          <span>{copy.localeLabel}</span>
        </div>
        <div className="magic-page-stat">
          <strong>{user?.role ?? "user"}</strong>
          <span>{locale === "zh" ? "账户角色" : "account role"}</span>
        </div>
      </header>

      <div className="magic-settings-grid">
        <section className="magic-settings-card magic-settings-profile">
          <header>
            <span>
              <UserRound size={18} />
            </span>
            <div>
              <small>{locale === "zh" ? "Identity" : "Identity"}</small>
              <h2>{locale === "zh" ? "账户信息" : "Account profile"}</h2>
            </div>
          </header>
          <div className="magic-account-profile">
            <div>{(user?.name ?? "G").slice(0, 1).toUpperCase()}</div>
            <span>
              <strong>{user?.name ?? "Guest"}</strong>
              <small>{user?.role ?? "user"} · {user?.id ? (locale === "zh" ? "邮箱已绑定" : "Email connected") : "—"}</small>
            </span>
          </div>
          <p>
            {locale === "zh"
              ? "身份信息用于跨设备同步对话、资料与知识锚点。"
              : "Your identity keeps conversations, sources, and anchors connected across sessions."}
          </p>
        </section>

        <section className="magic-settings-card">
          <header>
            <span>
              <Globe2 size={18} />
            </span>
            <div>
              <small>Language</small>
              <h2>{copy.localeLabel}</h2>
            </div>
          </header>
          <p>
            {locale === "zh"
              ? "界面和 AI 默认回答将优先使用所选语言。"
              : "The interface and AI replies will prefer your selected language."}
          </p>
          <div className="magic-language-options">
            <button
              type="button"
              onClick={() => setLocale("zh")}
              className={locale === "zh" ? "is-active" : ""}
            >
              <span>中</span>
              <div>
                <strong>中文</strong>
                <small>Chinese</small>
              </div>
              {locale === "zh" ? <i /> : null}
            </button>
            <button
              type="button"
              onClick={() => setLocale("en")}
              className={locale === "en" ? "is-active" : ""}
            >
              <span>EN</span>
              <div>
                <strong>English</strong>
                <small>English</small>
              </div>
              {locale === "en" ? <i /> : null}
            </button>
          </div>
        </section>

        <section className="magic-settings-card">
          <header>
            <span>
              <LogOut size={18} />
            </span>
            <div>
              <small>Session</small>
              <h2>{locale === "zh" ? "结束本次会话" : "End this session"}</h2>
            </div>
          </header>
          <p>
            {locale === "zh"
              ? "本设备会退出登录，云端数据仍会安全保留。"
              : "This device will sign out while cloud data remains intact."}
          </p>
          <button
            type="button"
            className="magic-settings-action"
            onClick={() => signOut().then(() => router.replace("/auth"))}
          >
            {locale === "zh" ? "退出登录" : "Sign out"}
            <ArrowRight size={15} />
          </button>
        </section>

        <section className="magic-settings-card is-danger">
          <header>
            <span>
              <ShieldAlert size={18} />
            </span>
            <div>
              <small>Danger zone</small>
              <h2>{locale === "zh" ? "注销账号" : "Delete account"}</h2>
            </div>
          </header>
          <p>
            {locale === "zh"
              ? "永久删除账号、对话、资料和所有个人数据。此操作无法撤销。"
              : "Permanently delete your account, conversations, sources, and personal data."}
          </p>

          {deleteState === "loading" ? (
            <button type="button" className="magic-danger-action" disabled>
              {locale === "zh" ? "注销中…" : "Deleting…"}
            </button>
          ) : deleteState === "confirm" ? (
            <div className="magic-confirm-actions">
              <button type="button" className="magic-danger-action" onClick={handleDeleteAccount}>
                {locale === "zh" ? "确认永久删除" : "Confirm permanent delete"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setDeleteState("idle");
                  setDeleteError(null);
                }}
              >
                {locale === "zh" ? "取消" : "Cancel"}
              </button>
            </div>
          ) : (
            <button type="button" className="magic-settings-action" onClick={() => setDeleteState("confirm")}>
              {locale === "zh" ? "注销账号" : "Delete account"}
              <ArrowRight size={15} />
            </button>
          )}

          {deleteError ? <p className="magic-form-notice is-error">{deleteError}</p> : null}
        </section>
      </div>
    </div>
  );
}
