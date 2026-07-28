/**
 * scripts/ingest-terms.ts
 *
 * Reads content/magic_terms_dictionary.json (an array of
 * { term, definition } objects) and inserts them into Supabase
 * (magic_terms + magic_term_chunks tables).
 *
 * Unlike scripts/ingest-tricks.ts, this batches many definitions into a
 * single Voyage embedding request (Voyage's `input` field natively accepts
 * an array of strings), so there's no need for a long per-item delay.
 *
 * RUN
 * ---
 * npx tsx scripts/ingest-terms.ts              (normal run, writes to DB)
 * npx tsx scripts/ingest-terms.ts --dry-run     (preview only, writes nothing)
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { embedTermTexts } from "../src/lib/ai/term-embedding";

const TERMS_FILE = path.join(process.cwd(), "content", "magic_terms_dictionary.json");
const DRY_RUN = process.argv.includes("--dry-run");

const BATCH_SIZE = 25;
const DELAY_BETWEEN_BATCHES_MS = 2_500;
const MAX_RETRIES = 4;

type TermEntry = {
  term: string;
  definition: string;
};

type IngestDatabase = {
  public: {
    Tables: {
      magic_terms: {
        Row: { id: string; term: string };
        Insert: {
          term: string;
          definition: string;
          see_also?: string | null;
          source?: string | null;
        };
        Update: Record<string, unknown>;
        Relationships: [];
      };
      magic_term_chunks: {
        Row: { id: string; term_id: string };
        Insert: { term_id: string; content: string; embedding: number[] };
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

function loadTermEntries(): TermEntry[] {
  if (!fs.existsSync(TERMS_FILE)) {
    throw new Error(`Terms file not found: ${TERMS_FILE}`);
  }
  const raw = fs.readFileSync(TERMS_FILE, "utf-8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`Expected ${TERMS_FILE} to contain a JSON array.`);
  }
  return parsed as TermEntry[];
}

/** Drop duplicate terms within the source file itself, keeping the first occurrence. */
function dedupeWithinFile(entries: TermEntry[]): TermEntry[] {
  const seen = new Set<string>();
  const result: TermEntry[] = [];
  let skipped = 0;
  for (const entry of entries) {
    if (seen.has(entry.term)) {
      skipped += 1;
      continue;
    }
    seen.add(entry.term);
    result.push(entry);
  }
  if (skipped > 0) {
    console.log(`Skipped ${skipped} duplicate term(s) within the source file.`);
  }
  return result;
}

async function fetchExistingTerms(db: SupabaseClient<IngestDatabase>): Promise<Set<string>> {
  const existing = new Set<string>();
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await db
      .from("magic_terms")
      .select("term")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`Failed to fetch existing terms: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) existing.add(row.term);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return existing;
}

async function ingestBatch(batch: TermEntry[], batchLabel: string) {
  const db = getSupabaseAdminClient();

  const { data: insertedTerms, error: insertTermsError } = await db
    .from("magic_terms")
    .insert(batch.map((entry) => ({ term: entry.term, definition: entry.definition })))
    .select("id, term");

  if (insertTermsError || !insertedTerms) {
    console.error(`  ✗ Failed to insert batch ${batchLabel}:`, insertTermsError?.message);
    return { inserted: 0, failed: batch.length };
  }

  const idByTerm = new Map(insertedTerms.map((row) => [row.term, row.id]));

  let embeddings: number[][];
  try {
    embeddings = await embedBatchWithRetry(
      batch.map((entry) => entry.definition),
      batchLabel
    );
  } catch (err) {
    console.error(
      `  ✗ Embedding failed for batch ${batchLabel}; rolling back ${batch.length} inserted term(s):`,
      (err as Error).message
    );
    await db.from("magic_terms").delete().in("id", [...idByTerm.values()]);
    return { inserted: 0, failed: batch.length };
  }

  const chunkRows = batch.map((entry, i) => ({
    term_id: idByTerm.get(entry.term)!,
    content: entry.definition,
    embedding: embeddings[i],
  }));

  const { error: chunkError } = await db.from("magic_term_chunks").insert(chunkRows);

  if (chunkError) {
    console.error(
      `  ✗ Failed to save embeddings for batch ${batchLabel}; rolling back ${batch.length} inserted term(s):`,
      chunkError.message
    );
    await db.from("magic_terms").delete().in("id", [...idByTerm.values()]);
    return { inserted: 0, failed: batch.length };
  }

  console.log(`  ✓ Ingested batch ${batchLabel} (${batch.length} term(s))`);
  return { inserted: batch.length, failed: 0 };
}

async function main() {
  if (DRY_RUN) {
    console.log("=== DRY RUN MODE — nothing will be written to the database ===\n");
  }

  const allEntries = dedupeWithinFile(loadTermEntries());
  console.log(`Loaded ${allEntries.length} unique term(s) from ${path.basename(TERMS_FILE)}.`);

  const db = getSupabaseAdminClient();
  const existingTerms = await fetchExistingTerms(db);
  console.log(`Found ${existingTerms.size} term(s) already in the database.`);

  const toInsert = allEntries.filter((entry) => !existingTerms.has(entry.term));
  console.log(`${toInsert.length} term(s) remain to be ingested.\n`);

  if (toInsert.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  if (DRY_RUN) {
    const preview = toInsert.slice(0, 10);
    for (const entry of preview) {
      const defPreview = entry.definition.slice(0, 100);
      console.log(`  [dry-run] Would insert "${entry.term}"`);
      console.log(`      definition preview: ${defPreview}${entry.definition.length > 100 ? "…" : ""}`);
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

  console.log(`\nDone. Inserted ${totalInserted} term(s), ${totalFailed} failed.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
