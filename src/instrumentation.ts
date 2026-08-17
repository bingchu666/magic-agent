// Next.js server-startup hook (https://nextjs.org/docs/app/guides/instrumentation).
// Runs once per server instance, before the first request is handled.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Warm the in-process magic-terms cache so the first real chat message
  // doesn't pay the ~3.5s cold, paginated fetch (see supabase-db.ts,
  // listMagicTermsForScan). Fire-and-forget: a slow or failed warmup should
  // never delay server startup or crash it — listMagicTermsForScan() will
  // just fetch on demand (now with its own longer timeout) if this hasn't
  // landed yet by the time the first request needs it.
  const { supabaseDb } = await import("@/lib/data/supabase-db");
  supabaseDb.listMagicTermsForScan().catch((error) => {
    console.warn("Failed to warm magic terms cache at startup", {
      error: error instanceof Error ? error.message : String(error),
    });
  });

  // Same warmup for the magicians (Who's Who in Magic) scan cache — see
  // listMagiciansForScan in supabase-db.ts.
  supabaseDb.listMagiciansForScan().catch((error) => {
    console.warn("Failed to warm magicians cache at startup", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}
