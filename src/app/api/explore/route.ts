import { NextResponse } from "next/server";
import { assertSession } from "@/features/auth/session.server";
import { generateWithGateway } from "@/lib/ai/model-gateway";
import { supabaseDb } from "@/lib/data/supabase-db";
import { Locale } from "@/lib/domain/types";

const EXPLORE_SYSTEM_PROMPT =
  "You are a rigorous interdisciplinary learning guide inside a hierarchical knowledge workspace. " +
  "Be concise, accurate, explicit about uncertainty, and do not force the discussion toward stage magic unless asked.";

const GLOSSARY_TRANSLATE_SYSTEM_PROMPT =
  "You are a precise translator for a magic terminology glossary. Translate the given English " +
  "dictionary entry into natural, concise Chinese. Preserve its factual content exactly — do not " +
  "add, remove, or guess at information beyond what's given. Keep any bracketed rarity/era notes " +
  "(e.g. \"[obsolete after 1896]\") translated too. Output only the translated definition, no heading.";

const BIO_TRANSLATE_SYSTEM_PROMPT =
  "You are a precise translator for a magician biographical dictionary (Who's Who in Magic). " +
  "Translate the given English biography entry into natural, concise Chinese. Preserve its factual " +
  "content exactly — do not add, remove, invent, or guess at any biographical detail (dates, places, " +
  "names, effects) beyond what's given. Output only the translated biography, no heading.";

/** Collapse OCR/reference-book whitespace noise without touching wording. */
function normalizeDefinition(text: string) {
  return text.trim().replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n");
}

/** Serve a glossary hit: English as-is, or translated to Chinese for zh locale. */
async function respondWithGlossaryMatch(rawDefinition: string, locale: Locale) {
  const definition = normalizeDefinition(rawDefinition);
  if (locale === "zh") {
    const translated = await generateWithGateway({
      locale: "zh",
      intent: "translation",
      userMessage: definition,
      history: [],
      fileContext: "",
      systemPrompt: GLOSSARY_TRANSLATE_SYSTEM_PROMPT,
    });
    // provider "rule" means the translation call itself fell back to a
    // canned "model unavailable" string — serve the glossary's own English
    // text instead of that unhelpful placeholder.
    if (translated.provider !== "rule") {
      return NextResponse.json({ text: translated.text, provider: translated.provider, source: "glossary" });
    }
  }
  return NextResponse.json({ text: definition, provider: "glossary", source: "glossary" });
}

/** Serve a magician-bio hit: English as-is, or translated to Chinese for zh
 * locale. Mirrors respondWithGlossaryMatch — see that function's comments. */
async function respondWithMagicianMatch(rawBio: string, locale: Locale) {
  const bio = normalizeDefinition(rawBio);
  if (locale === "zh") {
    const translated = await generateWithGateway({
      locale: "zh",
      intent: "translation",
      userMessage: bio,
      history: [],
      fileContext: "",
      systemPrompt: BIO_TRANSLATE_SYSTEM_PROMPT,
    });
    if (translated.provider !== "rule") {
      return NextResponse.json({ text: translated.text, provider: translated.provider, source: "magician" });
    }
  }
  return NextResponse.json({ text: bio, provider: "magician", source: "magician" });
}

type ExploreUtilityBody = {
  mode?: "preview" | "validate" | "summarize" | "termLookup";
  locale?: Locale;
  term?: string;
  context?: string;
  understanding?: string;
  content?: string;
};

function clip(value: unknown, limit: number) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

