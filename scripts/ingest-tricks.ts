/**
 * scripts/ingest-tricks.ts
 *
 * Reads curated trick .md files from ./content and inserts them into
 * Supabase (tricks + trick_chunks tables).
 *
 * Each file can contain ONE OR MORE tricks. Multiple tricks in the same
 * file are separated by a line containing only "===". Each trick section
 * still needs its own frontmatter + body, same as a single-trick file.
 *
 * Reminder: each trick's Effect/Method summary should still be your own
 * short original write-up of that specific trick — not a long transcription
 * of a book. This delimiter just saves you from creating many small files;
 * it doesn't change what belongs in each section.
 *
 * RUN
 * ---
 * npx tsx scripts/ingest-tricks.ts              (normal run, writes to DB)
 * npx tsx scripts/ingest-tricks.ts --dry-run     (preview only, writes nothing)
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { embedTrickText } from "../src/lib/ai/trick-embedding";

const CONTENT_DIR = path.join(process.cwd(), "content");
const TRICK_SEPARATOR = /\r?\n(?:[ \t]*===[ \t]*\r?\n)+(?:\r?\n)*/;
const DRY_RUN = process.argv.includes("--dry-run");

// Voyage AI's free tier (no payment method on file) is limited to ~3 requests
// per minute. This delay keeps normal runs safely under that, and the retry
// logic below is a second layer of protection in case we still get
// rate-limited (e.g. someone else on the team is also embedding at the
// same time).
const DELAY_BETWEEN_TRICKS_MS = 21_000; // ~2.8 requests/minute
const MAX_RETRIES = 4;

