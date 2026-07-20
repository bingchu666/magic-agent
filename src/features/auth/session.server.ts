import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { SessionUser, supabaseUserToSessionUser } from "@/features/auth/session.types";

function getServerSupabase() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(_name: string, _value: string, _options: Record<string, unknown>) {},
        remove(_name: string, _options: Record<string, unknown>) {},
      },
    }
  );
}

export async function readSession(): Promise<SessionUser | null> {
  const supabase = getServerSupabase();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  return supabaseUserToSessionUser(data.user);
}

/**
 * Read session from an incoming API Request.
 * For API routes, delegates to readSession() which reads cookies via next/headers —
 * this works because API routes share the same request context as middleware.
 */
export async function readSessionFromRequest(_req: Request): Promise<SessionUser | null> {
  return readSession();
}

export async function assertSession(req: Request): Promise<SessionUser> {
  const session = await readSessionFromRequest(req);
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

export async function assertAdmin(req: Request): Promise<SessionUser> {
  const session = await assertSession(req);
  if (session.role !== "admin") throw new Error("FORBIDDEN");
  return session;
}
