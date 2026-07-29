import OpenAI from "openai";
import { supabaseDb } from "@/lib/data/supabase-db";
import { Locale } from "@/lib/domain/types";
import { nowIso } from "@/lib/domain/utils";

const activeJobs = new Set<string>();
const MIN_PDF_TEXT_CHARS = 2_000;
const FILE_CHUNK_CHARS = 7_000;
const SUMMARY_INPUT_CHARS = 140_000;

type ExtractedPage = {
  page: number;
  text: string;
};

function normalizeExtractedText(value: string) {
  return value
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function decodeReadableText(buffer: ArrayBuffer) {
  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  if (!decoded.trim()) return "";
  const suspicious = (decoded.match(/\uFFFD|[\u0000-\u0008\u000E-\u001F]/g) ?? []).length;
  if (suspicious / decoded.length > 0.01) return "";
  return normalizeExtractedText(decoded);
}

async function ocrImage(image: ArrayBuffer | Uint8Array | Buffer) {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");
  try {
    const bytes = image instanceof ArrayBuffer ? new Uint8Array(image) : image;
    const result = await worker.recognize(Buffer.from(bytes));
    return normalizeExtractedText(result.data.text);
  } finally {
    await worker.terminate();
  }
}

async function ocrPdf(buffer: ArrayBuffer): Promise<ExtractedPage[]> {
  const [{ pdf }, { createScheduler, createWorker }] = await Promise.all([
    import("pdf-to-img"),
    import("tesseract.js"),
  ]);
  const dataUrl = `data:application/pdf;base64,${Buffer.from(buffer).toString("base64")}`;
  const document = await pdf(dataUrl, { scale: 1.2 });
  const scheduler = createScheduler();
  const workerCount = Math.min(3, Math.max(1, document.length));

  try {
    const workers = await Promise.all(
      Array.from({ length: workerCount }, () => createWorker("eng"))
    );
    workers.forEach((worker) => scheduler.addWorker(worker));

    const pages: ExtractedPage[] = [];
    const batchSize = workerCount * 2;
    for (let start = 1; start <= document.length; start += batchSize) {
      const pageNumbers = Array.from(
        { length: Math.min(batchSize, document.length - start + 1) },
        (_, index) => start + index
      );
      const images = await Promise.all(
        pageNumbers.map((pageNumber) => document.getPage(pageNumber))
      );
      const results = await Promise.all(
        images.map((image) => scheduler.addJob("recognize", image))
      );
      results.forEach((result, index) => {
        pages.push({
          page: pageNumbers[index],
          text: normalizeExtractedText(result.data.text),
        });
      });
    }
    return pages;
  } finally {
    await scheduler.terminate();
    await document.destroy();
  }
}

export async function extractPdf(buffer: ArrayBuffer): Promise<ExtractedPage[]> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const document = await getDocument({
    data: new Uint8Array(buffer.slice(0)),
    useSystemFonts: true,
  }).promise;

  try {
    const pages: ExtractedPage[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = normalizeExtractedText(
        content.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ")
      );
      pages.push({ page: pageNumber, text });
    }

    const extractedChars = pages.reduce((total, page) => total + page.text.length, 0);
    const minimumUsefulText = Math.min(
      MIN_PDF_TEXT_CHARS,
      Math.max(80, document.numPages * 40)
    );
    if (extractedChars >= minimumUsefulText) return pages;
  } finally {
    await document.destroy();
  }

  return ocrPdf(buffer);
}

async function extractDocument(
  buffer: ArrayBuffer,
  mimeType: string,
  fileName: string
): Promise<ExtractedPage[]> {
  const lowerName = fileName.toLowerCase();
  if (mimeType === "application/pdf" || lowerName.endsWith(".pdf")) {
    return extractPdf(buffer);
  }
  if (mimeType.startsWith("image/")) {
    return [{ page: 1, text: await ocrImage(buffer) }];
  }

  const text = decodeReadableText(buffer);
  if (text) return [{ page: 1, text }];
  throw new Error("No readable text could be extracted from this file");
}

