"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import clsx from "clsx";
import { useSession } from "@/features/auth/session.client";
import { t } from "@/lib/ui/i18n";

const userNav = [
  { href: "/chat", key: "chat" as const },
  { href: "/files", key: "files" as const },
  { href: "/settings", key: "settings" as const },
];

const adminNav = [
  { href: "/admin/videos", key: "adminVideos" as const },
  { href: "/admin/moderation", key: "adminModeration" as const },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, setLocale } = useSession();
  const isChatPage = pathname === "/chat" || pathname.startsWith("/chat/");

  const copy = t(user?.locale ?? "zh");

  const navItems = useMemo(() => {
    if (!user) return userNav;
    return user.role === "admin" ? [...userNav, ...adminNav] : userNav;
  }, [user]);

  return (
    <div
      className={clsx(
        "bg-[radial-gradient(circle_at_20%_20%,#fecdd3,transparent_36%),radial-gradient(circle_at_90%_0%,#bae6fd,transparent_34%),linear-gradient(180deg,#f8fafc_0%,#f1f5f9_100%)] text-zinc-900",
        isChatPage ? "h-screen overflow-hidden" : "min-h-screen"
      )}
    >
      <header className="sticky top-0 z-40 border-b border-black/10 bg-white/70 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-[1520px] items-center justify-between gap-4 px-4 py-3 md:px-6">
          <div>
            <div className="text-sm uppercase tracking-[0.2em] text-zinc-500">Magic Agent</div>
            <div className="text-2xl font-semibold tracking-tight text-zinc-900">{copy.appTagline}</div>
          </div>
          <button
            type="button"
            onClick={() => setLocale(user?.locale === "zh" ? "en" : "zh")}
            className="rounded-full border border-black/10 bg-white px-3 py-1.5 text-sm font-semibold uppercase tracking-wide hover:bg-zinc-50"
          >
            {user?.locale === "zh" ? "EN" : "中文"}
          </button>
        </div>
      </header>

      <div
        className={clsx(
          "mx-auto grid w-full max-w-[1520px] grid-cols-1 gap-4 px-4 md:px-6",
          isChatPage
            ? "h-[calc(100vh-86px)] overflow-hidden py-4"
            : "py-4 md:grid-cols-[240px_minmax(0,1fr)]"
        )}
      >
        {!isChatPage ? (
          <aside className="sticky top-[86px] h-[calc(100vh-102px)] overflow-y-auto rounded-3xl border border-black/10 bg-white/85 p-3 backdrop-blur">
            <div className="mb-3 px-3 py-2">
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Signed in</p>
              <p className="text-sm font-semibold">{user?.name ?? "Guest"}</p>
              <p className="text-xs text-zinc-500">{user?.role ?? "user"}</p>
            </div>
            <nav className="space-y-1">
              {navItems.map((item) => {
                const label = copy[item.key] ?? item.key;
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={clsx(
                      "block rounded-2xl px-3 py-2 text-sm font-medium transition",
                      active ? "bg-black text-white" : "text-zinc-700 hover:bg-zinc-100"
                    )}
                  >
                    {label}
                  </Link>
                );
              })}
            </nav>
          </aside>
        ) : null}
        <main className={clsx("min-w-0", isChatPage ? "h-full overflow-hidden" : "")}>{children}</main>
      </div>
    </div>
  );
}
