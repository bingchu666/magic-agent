"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import Link from "next/link";
import { ChatHistoryMessage, FileAsset, LessonPayload, Message, Thread } from "@/lib/domain/types";
import { createId } from "@/lib/domain/utils";
import { useSession } from "@/features/auth/session.client";
import { consumeSseStream } from "@/features/chat-agent/sse";
import { MagicLessonCards } from "@/features/chat-agent/MagicLessonCards";
import { AssistantMarkdown } from "@/features/chat-agent/AssistantMarkdown";
import { t } from "@/lib/ui/i18n";

type UiMessage = Pick<Message, "id" | "role" | "content" | "locale" | "createdAt" | "lessonPayload">;

type ThreadRuntimeState = {
  messages: UiMessage[];
};

function createLocalThread(userId: string, locale: "zh" | "en"): Thread {
  const now = new Date().toISOString();
  return {
    id: createId("thread"),
    userId,
    title: locale === "zh" ? "新对话" : "New Thread",
    createdAt: now,
    updatedAt: now,
  };
}

function buildClientHistory(messages: UiMessage[]): ChatHistoryMessage[] {
  return messages
    .filter((item) => item.role === "user" || item.role === "assistant")
    .filter((item) => item.content.trim().length > 0)
    .slice(-30)
    .map((item) => ({
      role: item.role as "user" | "assistant",
      content: item.content,
    }));
}

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    cache: "no-store",
    ...init,
  });

  const contentType = res.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");

  if (!res.ok) {
    if (isJson) {
      const json = await res.json().catch(() => ({}));
      throw new Error(json?.error || `Request failed: ${res.status}`);
    }
    const text = await res.text().catch(() => "");
    throw new Error(text || `Request failed: ${res.status}`);
  }

  if (!isJson) {
    throw new Error("Unexpected non-JSON response");
  }

  return res.json() as Promise<T>;
}

