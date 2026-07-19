"use client";

import { FormEvent, useEffect, useState } from "react";
import { Locale, VideoAsset, VideoDifficulty } from "@/lib/domain/types";
import { useSession } from "@/features/auth/session.client";

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    cache: "no-store",
    ...init,
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json?.error || `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

const initialForm = {
  title: "",
  description: "",
  url: "",
  language: "zh" as Locale,
  difficulty: "beginner" as VideoDifficulty,
  tags: "",
};

export function AdminVideosWorkspace() {
  const { user } = useSession();
  const locale = user?.locale ?? "zh";
  const [videos, setVideos] = useState<VideoAsset[]>([]);
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadVideos = async () => {
    const data = await apiJson<{ items: VideoAsset[] }>("/api/admin/videos");
    setVideos(data.items);
  };

  useEffect(() => {
    loadVideos().catch((err) => setError(err.message));
  }, []);

  const createVideo = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiJson<{ item: VideoAsset }>("/api/admin/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          tags: form.tags
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
        }),
      });
      setForm(initialForm);
      await loadVideos();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create video");
    } finally {
      setSaving(false);
    }
  };

  const publishVideo = async (id: string) => {
    setError(null);
    try {
      await apiJson(`/api/admin/videos/${id}/publish`, {
        method: "POST",
      });
      await loadVideos();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to publish");
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-3xl border border-black/10 bg-white/85 p-4 shadow-sm backdrop-blur">
        <h1 className="text-xl font-semibold text-zinc-900">
          {locale === "zh" ? "视频库管理" : "Video Library Admin"}
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          {locale === "zh"
            ? "维护外链视频、标签、难度和上下架状态。"
            : "Manage external videos, tags, difficulty, and publish status."}
        </p>
      </div>

      <form onSubmit={createVideo} className="rounded-3xl border border-black/10 bg-white/85 p-4 shadow-sm backdrop-blur">
        <div className="grid gap-3 md:grid-cols-2">
          <input
            required
            value={form.title}
            onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
            placeholder={locale === "zh" ? "标题" : "Title"}
            className="rounded-xl border border-zinc-300 px-3 py-2 text-sm"
          />
          <input
            required
            value={form.url}
            onChange={(event) => setForm((prev) => ({ ...prev, url: event.target.value }))}
            placeholder="https://..."
            className="rounded-xl border border-zinc-300 px-3 py-2 text-sm"
          />
          <textarea
            required
            value={form.description}
            onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
            placeholder={locale === "zh" ? "描述" : "Description"}
            className="rounded-xl border border-zinc-300 px-3 py-2 text-sm md:col-span-2"
            rows={3}
          />
          <select
            value={form.language}
            onChange={(event) => setForm((prev) => ({ ...prev, language: event.target.value as Locale }))}
            className="rounded-xl border border-zinc-300 px-3 py-2 text-sm"
          >
            <option value="zh">中文</option>
            <option value="en">English</option>
          </select>
          <select
            value={form.difficulty}
            onChange={(event) => setForm((prev) => ({ ...prev, difficulty: event.target.value as VideoDifficulty }))}
            className="rounded-xl border border-zinc-300 px-3 py-2 text-sm"
          >
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
          </select>
          <input
            value={form.tags}
            onChange={(event) => setForm((prev) => ({ ...prev, tags: event.target.value }))}
            placeholder={locale === "zh" ? "标签，用逗号分隔" : "Tags, comma separated"}
            className="rounded-xl border border-zinc-300 px-3 py-2 text-sm md:col-span-2"
          />
        </div>

        <button
          type="submit"
          disabled={saving}
          className="mt-3 rounded-full bg-black px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white disabled:opacity-40"
        >
          {saving ? "..." : locale === "zh" ? "新增视频" : "Create Video"}
        </button>
      </form>

      {error ? <p className="text-xs text-rose-600">{error}</p> : null}

      <div className="grid gap-3">
        {videos.map((video) => (
          <article key={video.id} className="rounded-3xl border border-black/10 bg-white/85 p-4 shadow-sm backdrop-blur">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-zinc-900">{video.title}</h2>
                <p className="mt-1 text-xs text-zinc-500">{video.description}</p>
                <p className="mt-1 text-xs text-zinc-500">{video.url}</p>
              </div>
              <span className={`rounded-full px-2 py-1 text-xs font-semibold ${video.status === "published" ? "bg-emerald-100 text-emerald-700" : "bg-zinc-200 text-zinc-700"}`}>
                {video.status}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {video.tags.map((tag) => (
                <span key={`${video.id}-${tag}`} className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600">
                  {tag}
                </span>
              ))}
            </div>
            {video.status !== "published" ? (
              <button
                type="button"
                onClick={() => publishVideo(video.id)}
                className="mt-3 rounded-full border border-black/10 px-3 py-1 text-xs font-semibold hover:bg-zinc-100"
              >
                {locale === "zh" ? "发布" : "Publish"}
              </button>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  );
}
