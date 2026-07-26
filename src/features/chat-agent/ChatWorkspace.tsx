"use client";

import { type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import Link from "next/link";
import {
  FilePlus2,
  FileText,
  ArrowUpRight,
  MessageCircleMore,
  Network,
  Paperclip,
  Plus,
  Send,
  Sparkles,
  Wand2,
  X,
} from "lucide-react";
import { ChatHistoryMessage, FileAsset, LessonPayload, Message, Thread } from "@/lib/domain/types";
import { createId } from "@/lib/domain/utils";
import { useSession } from "@/features/auth/session.client";
import { consumeSseStream } from "@/features/chat-agent/sse";
import { MagicLessonCards } from "@/features/chat-agent/MagicLessonCards";
import { AssistantMarkdown } from "@/features/chat-agent/AssistantMarkdown";
import { MiniTreeMap, type MiniTreeNode } from "@/lib/ui/MiniTreeMap";
import { t } from "@/lib/ui/i18n";

type UiMessage = Pick<Message, "id" | "role" | "content" | "locale" | "createdAt" | "lessonPayload">;

type ThreadRuntimeState = {
  messages: UiMessage[];
  conceptParentByMessage?: Record<string, string>;
};

type KeywordPopup = {
  messageId: string;
  term: string;
  explanation: string;
  question: string;
  loading: boolean;
  error: string;
  x: number;
  y: number;
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

function extractConceptTerms(messages: UiMessage[]) {
  const terms: Array<{ term: string; messageId: string }> = [];
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    const annotated = Array.from(message.content.matchAll(/\[\[([^\]]+)\]\]/g)).map(
      (match) => match[1].trim()
    );
    const emphasized = Array.from(message.content.matchAll(/\*\*([^*\n]{2,24})\*\*/g)).map(
      (match) => match[1].trim()
    );
    for (const term of [...annotated, ...emphasized]) {
      if (!term || terms.some((item) => item.term === term)) continue;
      terms.push({ term, messageId: message.id });
    }
  }
  return terms.slice(-6);
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
  const { user } = useSession();
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
  const [keywordPopup, setKeywordPopup] = useState<KeywordPopup | null>(null);
  const [mapFocusId, setMapFocusId] = useState("chat-root");
  const [conceptParentByMessage, setConceptParentByMessage] = useState<Record<string, string>>({});

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const activeThreadRef = useRef<string | null>(null);
  const threadStoreRef = useRef<Record<string, ThreadRuntimeState>>({});
  const initializedRef = useRef(false);

  const readyFiles = useMemo(() => files.filter((file) => file.status === "ready"), [files]);
  const conceptTerms = useMemo(() => extractConceptTerms(messages), [messages]);
  const chatMapNodes = useMemo<MiniTreeNode[]>(
    () => [
      {
        id: "chat-root",
        parentId: null,
        label:
          threads.find((thread) => thread.id === activeThreadId)?.title ??
          (locale === "zh" ? "当前主题" : "Current topic"),
        relation: "root",
      },
      ...conceptTerms.map((concept) => ({
        id: `${concept.messageId}:${concept.term}`,
        parentId: conceptParentByMessage[concept.messageId] ?? "chat-root",
        label: concept.term,
        relation: "child" as const,
      })),
    ],
    [activeThreadId, conceptParentByMessage, conceptTerms, locale, threads]
  );

  const clearConversationState = () => {
    setMessages([]);
    setKeywordPopup(null);
    setMapFocusId("chat-root");
    setConceptParentByMessage({});
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
            conceptParentByMessage: {
              ...(existing.conceptParentByMessage ?? {}),
              ...(previous.conceptParentByMessage ?? {}),
            },
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

  useEffect(() => {
    activeThreadRef.current = activeThreadId;
  }, [activeThreadId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
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
              conceptParentByMessage: item.state.conceptParentByMessage ?? {},
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
  }, [user?.id, locale]);

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
    setConceptParentByMessage(state.conceptParentByMessage ?? {});
  }, [activeThreadId]);

  useEffect(() => {
    if (!activeThreadId) return;
    threadStoreRef.current[activeThreadId] = {
      messages,
      conceptParentByMessage,
    };
  }, [activeThreadId, conceptParentByMessage, messages]);

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
  }, [threads, activeThreadId, user?.id, messages, conceptParentByMessage]);

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

  const sendMessage = async (prefill?: string, parentConceptId = "chat-root") => {
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
    setConceptParentByMessage((previous) => ({
      ...previous,
      [assistantMessageId]: parentConceptId,
    }));

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
          responseMode: "annotated",
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

  const openKeywordPopup = async (
    message: UiMessage,
    term: string,
    event: MouseEvent<HTMLButtonElement>
  ) => {
    if (keywordPopup?.messageId === message.id && keywordPopup.term === term) {
      setKeywordPopup(null);
      return;
    }

    const wrapper = event.currentTarget.closest(".magic-message-bubble-wrap");
    const wrapperRect = wrapper?.getBoundingClientRect();
    const buttonRect = event.currentTarget.getBoundingClientRect();
    const x = wrapperRect
      ? Math.max(0, Math.min(buttonRect.left - wrapperRect.left, wrapperRect.width - 290))
      : 0;
    const y = wrapperRect ? buttonRect.bottom - wrapperRect.top + 8 : 34;
    const next: KeywordPopup = {
      messageId: message.id,
      term,
      explanation: "",
      question: "",
      loading: true,
      error: "",
      x,
      y,
    };
    setKeywordPopup(next);
    setMapFocusId(`${message.id}:${term}`);

    try {
      const response = await fetch("/api/explore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "preview",
          locale,
          term,
          context: message.content,
        }),
      });
      const data = (await response.json()) as { text?: string; error?: string };
      if (!response.ok || !data.text) throw new Error(data.error || "Preview failed");
      setKeywordPopup((current) =>
        current?.messageId === message.id && current.term === term
          ? { ...current, explanation: data.text ?? "", loading: false }
          : current
      );
    } catch (previewError) {
      setKeywordPopup((current) =>
        current?.messageId === message.id && current.term === term
          ? {
              ...current,
              loading: false,
              error: previewError instanceof Error ? previewError.message : "Preview failed",
            }
          : current
      );
    }
  };

  const followUpKeyword = () => {
    if (!keywordPopup) return;
    const parentConceptId = `${keywordPopup.messageId}:${keywordPopup.term}`;
    const question = keywordPopup.question.trim();
    const prompt = question
      ? `关于你刚才提到的“${keywordPopup.term}”：${question}`
      : `请结合刚才的回答，进一步解释“${keywordPopup.term}”，并给一个具体例子。`;
    setKeywordPopup(null);
    setMapFocusId(parentConceptId);
    void sendMessage(prompt, parentConceptId);
  };

  return (
    <div className="magic-chat-studio grid h-full min-w-0 grid-cols-1 gap-4 overflow-x-hidden xl:grid-cols-[240px_minmax(0,1fr)_300px]">
      <section className="magic-chat-panel magic-thread-panel h-full min-w-0 overflow-y-auto overflow-x-hidden rounded-2xl border border-zinc-200 bg-white p-3">
        <div className="magic-chat-tabs mb-3 grid grid-cols-4 gap-1 rounded-xl bg-zinc-100 p-1">
          <Link href="/chat" className="is-active rounded-lg bg-[#202123] px-2 py-1.5 text-center text-xs font-semibold text-white">
            {copy.chat}
          </Link>
          <Link href="/explore" className="rounded-lg px-2 py-1.5 text-center text-xs font-semibold text-zinc-700 hover:bg-white" title={copy.explore}>
            <Network size={14} />
            <span>{copy.explore}</span>
          </Link>
          <Link href="/files" className="rounded-lg px-2 py-1.5 text-center text-xs font-semibold text-zinc-700 hover:bg-white" title={copy.files}>
            <FileText size={14} />
            <span>{copy.files}</span>
          </Link>
          <Link href="/settings" className="rounded-lg px-2 py-1.5 text-center text-xs font-semibold text-zinc-700 hover:bg-white" title={copy.settings}>
            <Wand2 size={14} />
            <span>{copy.settings}</span>
          </Link>
        </div>

        <div className="magic-thread-heading mb-3 flex items-center justify-between">
          <div>
            <span>{locale === "zh" ? "Conversation library" : "Conversation library"}</span>
            <h2>
              <MessageCircleMore size={16} />
              {locale === "zh" ? "对话档案" : "Threads"}
            </h2>
          </div>
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
            aria-label={copy.newThread}
            title={copy.newThread}
          >
            <Plus size={16} />
          </button>
        </div>

        <div className="magic-thread-list space-y-2">
          {threads.map((thread, index) => (
            <div
              key={thread.id}
              className={clsx(
                "magic-thread-card w-full rounded-xl border px-2 py-2 transition",
                activeThreadId === thread.id && "is-active"
              )}
            >
              <div className="flex items-start gap-2">
                <span className="magic-thread-number">{String(index + 1).padStart(2, "0")}</span>
                <button
                  type="button"
                  onClick={() => setActiveThreadId(thread.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="truncate text-sm font-semibold">{thread.title}</p>
                  <p className="mt-1 text-xs">
                    {new Date(thread.updatedAt).toLocaleString()}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => void removeThread(thread.id)}
                  disabled={deletingThreadId === thread.id}
                  className="magic-thread-delete"
                  aria-label={locale === "zh" ? "删除对话" : "Delete thread"}
                >
                  {deletingThreadId === thread.id ? "…" : "×"}
                </button>
              </div>
            </div>
          ))}
        </div>

        <Link href="/explore" className="magic-thread-atlas-cta">
          <span>
            <Network size={16} />
          </span>
          <div>
            <strong>{locale === "zh" ? "换一种思考方式" : "Think non-linearly"}</strong>
            <small>{locale === "zh" ? "把这次对话放进层级卡片" : "Open the card-based workspace"}</small>
          </div>
        </Link>
      </section>

      <section className="magic-chat-panel magic-conversation-panel flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white">
        <div className="magic-conversation-header">
          <div>
            <span>
              <i />
              {locale === "zh" ? "AI 陪练已就绪" : "AI coach ready"}
            </span>
            <h1>{threads.find((thread) => thread.id === activeThreadId)?.title ?? (locale === "zh" ? "新对话" : "New conversation")}</h1>
          </div>
          <div className="magic-model-pill">
            <Sparkles size={13} />
            Deep reasoning
          </div>
        </div>

        <div className="magic-message-scroll flex-1 overflow-y-auto px-4 py-4">
          {!messages.length ? (
            <div className="magic-chat-empty">
              <div className="magic-empty-orbit">
                <Sparkles size={25} />
                <i />
                <i />
              </div>
              <span>{locale === "zh" ? "从一个目标开始" : "Start with a goal"}</span>
              <h3>{locale === "zh" ? "今天想把什么练明白？" : "What do you want to master today?"}</h3>
              <p>
                {locale === "zh"
                  ? "描述你的场景、道具或卡住的环节。我会把答案拆成可行动的练习。"
                  : "Describe the scene, prop, or blocker. I’ll turn it into actionable practice."}
              </p>
              <div className="magic-prompt-suggestions">
                {[
                  locale === "zh" ? "设计一个三分钟纸牌流程" : "Build a 3-minute card routine",
                  locale === "zh" ? "分析我的舞台节奏" : "Analyze my stage pacing",
                  locale === "zh" ? "制定一周手法练习计划" : "Plan a week of sleight practice",
                ].map((prompt) => (
                  <button key={prompt} type="button" onClick={() => void sendMessage(prompt)}>
                    {prompt}
                    <Send size={13} />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="magic-message-list space-y-5">
              {messages.map((message) => (
                <div
                  key={message.id}
                  data-message-id={message.id}
                  className={clsx("magic-message-row flex", message.role === "user" ? "is-user justify-end" : "is-assistant justify-start")}
                >
                  {message.role === "assistant" ? (
                    <div className="magic-message-avatar">
                      <Sparkles size={14} />
                    </div>
                  ) : null}
                  <div className="magic-message-bubble-wrap">
                    <div
                      className={clsx(
                        "magic-message-bubble max-w-[92%] break-words rounded-2xl px-4 py-3 text-[15px] leading-7",
                        message.role === "user" ? "is-user" : "is-assistant"
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
                        <AssistantMarkdown
                          content={message.content || (sending ? "..." : "")}
                          onConcept={(term, event) => void openKeywordPopup(message, term, event)}
                        />
                      ) : (
                        <p className="whitespace-pre-wrap">{message.content || (sending ? "..." : "")}</p>
                      )}
                    </div>

                    {keywordPopup?.messageId === message.id ? (
                      <aside
                        className="magic-keyword-popover"
                        style={{ left: keywordPopup.x, top: keywordPopup.y }}
                      >
                        <header>
                          <div>
                            <span>Concept preview</span>
                            <h3>{keywordPopup.term}</h3>
                          </div>
                          <button type="button" onClick={() => setKeywordPopup(null)} aria-label="关闭关键词卡片">
                            <X size={14} />
                          </button>
                        </header>

                        <div className="magic-keyword-explanation">
                          {keywordPopup.loading ? (
                            <p className="is-loading">
                              <i />
                              {locale === "zh" ? "正在结合上下文解释…" : "Explaining in context…"}
                            </p>
                          ) : (
                            <p>{keywordPopup.error || keywordPopup.explanation}</p>
                          )}
                        </div>

                        <div className="magic-keyword-followup">
                          <input
                            value={keywordPopup.question}
                            onChange={(event) =>
                              setKeywordPopup((current) =>
                                current ? { ...current, question: event.target.value } : current
                              )
                            }
                            onKeyDown={(event) => {
                              if (event.nativeEvent.isComposing) return;
                              if (event.key === "Enter") {
                                event.preventDefault();
                                followUpKeyword();
                              }
                            }}
                            placeholder={locale === "zh" ? `追问“${keywordPopup.term}”…` : `Ask about "${keywordPopup.term}"…`}
                          />
                          <button type="button" onClick={followUpKeyword} aria-label={locale === "zh" ? "追问关键词" : "Ask follow-up"}>
                            <ArrowUpRight size={14} />
                          </button>
                        </div>
                      </aside>
                    ) : null}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        <div className="magic-composer-wrap border-t border-zinc-200 p-3">
          <div className="magic-composer rounded-2xl border border-zinc-300 bg-white p-2">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={copy.chatInputPlaceholder}
              rows={3}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void sendMessage();
                }
              }}
            />
            <div className="magic-composer-actions">
              <p>
                {selectedAttachments.length > 0
                  ? `${copy.attach}: ${selectedAttachments.length}`
                  : locale === "zh"
                    ? "Enter 发送 · Shift + Enter 换行"
                    : "Enter to send · Shift + Enter for a new line"}
              </p>
              <div>
                <button
                  type="button"
                  onClick={() => uploadInputRef.current?.click()}
                  disabled={uploadingAttachments}
                  className="magic-attach-button"
                >
                  {uploadingAttachments ? <span>…</span> : <Paperclip size={15} />}
                  {copy.attach}
                </button>
                <button
                  type="button"
                  onClick={() => void sendMessage()}
                  disabled={!input.trim() || sending}
                  className="magic-send-button"
                >
                  {sending ? <span>…</span> : <Send size={15} />}
                  {copy.send}
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
          {error ? <p className="magic-chat-error">{error}</p> : null}
        </div>
      </section>

      <section className="magic-chat-panel magic-context-panel h-full min-w-0 space-y-3 overflow-y-auto overflow-x-hidden rounded-2xl border border-zinc-200 bg-white p-3">
        <div className="magic-context-heading">
          <span>
            <FilePlus2 size={16} />
          </span>
          <div>
            <small>{locale === "zh" ? "Grounding context" : "Grounding context"}</small>
            <h2>{copy.rightPanelFiles}</h2>
          </div>
        </div>
        <p className="magic-context-intro">
          {locale === "zh"
            ? "勾选资料后，AI 会把其中的解析结果作为本次对话依据。"
            : "Select sources to ground this conversation in their extracted insights."}
        </p>
        <MiniTreeMap
          nodes={chatMapNodes}
          activeId={mapFocusId}
          onSelect={(nodeId) => {
            setMapFocusId(nodeId);
            if (nodeId === "chat-root") {
              const firstMessage = document.querySelector<HTMLElement>("[data-message-id]");
              firstMessage?.scrollIntoView({ behavior: "smooth", block: "center" });
              return;
            }
            const selected = chatMapNodes.find((node) => node.id === nodeId);
            const messageId = conceptTerms.find(
              (concept) => `${concept.messageId}:${concept.term}` === selected?.id
            )?.messageId;
            const messageElement = Array.from(
              document.querySelectorAll<HTMLElement>("[data-message-id]")
            ).find((element) => element.dataset.messageId === messageId);
            messageElement?.scrollIntoView({ behavior: "smooth", block: "center" });
          }}
          label={locale === "zh" ? "AI 自动导航" : "AI navigation"}
        />
        <div className="magic-context-files space-y-2">
          {files.length === 0 ? (
            <Link href="/files" className="magic-context-empty">
              <FileText size={22} />
              <strong>{locale === "zh" ? "还没有资料" : "No sources yet"}</strong>
              <span>{locale === "zh" ? "导入文档、图片或视频" : "Import a document, image, or video"}</span>
            </Link>
          ) : (
            files.map((file) => {
              const checked = selectedAttachments.includes(file.id);
              return (
                <label key={file.id} className={clsx("magic-context-file", checked && "is-checked")}>
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
                  <span className="magic-file-icon">
                    <FileText size={14} />
                  </span>
                  <div>
                    <strong>{file.fileName}</strong>
                    <small>{statusText(file.status)}</small>
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
            className="magic-attach-recent"
          >
            <Paperclip size={13} />
            {locale === "zh" ? "附加最近资料" : "Attach recent sources"}
          </button>
        ) : null}
      </section>
    </div>
  );
}
