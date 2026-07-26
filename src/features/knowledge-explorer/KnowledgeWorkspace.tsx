"use client";

import {
  ArrowRight,
  ArrowUpRight,
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileUp,
  GitBranch,
  Home,
  Loader2,
  Maximize2,
  Minimize2,
  Network,
  PanelLeft,
  Plus,
  Send,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import {
  type CSSProperties,
  type FormEvent,
  type Ref,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useSession } from "@/features/auth/session.client";
import { consumeSseStream } from "@/features/chat-agent/sse";
import { ChatHistoryMessage, Locale, Thread } from "@/lib/domain/types";
import { createId } from "@/lib/domain/utils";
import { MiniTreeMap, type MiniTreeNode } from "@/lib/ui/MiniTreeMap";
import {
  CONCEPT_HREF_PREFIX,
  ensureConceptAnnotations,
  toConceptLinkMarkdown,
} from "@/lib/agent/concept-annotations";

type CardRelation = "root" | "child" | "related" | "branch";
type CardStatus = "idle" | "streaming" | "error";

type KnowledgeMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  groundingChecked?: boolean;
  knowledgeSources?: string[];
};

type KnowledgeCard = {
  id: string;
  threadId?: string;
  parentId: string | null;
  relation: CardRelation;
  title: string;
  question: string;
  messages: KnowledgeMessage[];
  status: CardStatus;
  unread: boolean;
  createdAt: string;
};

type StoredWorkspace = {
  cards: KnowledgeCard[];
  activeCardId: string;
};

type SpawnDraft = {
  parentId: string;
  relation: Exclude<CardRelation, "root">;
  value: string;
  sourceTerm?: string;
};

type TermPreview = {
  cardId: string;
  term: string;
  text: string;
  loading: boolean;
  error?: string;
};

const STORAGE_KEY = "magic_atlas_glass_stage_v2";

const relationMeta: Record<CardRelation, { label: string; prompt: string }> = {
  root: { label: "主线卡片", prompt: "建立项目的核心问题与共同背景" },
  child: { label: "子卡片 · 深入概念", prompt: "向下钻进一个概念" },
  related: { label: "关联卡片 · 横向发散", prompt: "横向比较相邻知识" },
  branch: { label: "分支卡片 · 继承上下文", prompt: "继承上下文，另起路线" },
};

function createStarterCards(): KnowledgeCard[] {
  return [
    {
      id: "glass_starter",
      parentId: null,
      relation: "root",
      title: "开始探索",
      question: "输入一个问题，建立你的第一张知识卡片",
      status: "idle",
      unread: false,
      createdAt: new Date().toISOString(),
      messages: [
        {
          id: "glass_starter_assistant",
          role: "assistant",
          content:
            "这里不再是线性聊天框。AI 会把值得继续理解的[[关键词]]标出来：点击后先看一个小预览，只有你确认创建，才会从当前节点展开一张新的独立卡片。\n\n右侧导航会自动记录卡片之间的父子关系；数据库命中情况也会显示在每次回答下方。",
        },
      ],
    },
  ];
}

function cleanTitle(value: string) {
  return value
    .replace(/\[\[|\]\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 34);
}

function lastAssistant(card: KnowledgeCard | undefined) {
  return (
    [...(card?.messages ?? [])]
      .reverse()
      .find((message) => message.role === "assistant")
      ?.content.trim() ?? ""
  );
}

function lineageFor(cards: KnowledgeCard[], cardId: string) {
  const result: KnowledgeCard[] = [];
  let current = cards.find((card) => card.id === cardId);
  const visited = new Set<string>();
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    result.unshift(current);
    current = current.parentId
      ? cards.find((card) => card.id === current?.parentId)
      : undefined;
  }
  return result;
}

function historyForCard(cards: KnowledgeCard[], cardId: string): ChatHistoryMessage[] {
  return lineageFor(cards, cardId)
    .flatMap((card) =>
      card.messages.map((message) => ({
        role: message.role,
        content: message.content.replace(/\[\[|\]\]/g, ""),
      }))
    )
    .filter((message) => message.content.trim())
    .slice(-18);
}

function collectDescendantIds(cards: KnowledgeCard[], cardId: string) {
  const ids = new Set([cardId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const card of cards) {
      if (card.parentId && ids.has(card.parentId) && !ids.has(card.id)) {
        ids.add(card.id);
        changed = true;
      }
    }
  }
  return ids;
}