type IngestDatabase = {
  public: {
    Tables: {
      tricks: {
        Row: { id: string; title: string };
        Insert: {
          title: string;
          difficulty: unknown;
          props_needed: unknown[];
          tags: unknown[];
          source: string;
          effect_description: string;
          method_summary: string;
        };
        Update: Record<string, unknown>;
        Relationships: [];
      };
      trick_chunks: {
        Row: { id: string; trick_id: string };
        Insert: { trick_id: string; content: string; embedding: number[] };
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

async function embedWithRetry(text: string, inputType: "document" | "query", label: string): Promise<number[]> {
  let attempt = 0;
  while (true) {
    try {
      return await embedTrickText(text, inputType);
    } catch (err) {
      const message = (err as Error).message ?? "";
      const isRateLimit = message.includes("429");
      attempt += 1;

      if (!isRateLimit || attempt > MAX_RETRIES) {
        throw err; // not a rate-limit error, or we've retried enough — give up
      }

      const backoffMs = 15_000 * attempt; // 15s, 30s, 45s, 60s
      console.log(
        `  … Rate limited while embedding "${label}" (attempt ${attempt}/${MAX_RETRIES}). Waiting ${backoffMs / 1000}s before retrying.`
      );
      await sleep(backoffMs);
    }
  }
}

async function ingestTrick(meta: Record<string, unknown>, body: string, fallbackLabel: string) {
  const title = (meta.title as string) ?? fallbackLabel;
  const [effectPart, ...methodParts] = body.split("Method summary:");
  const effectDescription = (effectPart ?? "").replace(/^\s*Effect:\s*/i, "").trim();
  const methodSummary = methodParts.length > 0
    ? methodParts.join("Method summary:").trim()
    : body.trim();
  const trickPayload = {
    title,
    difficulty: meta.difficulty ?? "beginner",
    props_needed: Array.isArray(meta.props) ? meta.props : [],
    tags: Array.isArray(meta.tags) ? meta.tags : [],
    source: typeof meta.source === "string" ? meta.source : "",
    effect_description: effectDescription,
    method_summary: methodSummary,
  };

  if (DRY_RUN) {
    const effectPreview = effectDescription.slice(0, 120);
    console.log(`  [dry-run] Would insert "${title}"`);
    console.log(`      difficulty: ${meta.difficulty ?? "(default: beginner)"}`);
    console.log(`      props: ${JSON.stringify(meta.props ?? [])}`);
    console.log(`      tags: ${JSON.stringify(meta.tags ?? [])}`);
    console.log(`      source: ${meta.source ?? "(none)"}`);
    console.log(`      effect preview: ${effectPreview}${effectPreview.length === 120 ? "…" : ""}`);
    console.log(`      body length: ${body.trim().length} characters`);
    return;
  }

  const db = getSupabaseAdminClient();
  const { data: existing, error: existingError } = await db
    .from("tricks")
    .select("id")
    .eq("title", title)
    .maybeSingle();
  if (existingError) throw new Error(`Failed to check "${title}": ${existingError.message}`);

  if (existing) {
    const { data: existingChunk, error: chunkLookupError } = await db
      .from("trick_chunks")
      .select("id")
      .eq("trick_id", existing.id)
      .limit(1)
      .maybeSingle();
    if (chunkLookupError) {
      throw new Error(`Failed to check embedding for "${title}": ${chunkLookupError.message}`);
    }
    if (existingChunk) {
      console.log(`  ○ Skipped "${title}" (already exists with embedding)`);
      return;
    }
    console.log(`  ↻ Repairing missing embedding for "${title}"`);
  }

  // Keyword retrieval can use the curated row without an embedding. Persist
  // it now and let a later run repair the vector when Voyage is configured.
  if (!process.env.VOYAGE_API_KEY) {
    if (existing) {
      console.log(`  ◌ Kept "${title}" keyword-searchable; embedding is still pending`);
      return;
    }
    const { error: keywordOnlyError } = await db.from("tricks").insert(trickPayload);
    if (keywordOnlyError) {
      console.error(
        `  ✗ Failed to insert keyword-searchable trick "${title}":`,
        keywordOnlyError.message
      );
      return;
    }
    console.log(`  ✓ Ingested "${title}" for keyword search (embedding pending)`);
    return;
  }

  let embedding: number[];
  try {
    embedding = await embedWithRetry(body, "document", title);
  } catch (err) {
    console.error(`  ✗ Embedding failed for "${title}"; no incomplete row was created:`, (err as Error).message);
    return;
  }

  let trickId = existing?.id as string | undefined;
  let insertedNewTrick = false;
  if (!trickId) {
    const { data: trick, error: trickError } = await db
      .from("tricks")
      .insert(trickPayload)
      .select("id")
      .single();

    if (trickError || !trick) {
      console.error(`  ✗ Failed to insert trick "${title}":`, trickError?.message);
      return;
    }
    trickId = trick.id;
    insertedNewTrick = true;
  }

  const { error: chunkError } = await db.from("trick_chunks").insert({
    trick_id: trickId,
    content: body.trim(),
    embedding,
  });

  if (chunkError) {
    if (insertedNewTrick) await db.from("tricks").delete().eq("id", trickId);
    console.error(`  ✗ Failed to save embedding for "${title}":`, chunkError.message);
    return;
  }

  console.log(`  ✓ Ingested "${title}"`);

  // Slow down before the next trick's embedding request, to stay under
  // Voyage's free-tier rate limit.
  await sleep(DELAY_BETWEEN_TRICKS_MS);
}

async function ingestFile(filePath: string) {
  const raw = fs.readFileSync(filePath, "utf-8");
  const sections = raw.split(TRICK_SEPARATOR).map((s) => s.trim()).filter(Boolean);

  if (sections.length === 0) {
    console.log(`  (no trick sections found in ${path.basename(filePath)})`);
    return;
  }

  console.log(`  Found ${sections.length} section(s) in this file.`);

  for (let index = 0; index < sections.length; index += 1) {
    const rawSection = sections[index];
    const frontmatterStart = rawSection.search(/^---[ \t]*$/m);
    const section = frontmatterStart >= 0
      ? rawSection.slice(frontmatterStart)
      : rawSection;
    let meta: Record<string, unknown>;
    let body: string;
    try {
      const parsed = matter(section);
      meta = parsed.data as Record<string, unknown>;
      body = parsed.content;
    } catch (err) {
      console.error(`  ✗ Section #${index + 1} in ${path.basename(filePath)} has invalid frontmatter and was skipped:`, (err as Error).message);
      continue;
    }

    const fallbackLabel = `${path.basename(filePath)} #${index + 1}`;

    if (!meta.title) {
      console.error(`  ✗ Skipped section #${index + 1} in ${path.basename(filePath)} — missing "title" in frontmatter.`);
      continue;
    }

    await ingestTrick(meta, body, fallbackLabel);
  }
}

async function main() {
  if (DRY_RUN) {
    console.log("=== DRY RUN MODE — nothing will be written to the database ===\n");
  }

  const requestedFiles = process.argv
    .slice(2)
    .filter((arg) => !arg.startsWith("--"))
    .map((file) => path.resolve(file));
  const files = requestedFiles.length > 0
    ? requestedFiles
    : fs.existsSync(CONTENT_DIR)
      ? fs.readdirSync(CONTENT_DIR)
          .filter((file) => file.endsWith(".md"))
          .map((file) => path.join(CONTENT_DIR, file))
      : [];

  if (files.length === 0) {
    console.log("No .md files found to ingest.");
    return;
  }

  for (const file of files) {
    if (!fs.existsSync(file)) {
      throw new Error(`Input file not found: ${file}`);
    }
    if (path.extname(file).toLowerCase() !== ".md") {
      throw new Error(`Input file must be Markdown: ${file}`);
    }
  }

  console.log(`Found ${files.length} file(s) to process:`);
  for (const file of files) {
    console.log(`\n${path.basename(file)}:`);
    await ingestFile(file);
  }
  console.log(`\nDone.${DRY_RUN ? " (dry run — nothing was written)" : ""}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
