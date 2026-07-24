import { SessionUser, supabaseUserToSessionUser } from "@/features/auth/session.types";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function readSession(): Promise<SessionUser | null> {
  // getSupabaseServerClient persists any refreshed access/refresh token cookies via
  // cookieStore.set(...) — important now that API routes no longer go through
  // middleware.ts, which used to be what kept the auth cookie fresh for API requests.
  const supabase = await getSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("name, role, locale")
    .eq("id", data.user.id)
    .maybeSingle();
  if (error) throw new Error(`SESSION_PROFILE_ERROR: ${error.message}`);
  return supabaseUserToSessionUser(data.user, profile);
}

/**
 * Read session from an incoming API Request.
 * For API routes, delegates to readSession() which reads cookies via next/headers —
 * this works because API routes share the same request context as middleware.
 */
export async function readSessionFromRequest(req: Request): Promise<SessionUser | null> {
  void req;
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
