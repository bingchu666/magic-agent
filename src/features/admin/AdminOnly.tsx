"use client";

import { useSession } from "@/features/auth/session.client";

export function AdminOnly({ children }: { children: React.ReactNode }) {
  const { user } = useSession();
  const locale = user?.locale ?? "zh";

  if (user?.role !== "admin") {
    return (
      <div className="rounded-3xl border border-black/10 bg-white/85 p-6 text-sm text-zinc-700 shadow-sm backdrop-blur">
        {locale === "zh"
          ? "你当前不是 Admin 角色，无法访问该页面。"
          : "You are not an admin, so this page is unavailable."}
      </div>
    );
  }

  return <>{children}</>;
}