function orderedCardTree(cards: KnowledgeCard[]) {
  const byParent = new Map<string | null, KnowledgeCard[]>();
  for (const card of cards) {
    const siblings = byParent.get(card.parentId) ?? [];
    siblings.push(card);
    byParent.set(card.parentId, siblings);
  }
  for (const siblings of byParent.values()) {
    siblings.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  const result: Array<{ card: KnowledgeCard; depth: number }> = [];
  const visited = new Set<string>();
  const visit = (card: KnowledgeCard, depth: number) => {
    if (visited.has(card.id)) return;
    visited.add(card.id);
    result.push({ card, depth });
    for (const child of byParent.get(card.id) ?? []) visit(child, depth + 1);
  };

  for (const root of byParent.get(null) ?? []) visit(root, 0);
  for (const card of cards) visit(card, 0);
  return result;
}

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}

function AnnotatedMarkdown({
  content,
  onTerm,
}: {
  content: string;
  onTerm: (term: string) => void;
}) {
  const transformed = toConceptLinkMarkdown(content);

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => {
          if (href?.startsWith(CONCEPT_HREF_PREFIX)) {
            const term = decodeURIComponent(href.slice(CONCEPT_HREF_PREFIX.length));
            return (
              <button
                type="button"
                className="knowledge-stage-concept"
                onClick={() => onTerm(term)}
                title={`预览并追问：${term}`}
              >
                {children}
              </button>
            );
          }
          return (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          );
        },
      }}
    >
      {transformed}
    </ReactMarkdown>
  );
}

function RelationIcon({ relation }: { relation: CardRelation }) {
  if (relation === "child") return <ArrowUpRight size={16} />;
  if (relation === "related") return <ArrowRight size={16} />;
  if (relation === "branch") return <GitBranch size={16} />;
  return <Home size={16} />;
}

function KnowledgeCardConversation({
  card,
  onTerm,
  bodyRef,
  compact = false,
}: {
  card: KnowledgeCard;
  onTerm: (term: string) => void;
  bodyRef?: Ref<HTMLDivElement>;
  compact?: boolean;
}) {
  return (
    <div
      className={`knowledge-stage-card-body ${compact ? "is-compact" : ""}`}
      ref={bodyRef}
    >
      {card.messages.length === 0 ? (
        <div className="knowledge-stage-empty">
          <Network size={28} />
          <h2>准备建立这张知识卡片</h2>
          <p>在下方输入问题，回答会在这里展开。</p>
        </div>
      ) : null}

      {card.messages.map((message) =>
        message.role === "user" ? (
          <div key={message.id} className="knowledge-stage-question">
            {message.content}
          </div>
        ) : (
          <section key={message.id} className="knowledge-stage-answer">
            <div className="knowledge-stage-thinking">
              {card.status === "streaming" && !message.content ? (
                <>
                  <Loader2 className="animate-spin" size={15} />
                  正在读取上下文与知识库
                </>
              ) : (
                <>
                  <span />
                  AI 回答
                </>
              )}
            </div>
            <AnnotatedMarkdown
              content={message.content || "正在展开知识结构…"}
              onTerm={onTerm}
            />
            {message.groundingChecked ? (
              message.knowledgeSources?.length ? (
                <div className="knowledge-stage-grounding is-hit">
                  <Check size={14} />
                  <div>
                    <strong>已引用数据库</strong>
                    <span>{message.knowledgeSources.join(" · ")}</span>
                  </div>
                </div>
              ) : (
                <div className="knowledge-stage-grounding is-miss">
                  <Network size={14} />
                  <div>
                    <strong>本次未命中知识库</strong>
                    <span>回答来自通用模型，没有伪造数据库引用</span>
                  </div>
                </div>
              )
            ) : null}
          </section>
        )
      )}
    </div>
  );
}

