/**
 * scripts/ingest-magicians.ts
 *
 * Reads content/whos_who_in_magic.json (an array of
 * { name, bio, years } objects, parsed from Bart Whaley's Who's Who in
 * Magic) and inserts them into Supabase (magicians + magician_chunks
 * tables).
 *
 * Mirrors scripts/ingest-terms.ts: batches many bios into a single Voyage
 * embedding request (Voyage's `input` field natively accepts an array of
 * strings), so there's no need for a long per-item delay. Skips names
 * already present in the database, and rolls back the `magicians` row for
 * any batch whose embedding or chunk-insert step fails, so a partial batch
 * never leaves a magician row with no matching chunk/embedding.
 *
 * RUN
 * ---
 * npx tsx scripts/ingest-magicians.ts              (normal run, writes to DB)
 * npx tsx scripts/ingest-magicians.ts --dry-run     (preview only, writes nothing)
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { embedTermTexts } from "../src/lib/ai/term-embedding";

const MAGICIANS_FILE = path.join(process.cwd(), "content", "whos_who_in_magic.json");
const DRY_RUN = process.argv.includes("--dry-run");

const BATCH_SIZE = 25;
const DELAY_BETWEEN_BATCHES_MS = 2_500;
const MAX_RETRIES = 4;
const SOURCE_LABEL = "Who's Who in Magic, Bart Whaley";

type MagicianEntry = {
  name: string;
  bio: string;
  years?: string | null;
};

type IngestDatabase = {
  public: {
    Tables: {
      magicians: {
        Row: { id: string; name: string };
        Insert: {
          name: string;
          bio: string;
          years?: string | null;
          source?: string | null;
        };
        Update: Record<string, unknown>;
        Relationships: [];
      };
      magician_chunks: {
        Row: { id: string; magician_id: string };
        Insert: { magician_id: string; content: string; embedding: number[] };
        Update: Record<string, unknown>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

let supabase: SupabaseClient<IngestDatabase> | null = null;

function getSupabaseAdminClient() {
  if (supabase) return supabase;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing Supabase credentials. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
    );
  }
  supabase = createClient<IngestDatabase>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return supabase;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

async function embedBatchWithRetry(texts: string[], batchLabel: string): Promise<number[][]> {
  let attempt = 0;
  while (true) {
    try {
      return await embedTermTexts(texts, "document");
    } catch (err) {
      const message = (err as Error).message ?? "";
      const isRateLimit = message.includes("429");
      attempt += 1;

      if (!isRateLimit || attempt > MAX_RETRIES) {
        throw err; // not a rate-limit error, or we've retried enough — give up
      }

      const backoffMs = 15_000 * attempt; // 15s, 30s, 45s, 60s
      console.log(
        `  … Rate limited while embedding batch ${batchLabel} (attempt ${attempt}/${MAX_RETRIES}). Waiting ${backoffMs / 1000}s before retrying.`
      );
      await sleep(backoffMs);
    }
  }
}

function loadMagicianEntries(): MagicianEntry[] {
  if (!fs.existsSync(MAGICIANS_FILE)) {
    throw new Error(`Magicians file not found: ${MAGICIANS_FILE}`);
  }
  const raw = fs.readFileSync(MAGICIANS_FILE, "utf-8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`Expected ${MAGICIANS_FILE} to contain a JSON array.`);
  }
  return parsed as MagicianEntry[];
}

/** Drop duplicate names within the source file itself, keeping the first occurrence. */
function dedupeWithinFile(entries: MagicianEntry[]): MagicianEntry[] {
  const seen = new Set<string>();
  const result: MagicianEntry[] = [];
  let skipped = 0;
  for (const entry of entries) {
    const key = entry.name.trim().toLowerCase();
    if (seen.has(key)) {
      skipped += 1;
      continue;
    }
    seen.add(key);
    result.push(entry);
  }
  if (skipped > 0) {
    console.log(`Skipped ${skipped} duplicate name(s) within the source file.`);
  }
  return result;
}

