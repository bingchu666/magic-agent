"use client";

import {
  ArrowRight,
  BookOpen,
  Check,
  Clock3,
  FileText,
  Gauge,
  Globe2,
  HelpCircle,
  Keyboard,
  Languages,
  Loader2,
  LogOut,
  MessageSquareText,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useSession } from "@/features/auth/session.client";
import { useOnboarding } from "@/features/onboarding/OnboardingProvider";

export type ControlCenterMode = "settings" | "account";
type SettingsSection = "language" | "model" | "shortcuts" | "privacy";
type AccountSection = "profile" | "usage" | "personalization" | "session";

type Props = {
  mode: ControlCenterMode;
  cardCount: number;
  fileCount: number;
  onModeChange: (mode: ControlCenterMode) => void;
  onClose: () => void;
};

const settingsNav: Array<{
  id: SettingsSection;
  labelZh: string;
  labelEn: string;
  icon: typeof Globe2;
}> = [
  { id: "language", labelZh: "语言", labelEn: "Language", icon: Languages },
  { id: "model", labelZh: "模型与回答", labelEn: "Model & responses", icon: SlidersHorizontal },
  { id: "shortcuts", labelZh: "快捷键", labelEn: "Shortcuts", icon: Keyboard },
  { id: "privacy", labelZh: "数据与隐私", labelEn: "Data & privacy", icon: ShieldCheck },
];

const accountNav: Array<{
  id: AccountSection;
  labelZh: string;
  labelEn: string;
  icon: typeof UserRound;
}> = [
  { id: "profile", labelZh: "个人资料", labelEn: "Profile info", icon: UserRound },
  { id: "usage", labelZh: "使用情况", labelEn: "Usage", icon: Gauge },
  { id: "personalization", labelZh: "个性化", labelEn: "Personalization", icon: Sparkles },
  { id: "session", labelZh: "账户操作", labelEn: "Account actions", icon: LogOut },
];

