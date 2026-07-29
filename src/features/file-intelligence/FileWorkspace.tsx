"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import {
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  FileText,
  FileUp,
  Layers3,
  Sparkles,
  Trash2,
} from "lucide-react";
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
        let createdFileId = "";
        try {
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
          createdFileId = presign.fileId;

          const uploadRes = await fetch(presign.uploadUrl, {
            method: presign.method,
            headers: {
              "Content-Type": file.type || "application/octet-stream",
              "x-upsert": "true",
            },
            body: file,
          });

          if (!uploadRes.ok) {
            const uploadError = (await uploadRes.json().catch(() => null)) as
              | { error?: string; message?: string }
              | null;
            throw new Error(
              uploadError?.error ||
                uploadError?.message ||
                `Upload failed for ${file.name} (${uploadRes.status})`
            );
          }

          await apiJson(`/api/files/${presign.fileId}/enqueue`, {
            method: "POST",
          });
        } catch (uploadError) {
          if (createdFileId) {
            void fetch(`/api/files/${createdFileId}`, { method: "DELETE" }).catch(
              () => undefined
            );
          }
          throw uploadError;
        }
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
    <div className="magic-page magic-files-page">
      <header className="magic-page-hero">
        <div>
          <span>
            <Layers3 size={14} />
            {locale === "zh" ? "Source intelligence" : "Source intelligence"}
          </span>
          <h1>{locale === "zh" ? "把资料变成可探索的上下文" : "Turn sources into explorable context"}</h1>
          <p>{copy.uploadHint}</p>
        </div>
        <div className="magic-page-stat">
          <strong>{files.length}</strong>
          <span>{locale === "zh" ? "份资料" : "sources"}</span>
        </div>
        <div className="magic-page-stat">
          <strong>{files.filter((file) => file.status === "ready").length}</strong>
          <span>{locale === "zh" ? "已解析" : "ready"}</span>
        </div>
      </header>

      <section className="magic-upload-zone">
        <label>
          <input
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              void handleUpload(event.target.files);
              event.currentTarget.value = "";
            }}
          />
          <span className="magic-upload-icon">
            {uploading ? <Clock3 className="animate-spin" size={22} /> : <FileUp size={22} />}
          </span>
          <div>
            <small>{locale === "zh" ? "Drop a source here" : "Drop a source here"}</small>
            <h2>
              {uploading
                ? locale === "zh"
                  ? "正在接收资料…"
                  : "Receiving sources…"
                : locale === "zh"
                  ? "拖入文件，或点击选择"
                  : "Drop files or browse"}
            </h2>
            <p>PDF · DOCX · TXT · MD · PNG · JPG · MP3 · MP4</p>
          </div>
          <ArrowUpRight size={18} />
        </label>

        {error ? <p className="magic-form-notice is-error">{error}</p> : null}
        {hasProcessing ? (
          <p className="magic-processing-notice">
            <Clock3 className="animate-spin" size={14} />
            {locale === "zh"
              ? "资料正在后台解析，状态会自动更新。"
              : "Sources are being processed. Status updates automatically."}
          </p>
        ) : null}
      </section>

      <section className="magic-source-library">
        <div className="magic-section-heading">
          <div>
            <span>{locale === "zh" ? "Your source library" : "Your source library"}</span>
            <h2>{locale === "zh" ? "资料库" : "Source library"}</h2>
          </div>
          <p>{locale === "zh" ? "解析完成的资料可直接附加到对话和层级卡片。" : "Ready sources can ground chat and knowledge cards."}</p>
        </div>

        {files.length === 0 ? (
          <div className="magic-library-empty">
            <FileText size={28} />
            <h3>{locale === "zh" ? "资料库还是空的" : "Your library is empty"}</h3>
            <p>{locale === "zh" ? "先导入一份想认真读懂的材料。" : "Import something you want to understand deeply."}</p>
          </div>
        ) : (
          <div className="magic-source-grid">
            {files.map((file, index) => (
              <article key={file.id} className="magic-source-card">
                <header>
                  <div className="magic-source-number">{String(index + 1).padStart(2, "0")}</div>
                  <div className="magic-source-title">
                    <small>{file.mimeType.split("/").pop()?.toUpperCase() || "FILE"}</small>
                    <h3>{file.fileName}</h3>
                    <p>{(file.size / 1024).toFixed(1)} KB</p>
                  </div>
                  <span className={clsx("magic-status-pill", `is-${file.status}`)}>
                    {file.status === "ready" ? <CheckCircle2 size={12} /> : <Clock3 size={12} />}
                    {statusText(file.status)}
                  </span>
                </header>

                {file.previewText ? (
                  <p className="magic-source-preview">{file.previewText.slice(0, 320)}</p>
                ) : null}

                {file.status === "ready" ? (
                  <div className="magic-source-insights">
                    <div>
                      <span>
                        <Sparkles size={12} />
                        Summary
                      </span>
                      <p>{locale === "zh" ? file.summaryZh : file.summaryEn}</p>
                    </div>
                    <div>
                      <span>
                        <FileText size={12} />
                        Translation
                      </span>
                      <p>{locale === "zh" ? file.translatedZh : file.translatedEn}</p>
                    </div>
                  </div>
                ) : null}

                {insightsByFile[file.id]?.length ? (
                  <div className="magic-insight-list">
                    <span>{locale === "zh" ? "结构化洞察" : "Structured insights"}</span>
                    <ul>
                      {insightsByFile[file.id].slice(0, 4).map((insight) => (
                        <li key={insight.id}>
                          <i />
                          <span>{insight.content}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <footer>
                  <span>{new Date(file.updatedAt).toLocaleDateString()}</span>
                  <button
                    type="button"
                    onClick={() => void handleDelete(file.id)}
                    disabled={deletingFileId === file.id}
                    aria-label={locale === "zh" ? `删除 ${file.fileName}` : `Delete ${file.fileName}`}
                  >
                    <Trash2 size={14} />
                    {deletingFileId === file.id
                      ? locale === "zh"
                        ? "删除中…"
                        : "Deleting…"
                      : locale === "zh"
                        ? "移除"
                        : "Remove"}
                  </button>
                </footer>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
