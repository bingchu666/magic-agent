import { Locale, UserRole } from "@/lib/domain/types";
import type { User } from "@supabase/supabase-js";

export type SessionUser = {
  id: string;
  name: string;
  role: UserRole;
  locale: Locale;
};

export type SessionPayload = {
  user: SessionUser;
  issuedAt: string;
};

/** Convert a Supabase User into the app's SessionUser shape */
export function supabaseUserToSessionUser(user: User): SessionUser {
  const meta = user.user_metadata ?? {};
  return {
    id: user.id,
    name: typeof meta.name === "string" ? meta.name : (user.email?.split("@")[0] ?? "User"),
    role: meta.role === "admin" ? "admin" : "user",
    locale: meta.locale === "en" ? "en" : "zh",
  };
}