export function ChatWorkspace() {
  const { user, loading: sessionLoading } = useSession();
  const locale = user?.locale ?? "zh";
  const copy = t(locale);

  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [files, setFiles] = useState<FileAsset[]>([]);
  const [selectedAttachments, setSelectedAttachments] = useState<string[]>([]);
  const [uploadingAttachments, setUploadingAttachments] = useState(false);
  const [deletingThreadId, setDeletingThreadId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const activeThreadRef = useRef<string | null>(null);
  const threadStoreRef = useRef<Record<string, ThreadRuntimeState>>({});
  const initializedRef = useRef(false);

  const readyFiles = useMemo(() => files.filter((file) => file.status === "ready"), [files]);

  const clearConversationState = () => {
    setMessages([]);
  };

  const touchThread = (threadId: string) => {
    const now = new Date().toISOString();
    setThreads((prev) => {
      const next = prev.map((thread) =>
        thread.id === threadId ? { ...thread, updatedAt: now } : thread
      );
      next.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
      return next;
    });
  };

  const loadFiles = async () => {
    const data = await apiJson<{ items: FileAsset[] }>("/api/files");
    setFiles(data.items);
  };

  const reconcileThreadId = (localThreadId: string, serverThreadId: string) => {
    if (!localThreadId || !serverThreadId || localThreadId === serverThreadId) return;

    const previous = threadStoreRef.current[localThreadId];
    const existing = threadStoreRef.current[serverThreadId];
    if (previous) {
      threadStoreRef.current[serverThreadId] = existing
        ? {
            messages: [...existing.messages, ...previous.messages].filter(
              (item, idx, arr) => idx === arr.findIndex((x) => x.id === item.id)
            ),
          }
        : previous;
      delete threadStoreRef.current[localThreadId];
    }

    setThreads((prev) => {
      const from = prev.find((thread) => thread.id === localThreadId);
      if (!from) return prev;
      const now = new Date().toISOString();
      const withoutLocal = prev.filter((thread) => thread.id !== localThreadId);
      const hasServer = withoutLocal.some((thread) => thread.id === serverThreadId);
      if (hasServer) {
        return withoutLocal.map((thread) =>
          thread.id === serverThreadId ? { ...thread, updatedAt: now } : thread
        );
      }
      return [{ ...from, id: serverThreadId, updatedAt: now }, ...withoutLocal];
    });

    if (activeThreadRef.current === localThreadId) {
      activeThreadRef.current = serverThreadId;
      setActiveThreadId(serverThreadId);
    }
  };

  const loadThreadMessagesFromServer = async (threadId: string) => {
    try {
      const data = await apiJson<{ items: Message[] }>(`/api/threads/${threadId}/messages`);
      const uiMessages: UiMessage[] = data.items.map((item) => ({
        id: item.id,
        role: item.role,
        content: item.content,
        locale: item.locale,
        createdAt: item.createdAt,
        lessonPayload: item.lessonPayload,
      }));
      threadStoreRef.current[threadId] = { messages: uiMessages };
      if (activeThreadRef.current === threadId) {
        setMessages(uiMessages);
      }
    } catch {
      // Server unreachable — keep whatever local cache already has for this thread.
    }
  };

  const syncThreadsFromServer = async () => {
    try {
      const data = await apiJson<{ items: Thread[] }>("/api/threads");
      const serverThreads = data.items;
      if (serverThreads.length === 0) return;

      // Server is the source of truth once it responds: replace the local/placeholder
      // thread list rather than merging, so stale or deleted-elsewhere threads don't linger.
      setThreads(serverThreads);

      const preferredActive = activeThreadRef.current;
      const nextActive =
        preferredActive && serverThreads.some((thread) => thread.id === preferredActive)
          ? preferredActive
          : serverThreads[0].id;

      if (nextActive !== activeThreadRef.current) {
        setActiveThreadId(nextActive);
      }

      await loadThreadMessagesFromServer(nextActive);
    } catch {
      // Offline or request failed — keep rendering whatever the local cache produced.
    }
  };

  useEffect(() => {
    activeThreadRef.current = activeThreadId;
  }, [activeThreadId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Wait until the session has actually resolved — while loading, user?.id is
    // transiently undefined and we must not key the cache to the "guest" bucket.
    if (sessionLoading) return;
    initializedRef.current = false;

    const storageKey = `magic_chat_state_v4:${user?.id ?? "guest"}`;
    let initialized = false;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          activeThreadId?: string | null;
          threads?: Array<{ thread: Thread; state?: ThreadRuntimeState }>;
        };
        const parsedThreads = Array.isArray(parsed?.threads)
          ? parsed.threads
              .map((item) => item?.thread)
              .filter((thread): thread is Thread => Boolean(thread?.id))
          : [];

        if (parsedThreads.length > 0) {
          setThreads(parsedThreads);
          threadStoreRef.current = {};
          for (const item of parsed.threads ?? []) {
            if (!item?.thread?.id || !item?.state) continue;
            threadStoreRef.current[item.thread.id] = {
              messages: Array.isArray(item.state.messages) ? item.state.messages : [],
            };
          }
          const preferred =
            parsed.activeThreadId && parsedThreads.some((thread) => thread.id === parsed.activeThreadId)
              ? parsed.activeThreadId
              : parsedThreads[0].id;
          setActiveThreadId(preferred);
          initialized = true;
        }
      }
    } catch {
      // Ignore invalid local cache and rebuild a clean one.
    }

    if (!initialized) {
      const first = createLocalThread(user?.id ?? "guest", locale);
      setThreads([first]);
      threadStoreRef.current = {
        [first.id]: {
          messages: [],
        },
      };
      setActiveThreadId(first.id);
    }
    initializedRef.current = true;

    loadFiles().catch((err) => setError(err.message));

    // localStorage above is only a fast first paint / offline fallback. Once logged in,
    // the server's threads/messages tables are the source of truth and override it here.
    if (user?.id) {
      void syncThreadsFromServer();
    }
  }, [user?.id, sessionLoading, locale]);

  useEffect(() => {
    if (!activeThreadId) {
      clearConversationState();
      return;
    }

    const state = threadStoreRef.current[activeThreadId];
    if (!state) {
      clearConversationState();
      return;
    }

    setMessages(state.messages || []);
  }, [activeThreadId]);

  useEffect(() => {
    if (!activeThreadId) return;
    threadStoreRef.current[activeThreadId] = {
      messages,
    };
  }, [activeThreadId, messages]);

  useEffect(() => {
    if (!initializedRef.current) return;
    if (typeof window === "undefined") return;
    const storageKey = `magic_chat_state_v4:${user?.id ?? "guest"}`;
    const serialized = {
      activeThreadId,
      threads: threads.map((thread) => ({
        thread,
        state: threadStoreRef.current[thread.id] || {
          messages: [],
        },
      })),
    };
    window.localStorage.setItem(storageKey, JSON.stringify(serialized));
  }, [threads, activeThreadId, user?.id, messages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending]);

  const statusText = (status: FileAsset["status"]) => {
    if (status === "ready") return copy.ready;
    if (status === "processing") return copy.processing;
    if (status === "failed") return copy.failed;
    if (status === "expired") return copy.expired;
    return "Uploaded";
  };

  const sendMessage = async (prefill?: string) => {
    const content = (prefill ?? input).trim();
    if (!content || sending) return;

    setSending(true);
    setError(null);

    const userMessage: UiMessage = {
      id: createId("local_user"),
      role: "user",
      content,
      locale,
      createdAt: new Date().toISOString(),
    };

    const assistantMessageId = createId("local_assistant");

    setMessages((prev) => [
      ...prev,
      userMessage,
      {
        id: assistantMessageId,
        role: "assistant",
        content: "",
        locale,
        createdAt: new Date().toISOString(),
      },
    ]);

    setInput("");

    try {
      let threadId = activeThreadId;
      if (!threadId) {
        const thread = createLocalThread(user?.id ?? "guest", locale);
        threadId = thread.id;
        setActiveThreadId(thread.id);
        setThreads((prev) => [thread, ...prev.filter((item) => item.id !== thread.id)]);
      } else {
        touchThread(threadId);
      }

      // The latest user message is sent separately as userMessage. History only
      // contains completed prior turns so the model never receives it twice.
      const historyForRequest = buildClientHistory(messages);
      let pendingTokenText = "";
      let tokenFlushTimer: number | null = null;
      const flushPendingTokens = () => {
        tokenFlushTimer = null;
        const text = pendingTokenText;
        pendingTokenText = "";
        if (!text) return;
        setMessages((prev) =>
          prev.map((message) =>
            message.id === assistantMessageId
              ? { ...message, content: `${message.content}${text}` }
              : message
          )
        );
      };
      const queueToken = (text: string) => {
        pendingTokenText += text;
        if (tokenFlushTimer !== null) return;
        tokenFlushTimer = window.setTimeout(flushPendingTokens, 32);
      };
      const res = await fetch("/api/chat/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          threadId,
          userMessage: content,
          locale,
          attachmentIds: selectedAttachments,
          clientHistory: historyForRequest,
        }),
      });

      if (!res.ok) {
        const contentType = res.headers.get("content-type") || "";
        const text = contentType.includes("text/html")
          ? ""
          : await res.text().catch(() => "");
        throw new Error(
          text ||
            (locale === "zh"
              ? `聊天服务暂时不可用（${res.status}）`
              : `Chat service is temporarily unavailable (${res.status})`)
        );
      }

      await consumeSseStream(res, {
        thread: (payload) => {
          if (!threadId) return;
          if (payload.threadId && payload.threadId !== threadId) {
            reconcileThreadId(threadId, payload.threadId);
            threadId = payload.threadId;
          }
        },
        token: (payload) => {
          queueToken(payload.text);
        },
        cards: (payload) => {
          if (tokenFlushTimer !== null) window.clearTimeout(tokenFlushTimer);
          flushPendingTokens();
          setMessages((prev) =>
            prev.map((message) =>
              message.id === assistantMessageId
                ? {
                    ...message,
                    lessonPayload: payload as LessonPayload,
                    content: message.content || payload.summary,
                  }
                : message
            )
          );
        },
        video_recommendations: () => {},
        done: () => {
          if (tokenFlushTimer !== null) window.clearTimeout(tokenFlushTimer);
          flushPendingTokens();
        },
        error: (payload) => {
          if (tokenFlushTimer !== null) window.clearTimeout(tokenFlushTimer);
          flushPendingTokens();
          setError(payload.message);
        },
      });
      if (tokenFlushTimer !== null) window.clearTimeout(tokenFlushTimer);
      flushPendingTokens();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      const fallbackText = locale === "zh" ? "请求失败，请稍后重试。" : "Request failed. Please retry.";
      setError(msg);

      setMessages((prev) =>
        prev.map((message) =>
          message.id === assistantMessageId
            ? message.content.trim().length > 0
              ? message
              : {
                  ...message,
                  content: fallbackText,
                }
            : message
        )
      );
    } finally {
      setSending(false);
    }
  };

  const uploadFromComposer = async (list: FileList | null) => {
    if (!list || list.length === 0 || uploadingAttachments) return;
    setUploadingAttachments(true);
    setError(null);

    const uploadedIds: string[] = [];
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
        uploadedIds.push(presign.fileId);
      }

      await loadFiles();
      setSelectedAttachments((prev) => Array.from(new Set([...prev, ...uploadedIds])));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadingAttachments(false);
    }
  };

  const removeThread = async (threadId: string) => {
    setDeletingThreadId(threadId);
    setError(null);
    try {
      await apiJson(`/api/threads/${threadId}`, { method: "DELETE" });

      setThreads((prev) => {
        const next = prev.filter((item) => item.id !== threadId);
        if (activeThreadRef.current === threadId) {
          if (!next.length) {
            const fallback = createLocalThread(user?.id ?? "guest", locale);
            threadStoreRef.current[fallback.id] = {
              messages: [],
            };
            setActiveThreadId(fallback.id);
            return [fallback];
          }
          setActiveThreadId(next[0].id);
        }
        delete threadStoreRef.current[threadId];
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete thread failed");
    } finally {
      setDeletingThreadId(null);
    }
  };

  return (
    <div className="grid h-full min-w-0 grid-cols-1 gap-4 overflow-x-hidden xl:grid-cols-[240px_minmax(0,1fr)_300px]">
      <section className="h-full min-w-0 overflow-y-auto overflow-x-hidden rounded-2xl border border-zinc-200 bg-white p-3">
        <div className="mb-3 grid grid-cols-3 gap-1 rounded-xl bg-zinc-100 p-1">
          <Link href="/chat" className="rounded-lg bg-[#202123] px-2 py-1.5 text-center text-xs font-semibold text-white">
            {copy.chat}
          </Link>
          <Link href="/files" className="rounded-lg px-2 py-1.5 text-center text-xs font-semibold text-zinc-700 hover:bg-white">
            {copy.files}
          </Link>
          <Link href="/settings" className="rounded-lg px-2 py-1.5 text-center text-xs font-semibold text-zinc-700 hover:bg-white">
            {copy.settings}
          </Link>
        </div>

        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-600">
            {locale === "zh" ? "对话" : "Threads"}
          </h2>
          <button
            type="button"
            onClick={async () => {
              try {
                const thread = createLocalThread(user?.id ?? "guest", locale);
                setThreads((prev) => [thread, ...prev.filter((item) => item.id !== thread.id)]);
                threadStoreRef.current[thread.id] = {
                  messages: [],
                };
                setActiveThreadId(thread.id);
                clearConversationState();
                setError(null);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Failed to create thread");
              }
            }}
            className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-semibold text-zinc-700 hover:bg-zinc-100"
          >
            {copy.newThread}
          </button>
        </div>

        <div className="space-y-2">
          {threads.map((thread) => (
            <div
              key={thread.id}
              className={clsx(
                "w-full rounded-xl border px-2 py-2 transition",
                activeThreadId === thread.id
                  ? "border-[#202123] bg-[#202123] text-white"
                  : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
              )}
            >
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setActiveThreadId(thread.id);
                    if (user?.id) void loadThreadMessagesFromServer(thread.id);
                  }}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="truncate text-sm font-semibold">{thread.title}</p>
                  <p className={clsx("mt-1 text-xs", activeThreadId === thread.id ? "text-zinc-300" : "text-zinc-500")}>
                    {new Date(thread.updatedAt).toLocaleString()}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => void removeThread(thread.id)}
                  disabled={deletingThreadId === thread.id}
                  className={clsx(
                    "rounded-md px-2 py-1 text-xs font-semibold",
                    activeThreadId === thread.id
                      ? "bg-white/15 text-white hover:bg-white/25"
                      : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                  )}
                >
                  {deletingThreadId === thread.id ? "..." : locale === "zh" ? "删" : "Del"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white">
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {!messages.length ? (
            <div className="grid h-full place-items-center rounded-2xl border border-dashed border-zinc-300 bg-zinc-50">
              <div className="text-center">
                <h3 className="text-2xl font-semibold text-zinc-900">Magic Agent</h3>
                <p className="mt-1 text-sm text-zinc-500">
                  {locale === "zh"
                    ? "告诉我你要练什么：纸牌、硬币、舞台、台词、流程。"
                    : "Tell me what you want to practice: cards, coins, stage, script, or routine."}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {messages.map((message) => (
                <div key={message.id} className={clsx("flex", message.role === "user" ? "justify-end" : "justify-start")}>
                  <div
                    className={clsx(
                      "max-w-[92%] break-words rounded-2xl px-4 py-3 text-[15px] leading-7",
                      message.role === "user"
                        ? "bg-[#202123] text-white"
                        : "border border-zinc-200 bg-zinc-50 text-zinc-800"
                    )}
                  >
                    {message.role === "assistant" && message.lessonPayload ? (
                      <MagicLessonCards
                        payload={message.lessonPayload}
                        locale={locale}
                        onQuickAsk={(prompt) => {
                          void sendMessage(prompt);
                        }}
                      />
                    ) : message.role === "assistant" ? (
                      <AssistantMarkdown content={message.content || (sending ? "..." : "")} />
                    ) : (
                      <p className="whitespace-pre-wrap">{message.content || (sending ? "..." : "")}</p>
                    )}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        <div className="border-t border-zinc-200 p-3">
          <div className="rounded-2xl border border-zinc-300 bg-white p-2">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={copy.chatInputPlaceholder}
              rows={3}
              className="w-full resize-none rounded-xl border border-transparent px-3 py-2 text-sm outline-none focus:border-zinc-300"
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void sendMessage();
                }
              }}
            />
            <div className="mt-2 flex items-center justify-between gap-3">
              <p className="truncate text-xs text-zinc-500">
                {selectedAttachments.length > 0
                  ? `${copy.attach}: ${selectedAttachments.length}`
                  : copy.uploadHint}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => uploadInputRef.current?.click()}
                  disabled={uploadingAttachments}
                  className="rounded-full border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 disabled:opacity-60"
                >
                  {uploadingAttachments ? "..." : copy.attach}
                </button>
                <button
                  type="button"
                  onClick={() => void sendMessage()}
                  disabled={!input.trim() || sending}
                  className="rounded-full bg-[#202123] px-5 py-2 text-xs font-semibold uppercase tracking-wide text-white disabled:opacity-40"
                >
                  {sending ? "..." : copy.send}
                </button>
              </div>
            </div>
            <input
              ref={uploadInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => {
                void uploadFromComposer(event.target.files);
                event.currentTarget.value = "";
              }}
            />
          </div>
          {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
        </div>
      </section>

      <section className="h-full min-w-0 space-y-3 overflow-y-auto overflow-x-hidden rounded-2xl border border-zinc-200 bg-white p-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-600">{copy.rightPanelFiles}</h2>
        <div className="space-y-2">
          {files.length === 0 ? (
            <p className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-500">
              {locale === "zh" ? "暂无文件，可到文件页上传后回到这里附加。" : "No files yet. Upload from Files page and attach here."}
            </p>
          ) : (
            files.map((file) => {
              const checked = selectedAttachments.includes(file.id);
              return (
                <label
                  key={file.id}
                  className={clsx(
                    "flex cursor-pointer items-start gap-2 rounded-xl border p-3",
                    checked ? "border-[#202123] bg-zinc-100" : "border-zinc-200 bg-zinc-50"
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={file.status !== "ready"}
                    onChange={(event) => {
                      if (event.target.checked) {
                        setSelectedAttachments((prev) => [...prev, file.id]);
                      } else {
                        setSelectedAttachments((prev) => prev.filter((id) => id !== file.id));
                      }
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-zinc-800">{file.fileName}</p>
                    <p className="text-xs text-zinc-500">{statusText(file.status)}</p>
                  </div>
                </label>
              );
            })
          )}
        </div>

        {readyFiles.length > 0 ? (
          <button
            type="button"
            onClick={() => setSelectedAttachments(readyFiles.slice(0, 2).map((item) => item.id))}
            className="w-full rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-100"
          >
            {locale === "zh" ? "附加最近文件" : "Attach recent files"}
          </button>
        ) : null}
      </section>
    </div>
  );
}
