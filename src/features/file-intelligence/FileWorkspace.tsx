"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { FileAsset, FileInsight } from "@/lib/domain/types";
import { useSession } from "@/features/auth/session.client";
import { t } from "@/lib/ui/i18n";

type FileDetailResponse = {
  file: FileAsset;
  insights: FileInsight[];
};

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json?.error || `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function FileWorkspace() {
  const { user } = useSession();
  const locale = user?.locale ?? "zh";
  const copy = t(locale);

  const [files, setFiles] = useState<FileAsset[]>([]);
  const [insightsByFile, setInsightsByFile] = useState<Record<string, FileInsight[]>>({});
  const [uploading, setUploading] = useState(false);
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadFiles = async () => {
    const data = await apiJson<{ items: FileAsset[] }>("/api/files");
    setFiles(data.items);

    const ready = data.items.filter((file) => file.status === "ready").slice(0, 8);
    const details = await Promise.all(
      ready.map((file) => apiJson<FileDetailResponse>(`/api/files/${file.id}`))
    );

    const map: Record<string, FileInsight[]> = {};
    for (const detail of details) {
      map[detail.file.id] = detail.insights;
    }
    setInsightsByFile(map);
  };

  useEffect(() => {
    loadFiles().catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      loadFiles().catch((err) => setError(err.message));
    }, 2000);
    return () => clearInterval(timer);
  }, []);

  const hasProcessing = useMemo(
    () => files.some((file) => file.status === "processing" || file.status === "uploaded"),
    [files]
  );

  const statusClass = (status: FileAsset["status"]) => {
    if (status === "ready") return "bg-emerald-100 text-emerald-700";
    if (status === "processing") return "bg-amber-100 text-amber-700";
    if (status === "failed") return "bg-rose-100 text-rose-700";
    if (status === "expired") return "bg-zinc-200 text-zinc-600";
    return "bg-blue-100 text-blue-700";
  };

  const statusText = (status: FileAsset["status"]) => {
    if (status === "ready") return copy.ready;
    if (status === "processing") return copy.processing;
    if (status === "failed") return copy.failed;
    if (status === "expired") return copy.expired;
    return "Uploaded";
  };

  const handleUpload = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setUploading(true);
    setError(null);

    try {
      for (const file of Array.from(list)) {
        const presign = await apiJson<{
          fileId: string;
          uploadUrl: string;
          method: "PUT";
        }>("/api/files/presign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileName: file.name,
            mimeType: file.type || "application/octet-stream",
            size: file.size,
          }),
        });

        const uploadRes = await fetch(presign.uploadUrl, {
          method: presign.method,
          body: await file.arrayBuffer(),
        });

        if (!uploadRes.ok) {
          throw new Error(`Upload failed for ${file.name}`);
        }

        await apiJson(`/api/files/${presign.fileId}/enqueue`, {
          method: "POST",
        });
      }

      await loadFiles();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      setError(msg);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (fileId: string) => {
    setDeletingFileId(fileId);
    setError(null);
    try {
      await apiJson(`/api/files/${fileId}`, {
        method: "DELETE",
      });
      await loadFiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeletingFileId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-3xl border border-black/10 bg-white/85 p-4 shadow-sm backdrop-blur">
        <h1 className="text-xl font-semibold text-zinc-900">
          {locale === "zh" ? "文件智能中心" : "File Intelligence Center"}
        </h1>
        <p className="mt-1 text-sm text-zinc-500">{copy.uploadHint}</p>

        <label className="mt-4 block cursor-pointer rounded-2xl border border-dashed border-zinc-400 bg-zinc-50 p-6 text-center hover:bg-zinc-100">
          <input
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              void handleUpload(event.target.files);
              event.currentTarget.value = "";
            }}
          />
          <p className="text-sm font-semibold text-zinc-700">
            {uploading
              ? locale === "zh"
                ? "上传中..."
                : "Uploading..."
              : locale === "zh"
              ? "点击上传文件"
              : "Click to upload files"}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            PDF, DOCX, TXT, MD, PNG, JPG, MP3, MP4
          </p>
        </label>

        {error ? <p className="mt-3 text-xs text-rose-600">{error}</p> : null}
        {hasProcessing ? (
          <p className="mt-3 text-xs text-amber-700">
            {locale === "zh"
              ? "检测到正在处理中的任务，页面会自动刷新状态。"
              : "Processing tasks detected. Status updates automatically."}
          </p>
        ) : null}
      </div>

      <div className="grid gap-3">
        {files.map((file) => (
          <article key={file.id} className="rounded-3xl border border-black/10 bg-white/85 p-4 shadow-sm backdrop-blur">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-zinc-900">{file.fileName}</h2>
                <p className="text-xs text-zinc-500">
                  {file.mimeType} · {(file.size / 1024).toFixed(1)} KB
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={clsx("rounded-full px-2 py-1 text-xs font-semibold", statusClass(file.status))}>
                  {statusText(file.status)}
                </span>
                <button
                  type="button"
                  onClick={() => void handleDelete(file.id)}
                  disabled={deletingFileId === file.id}
                  className="rounded-full border border-rose-300 px-2.5 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-60"
                >
                  {deletingFileId === file.id
                    ? locale === "zh"
                      ? "删除中..."
                      : "Deleting..."
                    : locale === "zh"
                    ? "删除"
                    : "Delete"}
                </button>
              </div>
            </div>

            {file.previewText ? (
              <p className="mt-3 rounded-2xl bg-zinc-50 p-3 text-xs leading-5 text-zinc-700">
                {file.previewText.slice(0, 400)}
              </p>
            ) : null}

            {file.status === "ready" ? (
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                <div className="rounded-2xl border border-zinc-200 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Summary</p>
                  <p className="mt-1 text-sm leading-6 text-zinc-700">
                    {locale === "zh" ? file.summaryZh : file.summaryEn}
                  </p>
                </div>
                <div className="rounded-2xl border border-zinc-200 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Translation</p>
                  <p className="mt-1 text-sm leading-6 text-zinc-700">
                    {locale === "zh" ? file.translatedZh : file.translatedEn}
                  </p>
                </div>
              </div>
            ) : null}

            {insightsByFile[file.id]?.length ? (
              <div className="mt-3 rounded-2xl bg-zinc-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  {locale === "zh" ? "结构化洞察" : "Structured Insights"}
                </p>
                <ul className="mt-2 space-y-1">
                  {insightsByFile[file.id].slice(0, 4).map((insight) => (
                    <li key={insight.id} className="text-xs text-zinc-700">
                      [{insight.kind}] {insight.content}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  );
}