export function KnowledgeWorkspace() {
  const { user } = useSession();
  const locale: Locale = user?.locale === "en" ? "en" : "zh";
  const [cards, setCards] = useState<KnowledgeCard[]>(createStarterCards);
  const cardsRef = useRef(cards);
  const [activeCardId, setActiveCardId] = useState("glass_starter");
  const activeCardIdRef = useRef(activeCardId);
  const [cardInputs, setCardInputs] = useState<Record<string, string>>({});
  const [spawnDraft, setSpawnDraft] = useState<SpawnDraft | null>(null);
  const [spawnError, setSpawnError] = useState("");
  const [creatingCard, setCreatingCard] = useState(false);
  const [termPreview, setTermPreview] = useState<TermPreview | null>(null);
  const [newTopicOpen, setNewTopicOpen] = useState(false);
  const [newTopic, setNewTopic] = useState("");
  const [deleteCardId, setDeleteCardId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pageError, setPageError] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);
  const cardBodyRef = useRef<HTMLDivElement | null>(null);

  const commitCards = (
    update: KnowledgeCard[] | ((previous: KnowledgeCard[]) => KnowledgeCard[])
  ) => {
    const next = typeof update === "function" ? update(cardsRef.current) : update;
    cardsRef.current = next;
    setCards(next);
  };

  useEffect(() => {
    activeCardIdRef.current = activeCardId;
  }, [activeCardId]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const stored = JSON.parse(raw) as Partial<StoredWorkspace>;
        if (Array.isArray(stored.cards) && stored.cards.length > 0) {
          commitCards(stored.cards);
          const storedActive = stored.cards.some((card) => card.id === stored.activeCardId)
            ? stored.activeCardId
            : stored.cards[0].id;
          setActiveCardId(storedActive ?? stored.cards[0].id);
        }
      }
      const storedSidebar = window.localStorage.getItem(
        "magic_atlas_sidebar_open"
      );
      if (storedSidebar === "false") setSidebarOpen(false);
    } catch {
      // Invalid local UI state should not prevent a new exploration.
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const workspace: StoredWorkspace = { cards, activeCardId };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
  }, [activeCardId, cards, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(
      "magic_atlas_sidebar_open",
      String(sidebarOpen)
    );
  }, [hydrated, sidebarOpen]);

  const activeCard = cards.find((card) => card.id === activeCardId) ?? cards[0];
  const parentCard =
    activeCard?.parentId
      ? cards.find((card) => card.id === activeCard.parentId)
      : undefined;
  const stageBaseCard = parentCard ?? activeCard;
  const previewSourceCard = termPreview
    ? cards.find((card) => card.id === termPreview.cardId)
    : undefined;
  const activeLineage = activeCard ? lineageFor(cards, activeCard.id) : [];
  const activeRootCard = activeLineage[0];
  const activeProjectIds = activeRootCard
    ? collectDescendantIds(cards, activeRootCard.id)
    : new Set<string>();
  const activeProjectCards = cards.filter((card) => activeProjectIds.has(card.id));
  const sidebarCards = useMemo(() => orderedCardTree(cards), [cards]);
  const nextCard = activeCard
    ? [...cards]
        .filter((card) => card.parentId === activeCard.id)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]
    : undefined;
  const childExpanded = Boolean(
    parentCard && activeCard && expandedCardId === activeCard.id
  );
  const inputValue = activeCard ? cardInputs[activeCard.id] ?? "" : "";

  const atlasMapNodes = useMemo<MiniTreeNode[]>(
    () =>
      activeProjectCards.map((card) => ({
        id: card.id,
        parentId: card.parentId,
        label: card.title,
        relation: card.relation,
        unread: card.unread,
      })),
    [activeProjectCards]
  );

  useEffect(() => {
    if (!activeCard || activeCard.status !== "streaming") return;
    cardBodyRef.current?.scrollTo({
      top: cardBodyRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [activeCard, activeCard?.messages]);

  const focusCard = (cardId: string) => {
    const target = cardsRef.current.find((card) => card.id === cardId);
    commitCards((previous) =>
      previous.map((card) => (card.id === cardId ? { ...card, unread: false } : card))
    );
    setTermPreview(null);
    setExpandedCardId(target?.parentId ? target.id : null);
    setActiveCardId(cardId);
  };

  const createServerThread = async (
    title: string,
    parentThreadId?: string,
    sourceTerm?: string
  ) => {
    const data = await apiJson<{ item: Thread }>("/api/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, parentThreadId, sourceTerm }),
    });
    return data.item;
  };

  const ensureThreadForCard = async (card: KnowledgeCard) => {
    if (card.threadId) return card.threadId;
    const thread = await createServerThread(card.title);
    commitCards((previous) =>
      previous.map((item) =>
        item.id === card.id ? { ...item, threadId: thread.id } : item
      )
    );
    return thread.id;
  };

  const askCard = async (cardId: string, question: string) => {
    const normalized = question.trim();
    if (!normalized) return;
    const card = cardsRef.current.find((item) => item.id === cardId);
    if (!card || card.status === "streaming") return;

    const history = historyForCard(cardsRef.current, cardId);
    const assistantId = createId("knowledge_assistant");
    setPageError("");
    commitCards((previous) =>
      previous.map((item) =>
        item.id === cardId
          ? {
              ...item,
              title: item.title === "开始探索" ? cleanTitle(normalized) : item.title,
              question: item.question || normalized,
              status: "streaming",
              messages: [
                ...item.messages.filter(
                  (message) => message.id !== "glass_starter_assistant"
                ),
                {
                  id: createId("knowledge_user"),
                  role: "user",
                  content: normalized,
                },
                {
                  id: assistantId,
                  role: "assistant",
                  content: "",
                },
              ],
            }
          : item
      )
    );
    setCardInputs((previous) => ({ ...previous, [cardId]: "" }));

    try {
      const current = cardsRef.current.find((item) => item.id === cardId);
      const response = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: current?.threadId,
          userMessage: normalized,
          locale,
          clientHistory: history,
          responseMode: "annotated",
        }),
      });
      if (!response.ok) {
        throw new Error(
          locale === "zh"
            ? `知识探索服务暂时不可用（${response.status}）`
            : `Explore unavailable (${response.status})`
        );
      }

      let streamError = "";
      await consumeSseStream(response, {
        thread: ({ threadId }) => {
          commitCards((previous) =>
            previous.map((item) =>
              item.id === cardId ? { ...item, threadId } : item
            )
          );
        },
        token: ({ text }) => {
          commitCards((previous) =>
            previous.map((item) =>
              item.id === cardId
                ? {
                    ...item,
                    messages: item.messages.map((message) =>
                      message.id === assistantId
                        ? { ...message, content: `${message.content}${text}` }
                        : message
                    ),
                  }
                : item
            )
          );
        },
        done: ({ knowledgeSources, annotatedText }) => {
          commitCards((previous) =>
            previous.map((item) =>
              item.id === cardId
                ? {
                    ...item,
                    messages: item.messages.map((message) =>
                      message.id === assistantId
                        ? {
                            ...message,
                            content:
                              annotatedText ||
                              ensureConceptAnnotations(message.content),
                            groundingChecked: true,
                            knowledgeSources,
                          }
                        : message
                    ),
                  }
                : item
            )
          );
        },
        error: ({ message }) => {
          streamError = message;
        },
      });
      if (streamError) throw new Error(streamError);

      commitCards((previous) =>
        previous.map((item) =>
          item.id === cardId
            ? {
                ...item,
                status: "idle",
                unread: item.id !== activeCardIdRef.current,
              }
            : item
        )
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Generation failed";
      commitCards((previous) =>
        previous.map((item) =>
          item.id === cardId
            ? {
                ...item,
                status: "error",
                messages: item.messages.map((entry) =>
                  entry.id === assistantId && !entry.content
                    ? {
                        ...entry,
                        content:
                          locale === "zh"
                            ? `暂时无法生成回答。${message}`
                            : `Unable to generate an answer. ${message}`,
                      }
                    : entry
                ),
              }
            : item
        )
      );
      setPageError(message);
    }
  };

  const createRootCard = async (event: FormEvent) => {
    event.preventDefault();
    const question = newTopic.trim();
    if (!question || creatingCard) return;
    setCreatingCard(true);
    setSpawnError("");
    try {
      const thread = await createServerThread(cleanTitle(question));
      const root: KnowledgeCard = {
        id: createId("knowledge_root"),
        threadId: thread.id,
        parentId: null,
        relation: "root",
        title: cleanTitle(question),
        question,
        messages: [],
        status: "idle",
        unread: false,
        createdAt: new Date().toISOString(),
      };
      commitCards((previous) => [...previous, root]);
      setExpandedCardId(null);
      setActiveCardId(root.id);
      setNewTopic("");
      setNewTopicOpen(false);
      void askCard(root.id, question);
    } catch (error) {
      setSpawnError(error instanceof Error ? error.message : "无法创建主线");
    } finally {
      setCreatingCard(false);
    }
  };

  const spawnCard = async (event: FormEvent) => {
    event.preventDefault();
    if (!spawnDraft || creatingCard) return;
    const question = spawnDraft.value.trim();
    const parent = cardsRef.current.find((card) => card.id === spawnDraft.parentId);
    if (!parent || !question) return;

    setCreatingCard(true);
    setSpawnError("");
    try {
      const parentThreadId = await ensureThreadForCard(parent);
      const thread = await createServerThread(
        cleanTitle(spawnDraft.sourceTerm || question),
        parentThreadId,
        spawnDraft.sourceTerm || cleanTitle(question)
      );
      const child: KnowledgeCard = {
        id: createId(`knowledge_${spawnDraft.relation}`),
        threadId: thread.id,
        parentId: parent.id,
        relation: spawnDraft.relation,
        title: cleanTitle(spawnDraft.sourceTerm || question),
        question,
        messages: [],
        status: "idle",
        unread: false,
        createdAt: new Date().toISOString(),
      };
      commitCards((previous) => [...previous, child]);
      setSpawnDraft(null);
      setTermPreview(null);
      setExpandedCardId(child.id);
      setActiveCardId(child.id);
      void askCard(child.id, question);
    } catch (error) {
      setSpawnError(error instanceof Error ? error.message : "无法创建分支卡片");
    } finally {
      setCreatingCard(false);
    }
  };

  const openTerm = async (card: KnowledgeCard, term: string) => {
    const preview: TermPreview = {
      cardId: card.id,
      term,
      text: "",
      loading: true,
    };
    setTermPreview(preview);
    try {
      const response = await fetch("/api/explore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "preview",
          locale,
          term,
          context: lastAssistant(card),
        }),
      });
      const data = (await response.json()) as { text?: string; error?: string };
      if (!response.ok || !data.text) throw new Error(data.error || "Preview failed");
      setTermPreview({ ...preview, text: data.text, loading: false });
    } catch (error) {
      setTermPreview({
        ...preview,
        loading: false,
        error: error instanceof Error ? error.message : "Preview failed",
      });
    }
  };

  const deleteCard = async () => {
    if (!deleteCardId) return;
    const ids = collectDescendantIds(cardsRef.current, deleteCardId);
    const targets = cardsRef.current.filter((card) => ids.has(card.id)).reverse();
    setCreatingCard(true);
    setPageError("");
    try {
      for (const card of targets) {
        if (!card.threadId) continue;
        const response = await fetch(`/api/threads/${card.threadId}`, {
          method: "DELETE",
        });
        if (!response.ok && response.status !== 404) {
          throw new Error(`删除数据库卡片失败（${response.status}）`);
        }
      }
      const remaining = cardsRef.current.filter((card) => !ids.has(card.id));
      const next = remaining.length ? remaining : createStarterCards();
      commitCards(next);
      setExpandedCardId(null);
      setActiveCardId(next[0].id);
      setDeleteCardId(null);
      setTermPreview(null);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "删除失败");
    } finally {
      setCreatingCard(false);
    }
  };

  const copyAnswer = async (card = activeCard) => {
    const answer = lastAssistant(card);
    if (!answer) return;
    await navigator.clipboard.writeText(answer.replace(/\[\[|\]\]/g, ""));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className={`knowledge-stage ${sidebarOpen ? "is-sidebar-open" : ""}`}>
      <aside className="knowledge-stage-rail" aria-label="知识探索工具">
        <button
          type="button"
          className="knowledge-stage-sidebar-toggle"
          onClick={() => setSidebarOpen((value) => !value)}
          title={sidebarOpen ? "隐藏侧边栏" : "打开侧边栏"}
          aria-label={sidebarOpen ? "隐藏侧边栏" : "打开侧边栏"}
        >
          <PanelLeft size={21} />
          <span>{sidebarOpen ? "隐藏侧边栏" : "打开侧边栏"}</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setSpawnError("");
            setNewTopicOpen(true);
          }}
          title="新建主线"
          aria-label="新建主线"
        >
          <Plus size={21} />
          <span>新建项目</span>
        </button>
        <Link href="/files" title="上传文档" aria-label="上传文档">
          <FileUp size={20} />
          <span>上传文档</span>
        </Link>
        <Link href="/" title="产品首页" aria-label="产品首页">
          <Home size={20} />
          <span>产品首页</span>
        </Link>

        <section className="knowledge-stage-projects" aria-label="本地项目">
          <div>
            <Network size={14} />
            <span>知识卡片</span>
            <i>{cards.length}</i>
          </div>
          <nav>
            {sidebarCards.map(({ card, depth }) => (
              <div
                key={card.id}
                className={card.id === activeCardId ? "is-active" : ""}
                style={{ "--card-indent": `${depth * 14}px` } as CSSProperties}
              >
                <button
                  type="button"
                  className="knowledge-stage-project-select"
                  onClick={() => focusCard(card.id)}
                  aria-label={`打开对话：${card.title}`}
                >
                  <span className={`relation-${card.relation}`} />
                  <strong>
                    {depth > 0 ? (
                      <small>{relationMeta[card.relation].label.split(" · ")[0]}</small>
                    ) : null}
                    {card.title}
                  </strong>
                  {card.unread ? <i /> : null}
                </button>
                <button
                  type="button"
                  className="knowledge-stage-project-delete"
                  onClick={() => setDeleteCardId(card.id)}
                  aria-label={`删除对话：${card.title}`}
                  title="删除对话"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </nav>
        </section>

        <div className="knowledge-stage-rail-spacer" />
        <Link href="/settings" title="设置" aria-label="设置">
          <Settings size={20} />
          <span>设置</span>
        </Link>
        <div className="knowledge-stage-account" title={user?.name || "账户"}>
          <div className="knowledge-stage-avatar">
            {(user?.name || "M").slice(0, 1).toUpperCase()}
          </div>
          <span>{user?.name || "账户"}</span>
        </div>
      </aside>

      <main className="knowledge-stage-main">
        <nav className="knowledge-stage-breadcrumb" aria-label="当前知识路径">
          {activeLineage.map((card, index) => (
            <button key={card.id} type="button" onClick={() => focusCard(card.id)}>
              {index > 0 ? <span>/</span> : null}
              {card.title}
            </button>
          ))}
        </nav>

        <section
          className={`knowledge-stage-stack ${
            childExpanded ? "is-child-expanded" : ""
          }`}
          aria-live="polite"
        >
          {activeLineage.slice(0, -2).map((card, index) => (
            <button
              key={`ancestor_${card.id}`}
              type="button"
              className="knowledge-stage-ancestor-sheet"
              style={
                {
                  "--ancestor-offset": `${index * 9}px`,
                } as CSSProperties
              }
              onClick={() => focusCard(card.id)}
              title={`切换到：${card.title}`}
            >
              <span>{card.title}</span>
            </button>
          ))}

          {stageBaseCard ? (
            <article
              key={stageBaseCard.id}
              className={`knowledge-stage-card relation-${stageBaseCard.relation} ${
                parentCard ? "has-child-open" : ""
              }`}
            >
              <header className="knowledge-stage-card-header">
                <div>
                  <span>
                    <RelationIcon relation={stageBaseCard.relation} />
                    {relationMeta[stageBaseCard.relation].label}
                  </span>
                  <h1>{stageBaseCard.title}</h1>
                </div>
                <div className="knowledge-stage-card-tools">
                  {parentCard ? (
                    <button
                      type="button"
                      onClick={() => focusCard(stageBaseCard.id)}
                      title="切换到这张父卡片"
                      aria-label="切换到这张父卡片"
                    >
                      <ChevronLeft size={17} />
                    </button>
                  ) : nextCard ? (
                    <button
                      type="button"
                      onClick={() => focusCard(nextCard.id)}
                      title="打开最近的下一层卡片"
                      aria-label="打开最近的下一层卡片"
                    >
                      <ChevronRight size={17} />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void copyAnswer(stageBaseCard)}
                    title="复制回答"
                    aria-label="复制回答"
                  >
                    {copied ? <Check size={17} /> : <Copy size={17} />}
                  </button>
                  <button type="button" title="收藏卡片" aria-label="收藏卡片">
                    <Bookmark size={17} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteCardId(stageBaseCard.id)}
                    title="删除卡片"
                    aria-label="删除卡片"
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              </header>

              <KnowledgeCardConversation
                card={stageBaseCard}
                onTerm={(term) => void openTerm(stageBaseCard, term)}
                bodyRef={parentCard ? undefined : cardBodyRef}
              />
            </article>
          ) : null}

          {parentCard && activeCard ? (
            <article
              key={`child_${activeCard.id}`}
              className={`knowledge-stage-child-card relation-${activeCard.relation} ${
                childExpanded ? "is-expanded" : "is-collapsed"
              }`}
            >
              <header className="knowledge-stage-child-header">
                <div>
                  <span>
                    <RelationIcon relation={activeCard.relation} />
                    第 {activeLineage.length} 层 · {relationMeta[activeCard.relation].label}
                  </span>
                  <h2>{activeCard.title}</h2>
                </div>
                <div>
                  <button
                    type="button"
                    className="knowledge-stage-size-toggle"
                    onClick={() =>
                      setExpandedCardId((current) =>
                        current === activeCard.id ? null : activeCard.id
                      )
                    }
                    title={childExpanded ? "缩小为浮动卡片" : "放大这张卡片"}
                    aria-label={childExpanded ? "缩小为浮动卡片" : "放大这张卡片"}
                  >
                    {childExpanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                    <span>{childExpanded ? "缩小" : "放大"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void copyAnswer(activeCard)}
                    title="复制回答"
                    aria-label="复制回答"
                  >
                    <Copy size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteCardId(activeCard.id)}
                    title="删除这层对话"
                    aria-label="删除这层对话"
                  >
                    <Trash2 size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => focusCard(parentCard.id)}
                    title="关闭并返回父卡片"
                    aria-label="关闭并返回父卡片"
                  >
                    <X size={16} />
                  </button>
                </div>
              </header>
              <KnowledgeCardConversation
                card={activeCard}
                onTerm={(term) => void openTerm(activeCard, term)}
                bodyRef={cardBodyRef}
                compact={!childExpanded}
              />
            </article>
          ) : null}

          {parentCard || nextCard ? (
            <nav className="knowledge-stage-layer-switcher" aria-label="层级切换">
              {parentCard ? (
                <button
                  type="button"
                  onClick={() => focusCard(parentCard.id)}
                  title={`返回：${parentCard.title}`}
                  aria-label={`返回父卡片：${parentCard.title}`}
                >
                  <ChevronLeft size={19} />
                  <span>上一层</span>
                </button>
              ) : null}
              {nextCard ? (
                <button
                  type="button"
                  onClick={() => focusCard(nextCard.id)}
                  title={`进入：${nextCard.title}`}
                  aria-label={`进入下一层：${nextCard.title}`}
                >
                  <span>下一层</span>
                  <ChevronRight size={19} />
                </button>
              ) : null}
            </nav>
          ) : null}

          {termPreview && previewSourceCard ? (
            <aside className="knowledge-term-popover">
              <div>
                <span>从“{previewSourceCard.title}”向下一层</span>
                <button
                  type="button"
                  onClick={() => setTermPreview(null)}
                  aria-label="关闭关键词预览"
                >
                  <X size={15} />
                </button>
              </div>
              <h2>{termPreview.term}</h2>
              {termPreview.loading ? (
                <p className="is-loading">
                  <Loader2 className="animate-spin" size={15} />
                  正在结合当前卡片解释…
                </p>
              ) : (
                <p>{termPreview.error || termPreview.text}</p>
              )}
              <button
                type="button"
                disabled={termPreview.loading}
                onClick={() => {
                  setSpawnError("");
                  setSpawnDraft({
                    parentId: previewSourceCard.id,
                    relation: "child",
                    sourceTerm: termPreview.term,
                    value: `请结合上游内容，深入解释“${termPreview.term}”。`,
                  });
                }}
              >
                <Maximize2 size={15} />
                创建分支并放大
              </button>
              <small>预览不会创建节点；确认后才叠加到当前卡片上</small>
            </aside>
          ) : null}
        </section>

        <aside className="knowledge-stage-navigator">
          <MiniTreeMap
            nodes={atlasMapNodes}
            activeId={activeCardId}
            onSelect={focusCard}
            label="卡片导航"
          />
          <p>节点由卡片关系自动生成</p>
        </aside>

        {activeCard ? (
          <div className="knowledge-stage-branch-actions">
            {(["child", "related", "branch"] as const).map((relation) => (
              <button
                key={relation}
                type="button"
                onClick={() => {
                  setSpawnError("");
                  setSpawnDraft({
                    parentId: activeCard.id,
                    relation,
                    value: "",
                  });
                }}
                title={relationMeta[relation].prompt}
              >
                <RelationIcon relation={relation} />
                <span>{relationMeta[relation].label.split(" · ")[0]}</span>
              </button>
            ))}
          </div>
        ) : null}

        {activeCard ? (
          <form
            className="knowledge-stage-composer"
            onSubmit={(event) => {
              event.preventDefault();
              void askCard(activeCard.id, inputValue);
            }}
          >
            <span className="knowledge-stage-model">AI</span>
            <input
              value={inputValue}
              onChange={(event) =>
                setCardInputs((previous) => ({
                  ...previous,
                  [activeCard.id]: event.target.value,
                }))
              }
              placeholder="在当前卡片继续提问…"
              disabled={activeCard.status === "streaming"}
            />
            <button
              type="submit"
              disabled={!inputValue.trim() || activeCard.status === "streaming"}
              aria-label="发送"
            >
              {activeCard.status === "streaming" ? (
                <Loader2 className="animate-spin" size={18} />
              ) : (
                <Send size={18} />
              )}
            </button>
          </form>
        ) : null}

        {pageError ? (
          <div className="knowledge-stage-error">
            <span>{pageError}</span>
            <button type="button" onClick={() => setPageError("")} aria-label="关闭错误">
              <X size={14} />
            </button>
          </div>
        ) : null}
      </main>

      {newTopicOpen ? (
        <div className="knowledge-stage-modal-backdrop">
          <form className="knowledge-stage-modal" onSubmit={createRootCard}>
            <div className="knowledge-stage-modal-icon">
              <Plus size={19} />
            </div>
            <span>新的主线卡片</span>
            <h2>想彻底搞懂什么？</h2>
            <textarea
              autoFocus
              value={newTopic}
              onChange={(event) => setNewTopic(event.target.value)}
              placeholder="输入一个核心问题…"
              rows={4}
            />
            {spawnError ? <p className="knowledge-stage-modal-error">{spawnError}</p> : null}
            <div>
              <button type="button" onClick={() => setNewTopicOpen(false)}>
                取消
              </button>
              <button type="submit" disabled={!newTopic.trim() || creatingCard}>
                {creatingCard ? <Loader2 className="animate-spin" size={15} /> : null}
                创建主线
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {spawnDraft ? (
        <div className="knowledge-stage-modal-backdrop">
          <form className="knowledge-stage-modal" onSubmit={spawnCard}>
            <div className={`knowledge-stage-modal-icon relation-${spawnDraft.relation}`}>
              <RelationIcon relation={spawnDraft.relation} />
            </div>
            <span>{relationMeta[spawnDraft.relation].label}</span>
            <h2>{relationMeta[spawnDraft.relation].prompt}</h2>
            {spawnDraft.sourceTerm ? (
              <div className="knowledge-stage-source-term">
                来源关键词：{spawnDraft.sourceTerm}
              </div>
            ) : null}
            <textarea
              autoFocus
              value={spawnDraft.value}
              onChange={(event) =>
                setSpawnDraft((previous) =>
                  previous ? { ...previous, value: event.target.value } : previous
                )
              }
              placeholder="输入这张新卡片要探索的问题…"
              rows={4}
            />
            {spawnError ? <p className="knowledge-stage-modal-error">{spawnError}</p> : null}
            <div>
              <button type="button" onClick={() => setSpawnDraft(null)}>
                取消
              </button>
              <button type="submit" disabled={!spawnDraft.value.trim() || creatingCard}>
                {creatingCard ? <Loader2 className="animate-spin" size={15} /> : null}
                创建并进入下一层
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {deleteCardId ? (
        <div className="knowledge-stage-modal-backdrop">
          <div className="knowledge-stage-modal">
            <div className="knowledge-stage-modal-icon is-danger">
              <Trash2 size={19} />
            </div>
            <span>确认操作</span>
            <h2>删除这张卡片及其下游分支？</h2>
            <p className="knowledge-stage-delete-copy">
              对应数据库线程和消息也会一起删除，无法撤销。
            </p>
            <div>
              <button type="button" onClick={() => setDeleteCardId(null)}>
                取消
              </button>
              <button
                type="button"
                className="is-danger"
                onClick={() => void deleteCard()}
                disabled={creatingCard}
              >
                {creatingCard ? <Loader2 className="animate-spin" size={15} /> : null}
                确认删除
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
