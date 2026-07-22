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
import { createClient } from "@supabase/supabase-js";
import { embedTrickText } from "../src/lib/ai/trick-embedding";

const CONTENT_DIR = path.join(process.cwd(), "content");
const TRICK_SEPARATOR = /\n===\n/;
const DRY_RUN = process.argv.includes("--dry-run");

// Voyage AI's free tier (no payment method on file) is limited to ~3 requests
// per minute. This delay keeps normal runs safely under that, and the retry
// logic below is a second layer of protection in case we still get
// rate-limited (e.g. someone else on the team is also embedding at the
// same time).
const DELAY_BETWEEN_TRICKS_MS = 21_000; // ~2.8 requests/minute
const MAX_RETRIES = 4;

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

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

  if (DRY_RUN) {
    const effectPreview = (body.split("Method summary:")[0]?.replace("Effect:", "").trim() ?? "").slice(0, 120);
    console.log(`  [dry-run] Would insert "${title}"`);
    console.log(`      difficulty: ${meta.difficulty ?? "(default: beginner)"}`);
    console.log(`      props: ${JSON.stringify(meta.props ?? [])}`);
    console.log(`      tags: ${JSON.stringify(meta.tags ?? [])}`);
    console.log(`      source: ${meta.source ?? "(none)"}`);
    console.log(`      effect preview: ${effectPreview}${effectPreview.length === 120 ? "…" : ""}`);
    console.log(`      body length: ${body.trim().length} characters`);
    return;
  }

  // Skip if a trick with this exact title already exists
  const { data: existing } = await supabase
    .from("tricks")
    .select("id")
    .eq("title", title)
    .maybeSingle();

  if (existing) {
    console.log(`  ○ Skipped "${title}" (already exists)`);
    return;
  }

  const { data: trick, error: trickError } = await supabase
    .from("tricks")
    .insert({
      title,
      difficulty: meta.difficulty ?? "beginner",
      props_needed: meta.props ?? [],
      tags: meta.tags ?? [],
      source: meta.source ?? "",
      effect_description: body.split("Method summary:")[0]?.replace("Effect:", "").trim() ?? "",
      method_summary: body.trim(),
    })
    .select()
    .single();

  if (trickError || !trick) {
    console.error(`  ✗ Failed to insert trick "${title}":`, trickError?.message);
    return;
  }

  let embedding: number[];
  try {
    embedding = await embedWithRetry(body, "document", title);
  } catch (err) {
    console.error(`  ✗ Trick "${title}" inserted, but embedding permanently failed (row left without a chunk):`, (err as Error).message);
    return;
  }

  const { error: chunkError } = await supabase.from("trick_chunks").insert({
    trick_id: trick.id,
    content: body.trim(),
    embedding,
  });

  if (chunkError) {
    console.error(`  ✗ Trick "${title}" inserted, but chunk/embedding failed:`, chunkError.message);
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
    const section = sections[index];
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

  if (!fs.existsSync(CONTENT_DIR)) {
    console.error(`No content folder found at ${CONTENT_DIR} — create one and put your .md trick files there.`);
    return;
  }

  const files = fs.readdirSync(CONTENT_DIR).filter((f) => f.endsWith(".md"));
  if (files.length === 0) {
    console.log("No .md files found in ./content — nothing to ingest.");
    return;
  }

  console.log(`Found ${files.length} file(s) to process:`);
  for (const file of files) {
    console.log(`\n${file}:`);
    await ingestFile(path.join(CONTENT_DIR, file));
  }
  console.log(`\nDone.${DRY_RUN ? " (dry run — nothing was written)" : ""}`);
}

main();