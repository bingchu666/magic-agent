"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import clsx from "clsx";
import {
  BookOpenText,
  FileStack,
  Languages,
  MessageCircleMore,
  Network,
  ShieldCheck,
  Sparkles,
  Video,
} from "lucide-react";
import { useSession } from "@/features/auth/session.client";
import { t } from "@/lib/ui/i18n";

const userNav = [
  { href: "/chat", key: "chat" as const, icon: MessageCircleMore, hintZh: "线性对话与陪练", hintEn: "Chat & coaching" },
  { href: "/explore", key: "explore" as const, icon: Network, hintZh: "非线性知识地图", hintEn: "Knowledge maps" },
  { href: "/files", key: "files" as const, icon: FileStack, hintZh: "资料解析与洞察", hintEn: "Sources & insights" },
];

const adminNav = [
  { href: "/admin/videos", key: "adminVideos" as const, icon: Video, hintZh: "内容资源管理", hintEn: "Content library" },
  { href: "/admin/moderation", key: "adminModeration" as const, icon: ShieldCheck, hintZh: "安全与事件", hintEn: "Safety & events" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, setLocale } = useSession();
  const isChatPage = pathname === "/chat" || pathname.startsWith("/chat/");
  const isExplorePage = pathname === "/explore" || pathname.startsWith("/explore/");
  const isImmersivePage = isChatPage || isExplorePage;

  const copy = t(user?.locale ?? "zh");
  const isZh = user?.locale !== "en";
  const activeItem = [...userNav, ...adminNav].find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`)
  );

  const navItems = useMemo(() => {
    if (!user) return userNav;
    return user.role === "admin" ? [...userNav, ...adminNav] : userNav;
  }, [user]);

  return (
    <div className={clsx("magic-app-surface", isImmersivePage ? "h-screen overflow-hidden" : "min-h-screen")}>
      {!isExplorePage ? (
        <header className="magic-global-header">
          <div className="magic-header-brand">
            <div className="magic-brand-mark">
              <Sparkles size={17} />
            </div>
            <div>
              <span>Magic Agent</span>
              <strong>{activeItem ? copy[activeItem.key] : copy.appTagline}</strong>
            </div>
          </div>

          <div className="magic-header-context">
            <BookOpenText size={15} />
            <span>{isZh ? "把练习、资料和理解连接起来" : "Connect practice, sources, and understanding"}</span>
          </div>

          <div className="magic-header-actions">
            <div className="magic-system-status">
              <i />
              {isZh ? "系统在线" : "Online"}
            </div>
            <button
              type="button"
              onClick={() => setLocale(isZh ? "en" : "zh")}
              className="magic-language-button"
              aria-label={isZh ? "Switch to English" : "切换到中文"}
            >
              <Languages size={15} />
              {isZh ? "EN" : "中文"}
            </button>
          </div>
        </header>
      ) : null}

      <div
        className={clsx(
          "magic-app-layout",
          isExplorePage
            ? "h-screen max-w-none overflow-hidden p-0"
            : isChatPage
              ? "magic-chat-layout"
              : "magic-page-layout"
        )}
      >
        {!isImmersivePage ? (
          <aside className="magic-sidebar">
            <div className="magic-profile-card">
              <div className="magic-profile-avatar">{(user?.name ?? "G").slice(0, 1).toUpperCase()}</div>
              <div>
                <span>{isZh ? "探索者" : "Explorer"}</span>
                <strong>{user?.name ?? "Guest"}</strong>
                <small>{user?.role ?? "user"}</small>
              </div>
            </div>
            <nav className="magic-primary-nav">
              <p>{isZh ? "工作空间" : "Workspace"}</p>
              {navItems.map((item) => {
                const label = copy[item.key] ?? item.key;
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={clsx("magic-nav-item", active && "is-active")}
                  >
                    <span className="magic-nav-icon">
                      <Icon size={16} />
                    </span>
                    <span>
                      <strong>{label}</strong>
                      <small>{isZh ? item.hintZh : item.hintEn}</small>
                    </span>
                  </Link>
                );
              })}
            </nav>
            <Link href="/explore" className="magic-sidebar-cta">
              <Network size={18} />
              <span>
                <strong>{isZh ? "打开层级卡片" : "Open Magic Atlas"}</strong>
                <small>{isZh ? "把对话变成知识地图" : "Turn chat into a map"}</small>
              </span>
            </Link>
          </aside>
        ) : null}
        <main className={clsx("magic-main-content", isImmersivePage && "h-full overflow-hidden")}>
          {children}
        </main>
      </div>
    </div>
  );
}