export function chunkPages(pages: ExtractedPage[]) {
  const chunks: string[] = [];
  let current = "";
  let firstPage = 0;
  let lastPage = 0;

  const flush = () => {
    if (current.trim()) {
      const label = firstPage === lastPage
        ? `[Page ${firstPage}]`
        : `[Pages ${firstPage}-${lastPage}]`;
      const body =
        firstPage === lastPage
          ? current.replace(/^\[Page \d+\]\n/, "")
          : current;
      chunks.push(`${label}\n${body.trim()}`);
    }
    current = "";
    firstPage = 0;
    lastPage = 0;
  };

  for (const page of pages) {
    const text = page.text.trim();
    if (!text) continue;

    if (text.length > FILE_CHUNK_CHARS) {
      flush();
      for (let offset = 0; offset < text.length; offset += FILE_CHUNK_CHARS) {
        chunks.push(
          `[Page ${page.page}]\n${text.slice(offset, offset + FILE_CHUNK_CHARS)}`
        );
      }
      continue;
    }

    const pageBlock = `[Page ${page.page}]\n${text}`;
    if (current && current.length + pageBlock.length + 2 > FILE_CHUNK_CHARS) {
      flush();
    }
    if (!firstPage) firstPage = page.page;
    lastPage = page.page;
    current += `${current ? "\n\n" : ""}${pageBlock}`;
  }
  flush();
  return chunks;
}

function fallbackSummary(text: string, fileName: string, locale: Locale) {
  const excerpt = normalizeExtractedText(text).slice(0, 1_200);
  return locale === "zh"
    ? `已读取《${fileName}》。文档开篇内容：${excerpt}`
    : `Read "${fileName}". Opening excerpt: ${excerpt}`;
}

function buildSummaryInput(text: string) {
  if (text.length <= SUMMARY_INPUT_CHARS) return text;

  // A full book can exceed the model context and make "uploading" appear to
  // hang even though extraction is already complete. Sample evenly across the
  // document for the optional overview; every full chunk is still stored and
  // available to chat.
  const excerptCount = 14;
  const excerptChars = Math.floor(SUMMARY_INPUT_CHARS / excerptCount);
  return Array.from({ length: excerptCount }, (_, index) => {
    const offset = Math.floor(
      ((text.length - excerptChars) * index) / Math.max(1, excerptCount - 1)
    );
    return `[Document excerpt ${index + 1}/${excerptCount}]\n${text.slice(
      offset,
      offset + excerptChars
    )}`;
  }).join("\n\n");
}

function parseBilingualSummary(
  value: string,
  text: string,
  fileName: string
) {
  const zhMatch = value.match(/ZH_SUMMARY:\s*([\s\S]*?)(?=\nEN_SUMMARY:|$)/i);
  const enMatch = value.match(/EN_SUMMARY:\s*([\s\S]*)$/i);
  return {
    zh: normalizeExtractedText(zhMatch?.[1] ?? "") ||
      fallbackSummary(text, fileName, "zh"),
    en: normalizeExtractedText(enMatch?.[1] ?? "") ||
      fallbackSummary(text, fileName, "en"),
  };
}

async function summarizeWithDeepSeek(text: string, fileName: string) {
  const fallback = {
    zh: fallbackSummary(text, fileName, "zh"),
    en: fallbackSummary(text, fileName, "en"),
  };
  if (!process.env.DEEPSEEK_API_KEY || !text.trim()) return fallback;

  const client = new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
  });
  const model =
    process.env.DEEPSEEK_MODEL?.split(",")[0]?.trim() || "deepseek-v4-flash";

  try {
    const completion = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content:
            "You summarize a user-uploaded book for a private AI reading assistant. Use only the supplied text. Cover the book's purpose, structure, major ideas, named chapters or techniques, and practical learning path. Be concrete and accurate. Return exactly two sections headed ZH_SUMMARY: and EN_SUMMARY:. Each summary should be useful on its own.",
        },
        {
          role: "user",
          content: `File: ${fileName}\n\nExtracted book text:\n${buildSummaryInput(text)}`,
        },
      ],
      max_tokens: 2_400,
    });
    const content = completion.choices[0]?.message?.content;
    return content ? parseBilingualSummary(content, text, fileName) : fallback;
  } catch (error) {
    console.warn("DeepSeek document summary failed; using extracted excerpt", {
      error: error instanceof Error ? error.message : String(error),
    });
    return fallback;
  }
}

