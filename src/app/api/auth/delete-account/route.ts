import { assertSession } from "@/features/auth/session.server";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("Account deletion is not configured");
  }
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function POST(req: Request) {
  try {
    const session = await assertSession(req);
    const userId = session.id;
    const adminClient = getAdminClient();

    const { data: threads } = await adminClient
      .from("threads")
      .select("id")
      .eq("user_id", userId)
      .throwOnError();
    const threadIds = (threads ?? []).map((thread) => thread.id);

    const { data: files } = await adminClient
      .from("file_assets")
      .select("id, storage_key")
      .eq("user_id", userId)
      .throwOnError();
    const storageKeys = (files ?? [])
      .map((file) => file.storage_key)
      .filter((key): key is string => typeof key === "string" && key.length > 0);

    const { data: videos } = await adminClient
      .from("video_assets")
      .select("id")
      .eq("created_by", userId)
      .throwOnError();
    const videoIds = (videos ?? []).map((video) => video.id);

    if (storageKeys.length > 0) {
      const { error } = await adminClient.storage.from("file-uploads").remove(storageKeys);
      if (error) throw error;
    }

    // Delete all user-owned data first (RESTRICT prevents cascading)
    if (threadIds.length > 0) {
      await adminClient.from("thread_learning_state").delete().in("thread_id", threadIds).throwOnError();
      await adminClient.from("messages").delete().in("thread_id", threadIds).throwOnError();
    }
    if (videoIds.length > 0) {
      await adminClient.from("video_tags").delete().in("video_id", videoIds).throwOnError();
      await adminClient.from("video_embeddings").delete().in("video_id", videoIds).throwOnError();
      await adminClient.from("video_assets").delete().in("id", videoIds).throwOnError();
    }
    await adminClient.from("events").delete().eq("user_id", userId).throwOnError();
    await adminClient.from("audit_logs").delete().eq("user_id", userId).throwOnError();
    await adminClient.from("file_insights").delete().eq("user_id", userId).throwOnError();
    await adminClient.from("file_jobs").delete().eq("user_id", userId).throwOnError();
    await adminClient.from("file_assets").delete().eq("user_id", userId).throwOnError();
    await adminClient.from("messages").delete().eq("user_id", userId).throwOnError();
    await adminClient.from("threads").delete().eq("user_id", userId).throwOnError();
    await adminClient.from("profiles").delete().eq("id", userId).throwOnError();

    // Delete the auth user
    const { error: authError } = await adminClient.auth.admin.deleteUser(userId);
    if (authError) throw authError;

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete account";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
