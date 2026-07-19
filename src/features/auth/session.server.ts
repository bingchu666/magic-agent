import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { Locale, UserRole } from "@/lib/domain/types";
import { SessionPayload, SessionUser } from "@/features/auth/session.types";
import { nowIso } from "@/lib/domain/utils";

const COOKIE_NAME = "magic_session";

function encode(payload: SessionPayload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decode(value: string): SessionPayload | null {
  try {
    const raw = Buffer.from(value, "base64url").toString("utf8");
    const parsed = JSON.parse(raw) as SessionPayload;
    if (!parsed?.user?.id || !parsed.user.role || !parsed.user.locale) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function readSession(): SessionUser | null {
  const store = cookies();
  const value = store.get(COOKIE_NAME)?.value;
  if (!value) return null;
  const payload = decode(value);
  return payload?.user ?? null;
}

export function readSessionFromRequest(req: Request): SessionUser | null {
  const cookieHeader = req.headers.get("cookie") || "";
  const all = cookieHeader.split(";").map((part) => part.trim());
  const match = all.find((part) => part.startsWith(`${COOKIE_NAME}=`));
  if (!match) return null;
  const value = match.slice(COOKIE_NAME.length + 1);
  return decode(value)?.user ?? null;
}

export function setSessionResponse(user: {
  id: string;
  name: string;
  role: UserRole;
  locale: Locale;
}) {
  const payload: SessionPayload = {
    user,
    issuedAt: nowIso(),
  };

  const res = NextResponse.json({ ok: true, user });
  res.cookies.set(COOKIE_NAME, encode(payload), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}

export function clearSessionResponse() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, "", {
    path: "/",
    maxAge: 0,
  });
  return res;
}

export function assertSession(req: Request): SessionUser {
  const session = readSessionFromRequest(req);
  if (!session) {
    throw new Error("UNAUTHORIZED");
  }
  return session;
}

export function assertAdmin(req: Request): SessionUser {
  const session = assertSession(req);
  if (session.role !== "admin") {
    throw new Error("FORBIDDEN");
  }
  return session;
}