async function runProcessing(jobId: string) {
  const job = await supabaseDb.getFileJob(jobId);
  if (!job) return;

  await supabaseDb.updateFileJob(job.id, "processing", {
    startedAt: nowIso(),
  });

  const file = await supabaseDb.getFile(job.fileId);
  if (!file) {
    await supabaseDb.updateFileJob(job.id, "failed", {
      finishedAt: nowIso(),
      error: "Missing file",
    });
    return;
  }

  try {
    const upload = await supabaseDb.getUpload(file.id);
    if (!upload) throw new Error("Uploaded file is missing from storage");

    const pages = await extractDocument(upload, file.mimeType, file.fileName);
    const fullText = pages
      .filter((page) => page.text.trim())
      .map((page) => `[Page ${page.page}]\n${page.text}`)
      .join("\n\n");
    if (!fullText.trim()) throw new Error("No readable text was found in the file");

    const chunks = chunkPages(pages);
    const initialSummary = {
      zh: fallbackSummary(fullText, file.fileName, "zh"),
      en: fallbackSummary(fullText, file.fileName, "en"),
    };
    const buildInsightPayloads = (summary: { zh: string; en: string }) => [
      { kind: "summary" as const, locale: "zh" as const, content: summary.zh },
      { kind: "summary" as const, locale: "en" as const, content: summary.en },
      ...chunks.flatMap((content) => [
        { kind: "key_points" as const, locale: "zh" as const, content },
        { kind: "key_points" as const, locale: "en" as const, content },
      ]),
    ];

    // "ready" means the complete extracted text is queryable. The optional AI
    // overview is deliberately not part of this critical path.
    await supabaseDb.replaceFileInsights(
      file.id,
      file.userId,
      buildInsightPayloads(initialSummary)
    );
    await supabaseDb.updateFile(file.id, {
      status: "ready",
      previewText: fullText.slice(0, 12_000),
      summaryZh: initialSummary.zh,
      summaryEn: initialSummary.en,
      translatedZh: initialSummary.zh,
      translatedEn: initialSummary.en,
    });

    let summaryGenerated = false;
    try {
      const summary = await summarizeWithDeepSeek(fullText, file.fileName);
      await supabaseDb.replaceFileSummaryInsights(
        file.id,
        file.userId,
        [
          { locale: "zh", content: summary.zh },
          { locale: "en", content: summary.en },
        ]
      );
      await supabaseDb.updateFile(file.id, {
        summaryZh: summary.zh,
        summaryEn: summary.en,
        translatedZh: summary.zh,
        translatedEn: summary.en,
      });
      summaryGenerated = true;
    } catch (summaryError) {
      // Searchable extracted text is already committed. A summary failure must
      // never make a readable upload unusable.
      console.warn("Optional document summary persistence failed", {
        fileId: file.id,
        error:
          summaryError instanceof Error
            ? summaryError.stack || summaryError.message
            : String(summaryError),
      });
    }

    await supabaseDb.updateFileJob(job.id, "done", { finishedAt: nowIso() });
    await supabaseDb.createEvent({
      userId: file.userId,
      name: "file_processed",
      payload: {
        fileId: file.id,
        mimeType: file.mimeType,
        extractedChars: fullText.length,
        pageCount: pages.length,
        chunkCount: chunks.length,
        summaryGenerated,
      },
    });
  } catch (error) {
    console.error("File processing failed", {
      jobId,
      fileId: file.id,
      fileName: file.fileName,
      error: error instanceof Error ? error.stack || error.message : String(error),
    });
    await supabaseDb.updateFile(file.id, { status: "failed" });
    await supabaseDb.updateFileJob(job.id, "failed", {
      finishedAt: nowIso(),
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export async function enqueueFileProcessing(params: {
  fileId: string;
  userId: string;
}) {
  const file = await supabaseDb.getFile(params.fileId);
  if (!file || file.userId !== params.userId) {
    throw new Error("FILE_NOT_FOUND");
  }

  const job = await supabaseDb.createFileJob(file.id, params.userId);
  await supabaseDb.updateFile(file.id, { status: "processing" });
  return job;
}

export async function processFileJob(jobId: string) {
  if (activeJobs.has(jobId)) return;
  activeJobs.add(jobId);
  try {
    await runProcessing(jobId);
  } finally {
    activeJobs.delete(jobId);
  }
}
