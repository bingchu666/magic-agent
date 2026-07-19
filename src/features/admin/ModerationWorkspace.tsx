"use client";

import { useEffect, useState } from "react";
import { AuditLog, Event } from "@/lib/domain/types";
import { useSession } from "@/features/auth/session.client";

type ModerationResponse = {
  audits: AuditLog[];
  events: Event[];
};

async function apiJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json?.error || `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function ModerationWorkspace() {
  const { user } = useSession();
  const locale = user?.locale ?? "zh";
  const [audits, setAudits] = useState<AuditLog[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    const data = await apiJson<ModerationResponse>("/api/admin/moderation");
    setAudits(data.audits);
    setEvents(data.events);
  };

  useEffect(() => {
    loadData().catch((err) => setError(err.message));
  }, []);

  return (
    <div className="space-y-4">
      <div className="rounded-3xl border border-black/10 bg-white/85 p-4 shadow-sm backdrop-blur">
        <h1 className="text-xl font-semibold text-zinc-900">
          {locale === "zh" ? "安全与审计" : "Safety and Audit"}
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          {locale === "zh"
            ? "查看安全降级记录、关键事件与可观测日志。"
            : "Review safety downgrades, key events, and observability logs."}
        </p>
      </div>

      {error ? <p className="text-xs text-rose-600">{error}</p> : null}

      <section className="rounded-3xl border border-black/10 bg-white/85 p-4 shadow-sm backdrop-blur">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-600">
          {locale === "zh" ? "审计日志" : "Audit Logs"}
        </h2>
        <div className="mt-3 space-y-2">
          {audits.length === 0 ? (
            <p className="text-xs text-zinc-500">No audit entries.</p>
          ) : (
            audits.map((log) => (
              <article key={log.id} className="rounded-2xl border border-black/10 bg-zinc-50 p-3">
                <p className="text-xs font-semibold text-zinc-700">{log.action}</p>
                <p className="mt-1 text-xs text-zinc-600">{log.details}</p>
                <p className="mt-1 text-[11px] text-zinc-500">{new Date(log.createdAt).toLocaleString()}</p>
              </article>
            ))
          )}
        </div>
      </section>

      <section className="rounded-3xl border border-black/10 bg-white/85 p-4 shadow-sm backdrop-blur">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-600">
          {locale === "zh" ? "事件日志" : "Events"}
        </h2>
        <div className="mt-3 space-y-2">
          {events.length === 0 ? (
            <p className="text-xs text-zinc-500">No events yet.</p>
          ) : (
            events.slice(0, 80).map((event) => (
              <article key={event.id} className="rounded-2xl border border-black/10 bg-zinc-50 p-3">
                <p className="text-xs font-semibold text-zinc-700">{event.name}</p>
                <p className="mt-1 text-xs text-zinc-600">{JSON.stringify(event.payload)}</p>
                <p className="mt-1 text-[11px] text-zinc-500">{new Date(event.createdAt).toLocaleString()}</p>
              </article>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
