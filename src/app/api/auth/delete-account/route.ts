import { assertSession } from "@/features/auth/session.server";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export async function POST(req: Request) {
  try {
    const session = await assertSession(req);
    const userId = session.id;

    // Delete all user-owned data first (RESTRICT prevents cascading)
    await adminClient.from("events").delete().eq("user_id", userId);
    await adminClient.from("audit_logs").delete().eq("user_id", userId);
    await adminClient.from("file_insights").delete().eq("user_id", userId);
    await adminClient.from("file_jobs").delete().eq("user_id", userId);
    await adminClient.from("file_assets").delete().eq("user_id", userId);
    await adminClient.from("messages").delete().eq("user_id", userId);
    await adminClient.from("threads").delete().eq("user_id", userId);
    await adminClient.from("profiles").delete().eq("id", userId);

    // Delete the auth user
    await adminClient.auth.admin.deleteUser(userId);

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete account";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
