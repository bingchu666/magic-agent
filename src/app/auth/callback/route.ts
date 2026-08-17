import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { DEFAULT_PRODUCT_PATH } from "@/lib/routes";

// Landing point for OAuth (Google, ...) sign-in: Supabase redirects the
// browser here with a `code` query param after the provider consent screen.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") || DEFAULT_PRODUCT_PATH;

  if (code) {
    const supabase = await getSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/auth?error=oauth_failed`);
}