export async function POST(req: Request) {
  try {
    await assertSession(req);
    const body = (await req.json()) as ExploreUtilityBody;
    const locale: Locale = body.locale === "en" ? "en" : "zh";
    let prompt = "";

    // Raw dictionary lookup for callers that need the dictionary's own text
    // as grounding material (e.g. forcing a "create branch and expand"
    // follow-up generation to stick to it) rather than a user-facing,
    // possibly-translated preview string. Checks the magician biography
    // dictionary first, then the term glossary — same order as "preview"
    // mode below, for the same reason (see its comment).
    if (body.mode === "termLookup") {
      const term = clip(body.term, 160);
      if (!term) return NextResponse.json({ error: "Missing term" }, { status: 400 });

      const magicianMatch = await supabaseDb.findExactMagician(term);
      if (magicianMatch) {
        return NextResponse.json({
          matched: true,
          term: magicianMatch.name,
          definition: normalizeDefinition(magicianMatch.bio),
          source: "person",
        });
      }

      const glossaryMatch =
        (await supabaseDb.findExactMagicTerm(term)) ?? (await supabaseDb.findSimilarMagicTerm(term));
      return NextResponse.json(
        glossaryMatch
          ? {
              matched: true,
              term: glossaryMatch.term,
              definition: normalizeDefinition(glossaryMatch.definition),
              source: "term",
            }
          : { matched: false }
      );
    }

    if (body.mode === "preview") {
      const term = clip(body.term, 160);
      if (!term) return NextResponse.json({ error: "Missing term" }, { status: 400 });

      // Check the magician biography dictionary first — a person's name
      // clicked in the workspace should show their actual bio, not an
      // AI-guessed one. Exact match only (see findExactMagician); no
      // semantic fallback since names don't have the
      // Chinese-concept-vs-English-headword mismatch that terms do.
      const magicianMatch = await supabaseDb.findExactMagician(term);
      if (magicianMatch) {
        return await respondWithMagicianMatch(magicianMatch.bio, locale);
      }

      const glossaryMatch =
        (await supabaseDb.findExactMagicTerm(term)) ?? (await supabaseDb.findSimilarMagicTerm(term));
      if (glossaryMatch) {
        return await respondWithGlossaryMatch(glossaryMatch.definition, locale);
      }

      prompt =
        locale === "zh"
          ? `用不超过100字解释术语“${term}”。先给一句直观定义，再说明它为什么与当前上下文有关。不要使用标题。\n\n当前上下文：${clip(body.context, 2200)}`
          : `Explain "${term}" in at most 80 words. Give an intuitive definition, then say why it matters in the current context. No heading.\n\nContext: ${clip(body.context, 2200)}`;
    } else if (body.mode === "validate") {
      const understanding = clip(body.understanding, 1800);
      if (!understanding) {
        return NextResponse.json({ error: "Missing understanding" }, { status: 400 });
      }
      prompt =
        locale === "zh"
          ? `校验用户对知识的理解是否准确。若核心理解准确，必须以“[认可]”开头；若存在关键错误，必须以“[需修正]”开头。随后只给一条具体反馈，不超过120字。\n\n参考内容：${clip(body.context, 3200)}\n\n用户理解：${understanding}`
          : `Validate the user's understanding. Start with "[Accepted]" if the core idea is accurate, otherwise start with "[Revise]". Then give one concrete note under 100 words.\n\nReference: ${clip(body.context, 3200)}\n\nUser understanding: ${understanding}`;
    } else if (body.mode === "summarize") {
      const content = clip(body.content, 9000);
      if (!content) return NextResponse.json({ error: "Missing content" }, { status: 400 });
      prompt =
        locale === "zh"
          ? `把下面的知识探索压缩成一份可复习的项目摘要：先用一句话写主线，再列出3至5条关键认识，最后写一个仍待回答的问题。总长度不超过350字。\n\n${content}`
          : `Turn the exploration below into a reviewable project summary: one sentence for the main line, 3–5 key insights, and one open question. Keep it under 250 words.\n\n${content}`;
    } else {
      return NextResponse.json({ error: "Unsupported mode" }, { status: 400 });
    }

    const result = await generateWithGateway({
      locale,
      intent: "analysis",
      userMessage: prompt,
      history: [],
      fileContext: "",
      systemPrompt: EXPLORE_SYSTEM_PROMPT,
    });

    return NextResponse.json({ text: result.text, provider: result.provider, source: "ai" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: message },
      { status: message === "UNAUTHORIZED" ? 401 : 500 }
    );
  }
}