export function KnowledgeControlCenter({
  mode,
  cardCount,
  fileCount,
  onModeChange,
  onClose,
}: Props) {
  const { user, setLocale, signOut } = useSession();
  const { ready: onboardingReady, openManually: openOnboarding } = useOnboarding();
  const router = useRouter();
  const locale = user?.locale ?? "zh";
  const zh = locale === "zh";
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("language");
  const [accountSection, setAccountSection] = useState<AccountSection>("profile");
  const [savingLocale, setSavingLocale] = useState(false);
  const [deleteState, setDeleteState] = useState<"idle" | "confirm" | "loading">("idle");
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  useEffect(() => {
    setActionError("");
    setDeleteState("idle");
  }, [mode]);

  const chooseLocale = async (nextLocale: "zh" | "en") => {
    if (nextLocale === locale || savingLocale) return;
    setSavingLocale(true);
    await setLocale(nextLocale);
    setSavingLocale(false);
  };

  const handleSignOut = async () => {
    setActionError("");
    try {
      await signOut();
      router.replace("/auth");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Sign out failed");
    }
  };

  const handleDeleteAccount = async () => {
    setDeleteState("loading");
    setActionError("");
    try {
      const response = await fetch("/api/auth/delete-account", { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Delete account failed");
      await signOut();
      router.replace("/auth");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Delete account failed");
      setDeleteState("idle");
    }
  };

  const activeSettingsNav = settingsNav.find((item) => item.id === settingsSection);
  const activeAccountNav = accountNav.find((item) => item.id === accountSection);

  return (
    <div
      className="knowledge-control-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="knowledge-control-center"
        role="dialog"
        aria-modal="true"
        aria-label={mode === "settings" ? (zh ? "设置" : "Settings") : zh ? "账户" : "Account"}
      >
        <aside className="knowledge-control-sidebar">
          <header>
            <span>
              {mode === "settings" ? <Settings size={20} /> : <UserRound size={20} />}
            </span>
            <div>
              <small>MAGIC AGENT</small>
              <h2>{mode === "settings" ? (zh ? "设置" : "Settings") : zh ? "账户" : "Account"}</h2>
            </div>
          </header>

          <div className="knowledge-control-switcher">
            <button
              type="button"
              className={mode === "settings" ? "is-active" : ""}
              onClick={() => onModeChange("settings")}
            >
              <Settings size={15} />
              {zh ? "设置" : "Settings"}
            </button>
            <button
              type="button"
              className={mode === "account" ? "is-active" : ""}
              onClick={() => onModeChange("account")}
            >
              <UserRound size={15} />
              {zh ? "账户" : "Account"}
            </button>
          </div>

          <nav>
            {(mode === "settings" ? settingsNav : accountNav).map((item) => {
              const Icon = item.icon;
              const selected =
                mode === "settings"
                  ? settingsSection === item.id
                  : accountSection === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={selected ? "is-active" : ""}
                  onClick={() => {
                    if (mode === "settings") {
                      setSettingsSection(item.id as SettingsSection);
                    } else {
                      setAccountSection(item.id as AccountSection);
                    }
                  }}
                >
                  <Icon size={16} />
                  {zh ? item.labelZh : item.labelEn}
                </button>
              );
            })}
          </nav>

          <div className="knowledge-control-user">
            <span>{(user?.name || "M").slice(0, 1).toUpperCase()}</span>
            <div>
              <strong>{user?.name || (zh ? "账户" : "Account")}</strong>
              <small>{user?.role || "user"}</small>
            </div>
          </div>
        </aside>

        <main className="knowledge-control-content">
          <header>
            <div>
              <small>{mode === "settings" ? (zh ? "工作区偏好" : "Workspace preferences") : zh ? "个人中心" : "Personal center"}</small>
              <h1>
                {mode === "settings"
                  ? zh
                    ? activeSettingsNav?.labelZh
                    : activeSettingsNav?.labelEn
                  : zh
                    ? activeAccountNav?.labelZh
                    : activeAccountNav?.labelEn}
              </h1>
            </div>
            <button type="button" onClick={onClose} aria-label={zh ? "关闭" : "Close"}>
              <X size={18} />
            </button>
          </header>

          <div className="knowledge-control-scroll">
            {mode === "settings" && settingsSection === "language" ? (
              <section className="knowledge-control-section">
                <div className="knowledge-control-section-heading">
                  <span>
                    <Globe2 size={20} />
                  </span>
                  <div>
                    <h2>{zh ? "界面与回答语言" : "Interface & response language"}</h2>
                    <p>
                      {zh
                        ? "选择后立即更新 Card Chat 界面，并作为 AI 默认回答语言。"
                        : "Updates Card Chat immediately and becomes the preferred AI response language."}
                    </p>
                  </div>
                </div>
                <div className="knowledge-control-language-grid">
                  {[
                    { id: "zh" as const, badge: "中", title: "中文", detail: "Chinese" },
                    { id: "en" as const, badge: "EN", title: "English", detail: "English" },
                  ].map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={locale === option.id ? "is-active" : ""}
                      onClick={() => void chooseLocale(option.id)}
                      disabled={savingLocale}
                    >
                      <span>{option.badge}</span>
                      <div>
                        <strong>{option.title}</strong>
                        <small>{option.detail}</small>
                      </div>
                      {locale === option.id ? (
                        <Check size={17} />
                      ) : savingLocale ? (
                        <Loader2 className="animate-spin" size={17} />
                      ) : null}
                    </button>
                  ))}
                </div>
                <div className="knowledge-control-info">
                  <HelpCircle size={16} />
                  <p>
                    {zh
                      ? "已有对话内容不会被自动翻译；新的界面文本和 AI 回答会使用新语言。"
                      : "Existing conversation content is not auto-translated; new UI text and AI replies use the selected language."}
                  </p>
                </div>
              </section>
            ) : null}

            {mode === "settings" && settingsSection === "model" ? (
              <section className="knowledge-control-section">
                <div className="knowledge-control-section-heading">
                  <span>
                    <MessageSquareText size={20} />
                  </span>
                  <div>
                    <h2>{zh ? "当前回答模型" : "Current response model"}</h2>
                    <p>{zh ? "Card Chat 会自动组合卡片历史、上传文件与知识库。" : "Card Chat combines card history, uploads, and the knowledge base automatically."}</p>
                  </div>
                </div>
                <div className="knowledge-control-model-card is-active">
                  <div>
                    <Sparkles size={18} />
                  </div>
                  <span>
                    <strong>Deep reasoning</strong>
                    <small>{zh ? "内置模型 · 支持文件上下文与知识卡片" : "Built-in · File context and knowledge cards"}</small>
                  </span>
                  <i>{zh ? "使用中" : "Active"}</i>
                </div>
              </section>
            ) : null}

            {mode === "settings" && settingsSection === "shortcuts" ? (
              <section className="knowledge-control-section">
                <div className="knowledge-control-section-heading">
                  <span>
                    <Keyboard size={20} />
                  </span>
                  <div>
                    <h2>{zh ? "Card Chat 快捷键" : "Card Chat shortcuts"}</h2>
                    <p>{zh ? "在卡片之间更快地提问与导航。" : "Ask and navigate between cards faster."}</p>
                  </div>
                </div>
                <div className="knowledge-control-shortcuts">
                  <div><span>{zh ? "发送问题" : "Send question"}</span><kbd>Enter</kbd></div>
                  <div><span>{zh ? "关闭弹窗" : "Close dialog"}</span><kbd>Esc</kbd></div>
                  <div><span>{zh ? "添加文件" : "Add files"}</span><kbd>+</kbd></div>
                </div>
              </section>
            ) : null}

            {mode === "settings" && settingsSection === "privacy" ? (
              <section className="knowledge-control-section">
                <div className="knowledge-control-section-heading">
                  <span>
                    <ShieldCheck size={20} />
                  </span>
                  <div>
                    <h2>{zh ? "数据与隐私" : "Data & privacy"}</h2>
                    <p>{zh ? "账户数据由登录身份隔离，上传内容保存在私有文件空间。" : "Account data is isolated by identity and uploads are stored privately."}</p>
                  </div>
                </div>
                <div className="knowledge-control-privacy-list">
                  <div><ShieldCheck size={17} /><span><strong>{zh ? "私有文件" : "Private files"}</strong><small>{zh ? "仅当前账户可访问" : "Only this account can access them"}</small></span></div>
                  <div><Clock3 size={17} /><span><strong>{zh ? "自动到期" : "Automatic expiry"}</strong><small>{zh ? "上传文件默认保留 30 天" : "Uploads are retained for 30 days by default"}</small></span></div>
                </div>
              </section>
            ) : null}

            {mode === "account" && accountSection === "profile" ? (
              <section className="knowledge-control-section knowledge-control-profile">
                <div className="knowledge-control-profile-avatar">
                  {(user?.name || "M").slice(0, 1).toUpperCase()}
                  <span>{user?.role || "user"}</span>
                </div>
                <h2>{user?.name || (zh ? "未命名账户" : "Unnamed account")}</h2>
                <p>{user?.email || `${zh ? "账户 ID" : "Account ID"} · ${user?.id.slice(0, 12) || "—"}`}</p>
                <div className="knowledge-control-plan">
                  <span>{zh ? "当前方案" : "Current plan"}</span>
                  <strong>Free</strong>
                </div>
              </section>
            ) : null}

            {mode === "account" && accountSection === "usage" ? (
              <section className="knowledge-control-section">
                <div className="knowledge-control-section-heading">
                  <span><Gauge size={20} /></span>
                  <div>
                    <h2>{zh ? "当前工作区" : "Current workspace"}</h2>
                    <p>{zh ? "本设备中保存的卡片与账户文件概览。" : "Overview of cards on this device and files in your account."}</p>
                  </div>
                </div>
                <div className="knowledge-control-usage-grid">
                  <div><BookOpen size={20} /><strong>{cardCount}</strong><span>{zh ? "知识卡片" : "Knowledge cards"}</span></div>
                  <div><FileText size={20} /><strong>{fileCount}</strong><span>{zh ? "账户文件" : "Account files"}</span></div>
                </div>
              </section>
            ) : null}

            {mode === "account" && accountSection === "personalization" ? (
              <section className="knowledge-control-section">
                <div className="knowledge-control-section-heading">
                  <span><Sparkles size={20} /></span>
                  <div>
                    <h2>{zh ? "学习偏好" : "Learning preferences"}</h2>
                    <p>{zh ? "更新你的魔术方向、经验和目标，让回答更贴近你。" : "Update your magic interests, experience, and goals for more relevant answers."}</p>
                  </div>
                </div>
                <button
                  type="button"
                  className="knowledge-control-primary-action"
                  disabled={!onboardingReady}
                  onClick={() => {
                    onClose();
                    openOnboarding();
                  }}
                >
                  {zh ? "打开个性化问卷" : "Open personalization survey"}
                  <ArrowRight size={16} />
                </button>
              </section>
            ) : null}

            {mode === "account" && accountSection === "session" ? (
              <section className="knowledge-control-section">
                <div className="knowledge-control-action-card">
                  <span><LogOut size={19} /></span>
                  <div>
                    <h2>{zh ? "退出当前设备" : "Sign out on this device"}</h2>
                    <p>{zh ? "云端卡片与文件不会被删除。" : "Your cloud cards and files will remain intact."}</p>
                  </div>
                  <button type="button" onClick={() => void handleSignOut()}>
                    {zh ? "退出登录" : "Sign out"}
                  </button>
                </div>
                <div className="knowledge-control-action-card is-danger">
                  <span><Trash2 size={19} /></span>
                  <div>
                    <h2>{zh ? "永久注销账户" : "Permanently delete account"}</h2>
                    <p>{zh ? "删除账户、对话、资料和个人数据，无法撤销。" : "Deletes your account, conversations, files, and personal data. This cannot be undone."}</p>
                  </div>
                  {deleteState === "confirm" ? (
                    <div className="knowledge-control-confirm">
                      <button type="button" onClick={() => void handleDeleteAccount()}>
                        {zh ? "确认删除" : "Confirm"}
                      </button>
                      <button type="button" onClick={() => setDeleteState("idle")}>
                        {zh ? "取消" : "Cancel"}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={deleteState === "loading"}
                      onClick={() => setDeleteState("confirm")}
                    >
                      {deleteState === "loading" ? <Loader2 className="animate-spin" size={15} /> : zh ? "注销账户" : "Delete account"}
                    </button>
                  )}
                </div>
                {actionError ? <p className="knowledge-control-error">{actionError}</p> : null}
              </section>
            ) : null}
          </div>
        </main>
      </section>
    </div>
  );
}