async function fetchExistingNames(db: SupabaseClient<IngestDatabase>): Promise<Set<string>> {
  const existing = new Set<string>();
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await db
      .from("magicians")
      .select("name")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`Failed to fetch existing magicians: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) existing.add(row.name.trim().toLowerCase());
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return existing;
}

async function ingestBatch(batch: MagicianEntry[], batchLabel: string) {
  const db = getSupabaseAdminClient();

  const { data: insertedMagicians, error: insertError } = await db
    .from("magicians")
    .insert(
      batch.map((entry) => ({
        name: entry.name,
        bio: entry.bio,
        years: entry.years ?? null,
        source: SOURCE_LABEL,
      }))
    )
    .select("id, name");

  if (insertError || !insertedMagicians) {
    console.error(`  ✗ Failed to insert batch ${batchLabel}:`, insertError?.message);
    return { inserted: 0, failed: batch.length };
  }

  // Names aren't guaranteed unique in the source (two different people can
  // share a printed name), so pair up by array position rather than by name.
  const idByPosition = insertedMagicians.map((row) => row.id);

  let embeddings: number[][];
  try {
    embeddings = await embedBatchWithRetry(
      batch.map((entry) => entry.bio),
      batchLabel
    );
  } catch (err) {
    console.error(
      `  ✗ Embedding failed for batch ${batchLabel}; rolling back ${batch.length} inserted magician(s):`,
      (err as Error).message
    );
    await db.from("magicians").delete().in("id", idByPosition);
    return { inserted: 0, failed: batch.length };
  }

  const chunkRows = batch.map((entry, i) => ({
    magician_id: idByPosition[i]!,
    content: entry.bio,
    embedding: embeddings[i],
  }));

  const { error: chunkError } = await db.from("magician_chunks").insert(chunkRows);

  if (chunkError) {
    console.error(
      `  ✗ Failed to save embeddings for batch ${batchLabel}; rolling back ${batch.length} inserted magician(s):`,
      chunkError.message
    );
    await db.from("magicians").delete().in("id", idByPosition);
    return { inserted: 0, failed: batch.length };
  }

  console.log(`  ✓ Ingested batch ${batchLabel} (${batch.length} magician(s))`);
  return { inserted: batch.length, failed: 0 };
}

async function main() {
  if (DRY_RUN) {
    console.log("=== DRY RUN MODE — nothing will be written to the database ===\n");
  }

  const allEntries = dedupeWithinFile(loadMagicianEntries());
  console.log(`Loaded ${allEntries.length} unique magician entry(ies) from ${path.basename(MAGICIANS_FILE)}.`);

  const db = getSupabaseAdminClient();
  const existingNames = await fetchExistingNames(db);
  console.log(`Found ${existingNames.size} magician(s) already in the database.`);

  const toInsert = allEntries.filter(
    (entry) => !existingNames.has(entry.name.trim().toLowerCase())
  );
  console.log(`${toInsert.length} magician(s) remain to be ingested.\n`);

  if (toInsert.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  if (DRY_RUN) {
    const preview = toInsert.slice(0, 10);
    for (const entry of preview) {
      const bioPreview = entry.bio.slice(0, 100);
      console.log(`  [dry-run] Would insert "${entry.name}" (${entry.years ?? "no years"})`);
      console.log(`      bio preview: ${bioPreview}${entry.bio.length > 100 ? "…" : ""}`);
    }
    if (toInsert.length > preview.length) {
      console.log(`  … and ${toInsert.length - preview.length} more.`);
    }
    console.log(`\nDone. (dry run — nothing was written)`);
    return;
  }

  if (!process.env.VOYAGE_API_KEY) {
    throw new Error("VOYAGE_API_KEY is not set. Add it to your .env file.");
  }

  const batches = chunk(toInsert, BATCH_SIZE);
  let totalInserted = 0;
  let totalFailed = 0;

  for (let i = 0; i < batches.length; i += 1) {
    const batchLabel = `${i + 1}/${batches.length}`;
    const { inserted, failed } = await ingestBatch(batches[i], batchLabel);
    totalInserted += inserted;
    totalFailed += failed;

    if (i < batches.length - 1) {
      await sleep(DELAY_BETWEEN_BATCHES_MS);
    }
  }

  console.log(`\nDone. Inserted ${totalInserted} magician(s), ${totalFailed} failed.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
