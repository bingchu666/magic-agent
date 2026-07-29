import { Locale, UserRole } from "@/lib/domain/types";
import type { User } from "@supabase/supabase-js";

export type SessionUser = {
  id: string;
  name: string;
  email?: string;
  role: UserRole;
  locale: Locale;
};

export type SessionPayload = {
  user: SessionUser;
  issuedAt: string;
};

export type SessionProfile = Partial<Pick<SessionUser, "name" | "role" | "locale">> | null;

/**
 * Convert a Supabase user and its trusted profile into the app session shape.
 * Authorization never trusts user_metadata because users can edit it themselves.
 */
export function supabaseUserToSessionUser(user: User, profile?: SessionProfile): SessionUser {
  const meta = user.user_metadata ?? {};
  return {
    id: user.id,
    email: user.email,
    name: typeof profile?.name === "string"
      ? profile.name
      : typeof meta.name === "string"
        ? meta.name
        : (user.email?.split("@")[0] ?? "User"),
    role: profile?.role === "admin" ? "admin" : "user",
    locale: profile?.locale === "en" ? "en" : meta.locale === "en" ? "en" : "zh",
  };
}
