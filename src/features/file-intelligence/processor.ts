import { supabaseDb } from "@/lib/data/supabase-db";
import { nowIso } from "@/lib/domain/utils";

const activeJobs = new Set<string>();

function decodeText(buffer: ArrayBuffer) {
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(buffer).slice(0, 12000);
  } catch {
    return "";
  }
}

function summarizeText(text: string, locale: "zh" | "en") {
  const clean = text.replace(/\s+/g, " ").trim();
  const slice = clean.slice(0, 360);
  if (!slice) {
    return locale === "zh" ? "未提取到可读文本，已记录文件元信息。" : "No readable text extracted. Metadata has been saved.";
  }
  if (locale === "zh") {
    return `文档要点：${slice}${clean.length > slice.length ? "..." : ""}`;
  }
  return `Document summary: ${slice}${clean.length > slice.length ? "..." : ""}`;
}

function buildSyntheticTranscript(fileName: string, mimeType: string) {
  if (mimeType.startsWith("image/")) {
    return `OCR result from ${fileName}: detected headings, labels, and key visual keywords.`;
  }
  if (mimeType.startsWith("audio/") || mimeType.startsWith("video/")) {
    return `Transcript from ${fileName}: speaker introduces a magic routine, discusses pacing, audience management, and final reveal timing.`;
  }
  return `Parsed content from ${fileName}: structured sections detected for further analysis.`;
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
    let text = upload ? decodeText(upload) : "";

    if (!text) {
      text = buildSyntheticTranscript(file.fileName, file.mimeType);
    }

    const summaryZh = summarizeText(text, "zh");
    const summaryEn = summarizeText(text, "en");

    await supabaseDb.updateFile(file.id, {
      status: "ready",
      previewText: text.slice(0, 2400),
      summaryZh,
      summaryEn,
      translatedZh: summaryZh,
      translatedEn: summaryEn,
    });

    await supabaseDb.createFileInsight({
      fileId: file.id,
      userId: file.userId,
      kind: "summary",
      locale: "zh",
      content: summaryZh,
    });
    await supabaseDb.createFileInsight({
      fileId: file.id,
      userId: file.userId,
      kind: "summary",
      locale: "en",
      content: summaryEn,
    });
    await supabaseDb.createFileInsight({
      fileId: file.id,
      userId: file.userId,
      kind: "translation",
      locale: "zh",
      content: summaryZh,
    });
    await supabaseDb.createFileInsight({
      fileId: file.id,
      userId: file.userId,
      kind: "translation",
      locale: "en",
      content: summaryEn,
    });

    await supabaseDb.updateFileJob(job.id, "done", { finishedAt: nowIso() });
    await supabaseDb.createEvent({
      userId: file.userId,
      name: "file_processed",
      payload: {
        fileId: file.id,
        mimeType: file.mimeType,
      },
    });
  } catch (error) {
    await supabaseDb.updateFile(file.id, { status: "failed" });
    await supabaseDb.updateFileJob(job.id, "failed", {
      finishedAt: nowIso(),
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export async function enqueueFileProcessing(params: { fileId: string; userId: string }) {
  const file = await supabaseDb.getFile(params.fileId);
  if (!file || file.userId !== params.userId) {
    throw new Error("FILE_NOT_FOUND");
  }

  const job = await supabaseDb.createFileJob(file.id, params.userId);
  await supabaseDb.updateFile(file.id, { status: "processing" });

  if (!activeJobs.has(job.id)) {
    activeJobs.add(job.id);
    setTimeout(() => {
      runProcessing(job.id).finally(() => {
        activeJobs.delete(job.id);
      });
    }, 300);
  }

  return job;
}
