"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "@/features/auth/session.client";
import { DEFAULT_PRODUCT_PATH } from "@/lib/routes";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading } = useSession();

  // Any /auth/* route (sign in, forgot password, reset password, ...) is
  // public — mirrors the prefix check in middleware.ts.
  const isPublicPath = pathname === "/auth" || pathname.startsWith("/auth/");

  useEffect(() => {
    if (loading) return;

    // Not logged in + not on a public auth page → redirect to /auth
    if (!user && !isPublicPath) {
      router.replace("/auth");
      return;
    }

    // Logged in + on /auth or / → open the primary product workspace.
    if (user && (pathname === "/auth" || pathname === "/")) {
      router.replace(DEFAULT_PRODUCT_PATH);
    }
  }, [loading, user, pathname, isPublicPath, router]);

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_20%_20%,#ffedd5,transparent_42%),radial-gradient(circle_at_80%_0%,#dbeafe,transparent_35%),#f8fafc]">
        <div className="rounded-3xl border border-black/10 bg-white/80 px-8 py-5 text-sm font-semibold tracking-wide text-zinc-600 backdrop-blur">
          Loading Magic Agent...
        </div>
      </div>
    );
  }

  // Don't render children if not authenticated and not on a public auth page
  if (!user && !isPublicPath) return null;

  return <>{children}</>;
}
