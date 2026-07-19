import { Locale, UserRole } from "@/lib/domain/types";

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
