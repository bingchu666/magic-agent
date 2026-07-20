/**
 * scripts/ingest-tricks.ts
 *
 * Reads curated trick .md files from ./content and inserts them into
 * Supabase (tricks + trick_chunks tables), same idea as the old Python
 * ingest_content.py, just rewritten for this project.
 *
 * This talks to Supabase directly with the service role key (bypasses RLS),
 * rather than going through supabaseDb — that file is designed for web
 * requests with a logged-in user's cookie, which doesn't exist when running
 * a standalone script like this.
 *
 * SETUP
 * -----
 * npm install -D gray-matter tsx dotenv
 *
 * .env needs (should already be there from the earlier Python setup):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_KEY   (the secret/service_role key, NOT the anon key)
 *   VOYAGE_API_KEY
 *
 * RUN
 * ---
 * npx tsx scripts/ingest-tricks.ts
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { createClient } from "@supabase/supabase-js";
import { embedTrickText } from "../src/lib/ai/trick-embedding";

const CONTENT_DIR = path.join(process.cwd(), "content");

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

async function ingestFile(filePath: string) {
  const raw = fs.readFileSync(filePath, "utf-8");
  const { data: meta, content: body } = matter(raw);
  const title = meta.title ?? path.basename(filePath);

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

  const embedding = await embedTrickText(body, "document");

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
}

async function main() {
  if (!fs.existsSync(CONTENT_DIR)) {
    console.error(`No content folder found at ${CONTENT_DIR} — create one and put your .md trick files there.`);
    return;
  }

  const files = fs.readdirSync(CONTENT_DIR).filter((f) => f.endsWith(".md"));
  if (files.length === 0) {
    console.log("No .md files found in ./content — nothing to ingest.");
    return;
  }

  console.log(`Found ${files.length} file(s) to ingest:`);
  for (const file of files) {
    await ingestFile(path.join(CONTENT_DIR, file));
  }
  console.log(`\nDone.`);
}

main();