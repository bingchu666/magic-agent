import { NextResponse } from "next/server";
import { Locale, UserRole } from "@/lib/domain/types";
import { setSessionResponse } from "@/features/auth/session.server";
import { memoryDb } from "@/lib/data/memory-db";

function sanitizeRole(input: unknown): UserRole {
  if (input === "admin") return "admin";
  return "user";
}

function sanitizeLocale(input: unknown): Locale {
  if (input === "en") return "en";
  return "zh";
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      name?: string;
      locale?: Locale;
      role?: UserRole;
    };

    const name = typeof body?.name === "string" ? body.name.trim() : "Magic User";
    const locale = sanitizeLocale(body?.locale);
    const role = sanitizeRole(body?.role);

    const userId = `u_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_") || "magic"}`;

    const user = await memoryDb.ensureUser({
      id: userId,
      name,
      role,
      locale,
    });

    await memoryDb.createEvent({
      userId: user.id,
      name: "auth_login",
      payload: {
        role: user.role,
      },
    });

    return setSessionResponse({
      id: user.id,
      name: user.name,
      role: user.role,
      locale: user.locale,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
