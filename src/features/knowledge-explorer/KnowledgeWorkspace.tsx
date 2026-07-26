"use client";

import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  BrainCircuit,
  Check,
  ChevronRight,
  HelpCircle,
  FileText,
  GitBranch,
  Home,
  Loader2,
  Map,
  Minus,
  Network,
  Plus,
  Send,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { CSSProperties, FormEvent, MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { consumeSseStream } from "@/features/chat-agent/sse";
import { useSession } from "@/features/auth/session.client";
import { ChatHistoryMessage, FileAsset, Locale } from "@/lib/domain/types";
import { createId } from "@/lib/domain/utils";

type CardRelation = "root" | "child" | "related" | "branch";
type CardStatus = "idle" | "streaming" | "error";
type ThemeName = "parchment" | "midnight" | "sage";

type KnowledgeMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type KnowledgeCard = {
  id: string;
  parentId: string | null;
  relation: CardRelation;
  title: string;
  question: string;
  messages: KnowledgeMessage[];
  x: number;
  y: number;
  status: CardStatus;
  unread: boolean;
  createdAt: string;
};

type KnowledgeAnchor = {
  id: string;
  cardId: string;
  title: string;
  understanding: string;
  review: string;
  createdAt: string;
};

type StoredWorkspace = {
  cards: KnowledgeCard[];
  anchors: KnowledgeAnchor[];
  projectSummary: string;
  theme: ThemeName;
  selectedAttachmentIds: string[];
};

type SpawnDraft = {
  parentId: string;
  relation: Exclude<CardRelation, "root">;
  value: string;
};

type TermPreview = {
  cardId: string;
  term: string;
  text: string;
  loading: boolean;
  error?: string;
};

const STORAGE_KEY = "magic_atlas_workspace_v1";
const CARD_WIDTH = 420;
const CARD_HEIGHT = 560;

const relationMeta: Record<CardRelation, { label: string; short: string }> = {
  root: { label: "主线卡片", short: "主" },
  child: { label: "子卡片 · 深入概念", short: "↗" },
  related: { label: "关联卡片 · 横向发散", short: "→" },
  branch: { label: "分支卡片 · 继承上下文", short: "↓" },
};

function createStarterCards(): KnowledgeCard[] {
  const now = new Date().toISOString();
  return [
    {
      id: "starter_root",
      parentId: null,
      relation: "root",
      title: "量子纠缠与信息",
      question: "量子纠缠为什么不能用来进行超光速通信？",
      x: 64,
      y: 330,
      status: "idle",
      unread: false,
      createdAt: now,
      messages: [
        {
          id: "starter_root_user",
          role: "user",
          content: "量子纠缠为什么不能用来进行超光速通信？",
        },
        {
          id: "starter_root_assistant",
          role: "assistant",
          content:
            "纠缠粒子的测量结果会呈现超越经典概率的相关性，但单次结果仍然是随机的。观察者无法选择本地测量的结果，因此也就无法把一段可控信息编码进去。\n\n要确认两端结果之间的关联，双方仍需通过普通通信交换数据。这个限制由[[不可通信定理]]严格刻画：局部操作不能改变远端可观测的统计分布。\n\n[[贝尔不等式]]告诉我们这种关联不是经典的“事先约定”，但它并不等于信号传播。这里最容易混淆的是[[量子态坍缩]]与可传递信息之间的区别。",
        },
      ],
    },
    {
      id: "starter_child",
      parentId: "starter_root",
      relation: "child",
      title: "不可通信定理",
      question: "不可通信定理具体限制了什么？",
      x: 570,
      y: 70,
      status: "idle",
      unread: true,
      createdAt: now,
      messages: [
        {
          id: "starter_child_user",
          role: "user",
          content: "不可通信定理具体限制了什么？",
        },
        {
          id: "starter_child_assistant",
          role: "assistant",
          content:
            "它限制的是远端可见的“边缘概率分布”。无论你在纠缠对的一端选择哪种测量，另一端单独统计自己的结果时，看到的分布都不会发生可识别变化。\n\n只有把两端记录放在一起比较，[[联合概率]]中的关联才会出现。因此，纠缠能提供关联资源，却不能单独构成通信信道。",
        },
      ],
    },
    {
      id: "starter_related",
      parentId: "starter_root",
      relation: "related",
      title: "量子关联 vs 经典关联",
      question: "量子关联和经典相关性真正不同在哪里？",
      x: 570,
      y: 690,
      status: "idle",
      unread: true,
      createdAt: now,
      messages: [
        {
          id: "starter_related_user",
          role: "user",
          content: "量子关联和经典相关性真正不同在哪里？",
        },
        {
          id: "starter_related_assistant",
          role: "assistant",
          content:
            "经典关联可以解释为两边共享了一份预先写好的答案；量子关联在合适的测量设置下会违反[[贝尔不等式]]，排除这一类局域隐藏变量解释。\n\n但两者都需要事后对照数据才能被识别。差异在于关联结构，而不在于谁能更快地发送消息。",
        },
      ],
    },
  ];
}

function lastAssistant(card: KnowledgeCard | undefined) {
  return [...(card?.messages ?? [])]
    .reverse()
    .find((message) => message.role === "assistant")
    ?.content.trim() ?? "";
}

function cleanTitle(value: string) {
  return value
    .replace(/\[\[|\]\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 32);
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

function lineageFor(cards: KnowledgeCard[], cardId: string) {
  const result: KnowledgeCard[] = [];
  let current = cards.find((card) => card.id === cardId);
  while (current) {
    result.unshift(current);
    current = current.parentId
      ? cards.find((card) => card.id === current?.parentId)
      : undefined;
  }
  return result;
}

function historyForCard(cards: KnowledgeCard[], cardId: string): ChatHistoryMessage[] {
  const lineage = lineageFor(cards, cardId);
  return lineage
    .flatMap((card) =>
      card.messages.map((message) => ({
        role: message.role,
        content: message.content.replace(/\[\[|\]\]/g, ""),
      }))
    )
    .slice(-14);
}

function positionForCard(
  cards: KnowledgeCard[],
  parent: KnowledgeCard,
  relation: Exclude<CardRelation, "root">
) {
  const proposed =
    relation === "child"
      ? { x: parent.x + 506, y: Math.max(64, parent.y - 260) }
      : relation === "related"
        ? { x: parent.x + 506, y: parent.y + 90 }
        : { x: parent.x + 92, y: parent.y + 650 };

  let y = proposed.y;
  while (
    cards.some(
      (card) =>
        Math.abs(card.x - proposed.x) < CARD_WIDTH * 0.82 &&
        Math.abs(card.y - y) < CARD_HEIGHT * 0.88
    )
  ) {
    y += CARD_HEIGHT + 70;
  }
  return { x: proposed.x, y };
}

function buildExplorationPrompt(card: KnowledgeCard, question: string, quote: string) {
  const relationInstruction =
    card.relation === "child"
      ? `这是一个子卡片。请围绕“${card.title}”从第一性原理向下深挖，默认读者已经看过上游卡片。`
      : card.relation === "related"
        ? `这是一个关联卡片。请围绕“${card.title}”做横向比较或相邻概念发散，不要重复上游解释。`
        : card.relation === "branch"
          ? `这是一个分支卡片。请继承上游讨论的事实与定义，但沿着“${card.title}”开启新的推理路线。`
          : "这是主线卡片。请先建立清晰框架，再回答核心问题。";
  const quoteInstruction = quote
    ? `\n用户明确引用了这段内容，请优先围绕它回答：\n“${quote.slice(0, 800)}”`
    : "";

  return `${relationInstruction}

用户问题：${question}
${quoteInstruction}

回答要求：
1. 直接回答，结构清楚，控制在 300 到 600 字；
2. 解释关键因果关系，必要时给一个具体例子；
3. 把 3 到 6 个值得继续探索的核心术语严格写成 [[术语]]，不要解释这套标注语法；
4. 区分已知事实、常见误解与仍有争议之处。`;
}

function AnnotatedMarkdown({
  content,
  onTerm,
}: {
  content: string;
  onTerm: (term: string) => void;
}) {
  const transformed = content.replace(/\[\[([^\]]+)\]\]/g, (_, term: string) => {
    return `[${term}](concept:${encodeURIComponent(term)})`;
  });

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => {
          if (href?.startsWith("concept:")) {
            const term = decodeURIComponent(href.replace("concept:", ""));
            return (
              <button
                type="button"
                className="atlas-concept"
                onClick={() => onTerm(term)}
                title={`预览：${term}`}
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
  if (relation === "child") return <ArrowUpRight size={14} />;
  if (relation === "related") return <ArrowRight size={14} />;
  if (relation === "branch") return <ArrowDown size={14} />;
  return <Home size={14} />;
}

export function KnowledgeWorkspace() {
  const { user } = useSession();
  const locale: Locale = user?.locale === "en" ? "en" : "zh";
  const [cards, setCards] = useState<KnowledgeCard[]>(createStarterCards);
  const cardsRef = useRef(cards);
  const [activeCardId, setActiveCardId] = useState("starter_root");
  const [theme, setTheme] = useState<ThemeName>("parchment");
  const [zoom, setZoom] = useState(0.9);
  const [startTopic, setStartTopic] = useState("");
  const [cardInputs, setCardInputs] = useState<Record<string, string>>({});
  const [spawnDraft, setSpawnDraft] = useState<SpawnDraft | null>(null);
  const [termPreview, setTermPreview] = useState<TermPreview | null>(null);
  const [quote, setQuote] = useState("");
  const [files, setFiles] = useState<FileAsset[]>([]);
  const [selectedAttachmentIds, setSelectedAttachmentIds] = useState<string[]>([]);
  const [anchors, setAnchors] = useState<KnowledgeAnchor[]>([]);
  const [understanding, setUnderstanding] = useState("");
  const [understandingReview, setUnderstandingReview] = useState("");
  const [validatingUnderstanding, setValidatingUnderstanding] = useState(false);
  const [projectSummary, setProjectSummary] = useState("");
  const [summarizing, setSummarizing] = useState(false);
  const [deleteCardId, setDeleteCardId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const commitCards = (
    update: KnowledgeCard[] | ((previous: KnowledgeCard[]) => KnowledgeCard[])
  ) => {
    const next = typeof update === "function" ? update(cardsRef.current) : update;
    cardsRef.current = next;
    setCards(next);
  };

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const stored = JSON.parse(raw) as Partial<StoredWorkspace>;
        if (Array.isArray(stored.cards) && stored.cards.length > 0) {
          commitCards(stored.cards);
          setActiveCardId(stored.cards[0].id);
        }
        if (Array.isArray(stored.anchors)) setAnchors(stored.anchors);
        if (typeof stored.projectSummary === "string") setProjectSummary(stored.projectSummary);
        if (stored.theme === "parchment" || stored.theme === "midnight" || stored.theme === "sage") {
          setTheme(stored.theme);
        }
        if (Array.isArray(stored.selectedAttachmentIds)) {
          setSelectedAttachmentIds(stored.selectedAttachmentIds);
        }
      }
    } catch {
      // Ignore invalid local workspace data and keep the starter map.
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const workspace: StoredWorkspace = {
      cards,
      anchors,
      projectSummary,
      theme,
      selectedAttachmentIds,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
  }, [cards, anchors, projectSummary, theme, selectedAttachmentIds, hydrated]);

  useEffect(() => {
    fetch("/api/files", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("files"))))
      .then((data: { items?: FileAsset[] }) => setFiles(Array.isArray(data.items) ? data.items : []))
      .catch(() => setFiles([]));
  }, []);

  const activeCard = cards.find((card) => card.id === activeCardId) ?? cards[0];
  const readyFiles = files.filter((file) => file.status === "ready");

  const canvasSize = useMemo(() => {
    const maxX = Math.max(1180, ...cards.map((card) => card.x + CARD_WIDTH + 100));
    const maxY = Math.max(1120, ...cards.map((card) => card.y + CARD_HEIGHT + 100));
    return { width: maxX, height: maxY };
  }, [cards]);

  const edges = useMemo(
    () =>
      cards.flatMap((card) => {
        if (!card.parentId) return [];
        const parent = cards.find((candidate) => candidate.id === card.parentId);
        if (!parent) return [];
        const startX = parent.x + CARD_WIDTH;
        const startY = parent.y + 52;
        const endX = card.x;
        const endY = card.y + 52;
        const dx = endX - startX;
        const dy = endY - startY;
        return [
          {
            id: `${parent.id}_${card.id}`,
            x: startX,
            y: startY,
            width: Math.sqrt(dx * dx + dy * dy),
            angle: Math.atan2(dy, dx) * (180 / Math.PI),
            relation: card.relation,
          },
        ];
      }),
    [cards]
  );

  const focusCard = (cardId: string) => {
    commitCards((previous) =>
      previous.map((card) => (card.id === cardId ? { ...card, unread: false } : card))
    );
    setActiveCardId(cardId);
    const card = cardsRef.current.find((item) => item.id === cardId);
    if (!card || !viewportRef.current || window.innerWidth < 760) return;
    viewportRef.current.scrollTo({
      left: Math.max(0, card.x * zoom - 80),
      top: Math.max(0, card.y * zoom - 80),
      behavior: "smooth",
    });
  };

  const askCard = async (cardId: string, question: string, quotedText = "") => {
    const normalized = question.trim();
    if (!normalized) return;
    const card = cardsRef.current.find((item) => item.id === cardId);
    if (!card || card.status === "streaming") return;

    const history = historyForCard(cardsRef.current, cardId);
    const assistantId = createId("atlas_assistant");
    commitCards((previous) =>
      previous.map((item) =>
        item.id === cardId
          ? {
              ...item,
              status: "streaming",
              question: item.question || normalized,
              messages: [
                ...item.messages,
                { id: createId("atlas_user"), role: "user", content: normalized },
                { id: assistantId, role: "assistant", content: "" },
              ],
            }
          : item
      )
    );
    setCardInputs((previous) => ({ ...previous, [cardId]: "" }));
    setQuote("");

    try {
      const response = await fetch("/api/explore/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: buildExplorationPrompt(card, normalized, quotedText),
          locale,
          history,
          attachmentIds: selectedAttachmentIds,
        }),
      });
      if (!response.ok) {
        throw new Error(
          locale === "zh" ? `知识探索服务暂时不可用（${response.status}）` : `Explore unavailable (${response.status})`
        );
      }

      let streamError = "";
      await consumeSseStream(response, {
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
        error: ({ message }) => {
          streamError = message;
        },
      });
      if (streamError) throw new Error(streamError);

      commitCards((previous) =>
        previous.map((item) =>
          item.id === cardId ? { ...item, status: "idle", unread: item.id !== activeCardId } : item
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
    }
  };

  const startNewTopic = (event: FormEvent) => {
    event.preventDefault();
    const topic = startTopic.trim();
    if (!topic) return;
    const root: KnowledgeCard = {
      id: createId("atlas_root"),
      parentId: null,
      relation: "root",
      title: cleanTitle(topic),
      question: topic,
      messages: [],
      x: 64,
      y: 260,
      status: "idle",
      unread: false,
      createdAt: new Date().toISOString(),
    };
    commitCards([root]);
    setActiveCardId(root.id);
    setAnchors([]);
    setProjectSummary("");
    setStartTopic("");
    void askCard(root.id, topic);
  };

  const spawnCard = (draft: SpawnDraft) => {
    const question = draft.value.trim();
    const parent = cardsRef.current.find((card) => card.id === draft.parentId);
    if (!parent || !question) return;
    const position = positionForCard(cardsRef.current, parent, draft.relation);
    const child: KnowledgeCard = {
      id: createId(`atlas_${draft.relation}`),
      parentId: parent.id,
      relation: draft.relation,
      title: cleanTitle(question),
      question,
      messages: [],
      x: position.x,
      y: position.y,
      status: "idle",
      unread: false,
      createdAt: new Date().toISOString(),
    };
    commitCards((previous) => [...previous, child]);
    setSpawnDraft(null);
    setActiveCardId(child.id);
    window.setTimeout(() => focusCard(child.id), 60);
    void askCard(child.id, question, quote);
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

  const captureSelection = (event: MouseEvent<HTMLElement>) => {
    const selection = window.getSelection()?.toString().replace(/\s+/g, " ").trim() ?? "";
    if (selection.length < 4 || !event.currentTarget.contains(window.getSelection()?.anchorNode ?? null)) {
      return;
    }
    setQuote(selection.slice(0, 800));
  };

  const validateUnderstanding = async () => {
    const value = understanding.trim();
    if (!activeCard || !value || validatingUnderstanding) return;
    setValidatingUnderstanding(true);
    setUnderstandingReview("");
    try {
      const response = await fetch("/api/explore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "validate",
          locale,
          understanding: value,
          context: lastAssistant(activeCard),
        }),
      });
      const data = (await response.json()) as { text?: string; error?: string };
      if (!response.ok || !data.text) throw new Error(data.error || "Validation failed");
      setUnderstandingReview(data.text);
      const accepted =
        data.text.includes("[认可]") || data.text.toLowerCase().includes("[accepted]");
      if (accepted) {
        setAnchors((previous) => [
          {
            id: createId("anchor"),
            cardId: activeCard.id,
            title: activeCard.title,
            understanding: value,
            review: data.text ?? "",
            createdAt: new Date().toISOString(),
          },
          ...previous,
        ]);
        setUnderstanding("");
      }
    } catch (error) {
      setUnderstandingReview(error instanceof Error ? error.message : "Validation failed");
    } finally {
      setValidatingUnderstanding(false);
    }
  };

  const summarizeProject = async () => {
    if (summarizing || cards.length === 0) return;
    setSummarizing(true);
    try {
      const content = cards
        .map((card) => `## ${card.title}\n问题：${card.question}\n${lastAssistant(card)}`)
        .join("\n\n");
      const response = await fetch("/api/explore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "summarize", locale, content }),
      });
      const data = (await response.json()) as { text?: string; error?: string };
      if (!response.ok || !data.text) throw new Error(data.error || "Summary failed");
      setProjectSummary(data.text);
    } catch (error) {
      setProjectSummary(error instanceof Error ? error.message : "Summary failed");
    } finally {
      setSummarizing(false);
    }
  };

  const deleteCard = () => {
    if (!deleteCardId) return;
    const ids = collectDescendantIds(cardsRef.current, deleteCardId);
    const remaining = cardsRef.current.filter((card) => !ids.has(card.id));
    commitCards(remaining.length ? remaining : createStarterCards());
    setActiveCardId(remaining[0]?.id ?? "starter_root");
    setAnchors((previous) => previous.filter((anchor) => !ids.has(anchor.cardId)));
    setDeleteCardId(null);
  };

  const activeLineage = activeCard ? lineageFor(cards, activeCard.id) : [];
  const themeLabel: Record<ThemeName, string> = {
    parchment: "纸页",
    midnight: "夜航",
    sage: "鼠尾草",
  };

  return (
    <div className={`atlas-workspace atlas-theme-${theme}`}>
      <header className="atlas-topbar">
        <div className="atlas-brand">
          <div className="atlas-mark">
            <Network size={18} />
          </div>
          <div>
            <p>Magic Atlas</p>
            <span>结构化知识探索</span>
          </div>
        </div>

        <div className="atlas-breadcrumb" aria-label="当前知识路径">
          {activeLineage.map((card, index) => (
            <button key={card.id} type="button" onClick={() => focusCard(card.id)}>
              {index > 0 ? <ChevronRight size={13} /> : null}
              <span>{card.title}</span>
            </button>
          ))}
        </div>

        <div className="atlas-toolbar">
          <Link href="/chat" className="atlas-icon-button" aria-label="返回线性对话" title="返回线性对话">
            <ArrowLeft size={17} />
          </Link>
          <button
            type="button"
            className="atlas-icon-button"
            onClick={() => setZoom((value) => Math.max(0.65, Number((value - 0.1).toFixed(2))))}
            aria-label="缩小"
          >
            <Minus size={16} />
          </button>
          <span className="atlas-zoom">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            className="atlas-icon-button"
            onClick={() => setZoom((value) => Math.min(1.1, Number((value + 0.1).toFixed(2))))}
            aria-label="放大"
          >
            <Plus size={16} />
          </button>
        </div>
      </header>

      <div className="atlas-shell">
        <aside className="atlas-sidebar">
          <form className="atlas-new-topic" onSubmit={startNewTopic}>
            <label htmlFor="atlas-topic">开启一条新主线</label>
            <div>
              <input
                id="atlas-topic"
                value={startTopic}
                onChange={(event) => setStartTopic(event.target.value)}
                placeholder="输入想彻底搞懂的问题…"
              />
              <button type="submit" aria-label="开始探索" disabled={!startTopic.trim()}>
                <ArrowRight size={16} />
              </button>
            </div>
          </form>

          <section className="atlas-side-section">
            <div className="atlas-section-title">
              <span>
                <Map size={15} />
                卡片树
              </span>
              <small>{cards.length}</small>
            </div>
            <div className="atlas-tree">
              {cards.map((card) => (
                <button
                  key={card.id}
                  type="button"
                  className={card.id === activeCardId ? "is-active" : ""}
                  onClick={() => focusCard(card.id)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    commitCards((previous) =>
                      previous.map((item) =>
                        item.id === card.id ? { ...item, unread: !item.unread } : item
                      )
                    );
                  }}
                  style={{ paddingLeft: `${14 + Math.max(0, lineageFor(cards, card.id).length - 1) * 13}px` }}
                  title="右键切换未读状态"
                >
                  <span className={`atlas-tree-dot relation-${card.relation}`} />
                  <span>{card.title}</span>
                  {card.unread ? <i aria-label="未读" /> : null}
                </button>
              ))}
            </div>
          </section>

          <section className="atlas-side-section">
            <div className="atlas-section-title">
              <span>
                <FileText size={15} />
                文档上下文
              </span>
              <Link href="/files">管理</Link>
            </div>
            {readyFiles.length ? (
              <div className="atlas-file-list">
                {readyFiles.slice(0, 5).map((file) => {
                  const checked = selectedAttachmentIds.includes(file.id);
                  return (
                    <label key={file.id} className={checked ? "is-checked" : ""}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => {
                          setSelectedAttachmentIds((previous) =>
                            event.target.checked
                              ? [...previous, file.id]
                              : previous.filter((id) => id !== file.id)
                          );
                        }}
                      />
                      <span>{file.fileName}</span>
                    </label>
                  );
                })}
              </div>
            ) : (
              <Link href="/files" className="atlas-empty-link">
                导入论文或资料
                <ArrowUpRight size={13} />
              </Link>
            )}
          </section>

          <section className="atlas-side-section atlas-summary">
            <div className="atlas-section-title">
              <span>
                <BookOpen size={15} />
                项目摘要
              </span>
            </div>
            {projectSummary ? (
              <div className="atlas-summary-copy">
                <AnnotatedMarkdown content={projectSummary} onTerm={() => {}} />
              </div>
            ) : (
              <p>把散开的卡片重新压缩成一条可复习的主线。</p>
            )}
            <button type="button" onClick={() => void summarizeProject()} disabled={summarizing}>
              {summarizing ? <Loader2 className="animate-spin" size={14} /> : <Sparkles size={14} />}
              {projectSummary ? "重新总结" : "智能总结"}
            </button>
          </section>

          <div className="atlas-theme-switcher">
            <span>主题</span>
            {(Object.keys(themeLabel) as ThemeName[]).map((item) => (
              <button
                key={item}
                type="button"
                className={theme === item ? "is-active" : ""}
                onClick={() => setTheme(item)}
                aria-label={`切换到${themeLabel[item]}主题`}
                title={themeLabel[item]}
              >
                <i className={`theme-${item}`} />
              </button>
            ))}
          </div>
        </aside>

        <main className="atlas-viewport" ref={viewportRef}>
          <div
            className="atlas-canvas-sizer"
            style={
              {
                width: canvasSize.width * zoom,
                height: canvasSize.height * zoom,
                "--mobile-height": `${cards.length * (CARD_HEIGHT + 32) + 48}px`,
              } as CSSProperties
            }
          >
            <div
              className="atlas-canvas"
              style={{
                width: canvasSize.width,
                height: canvasSize.height,
                transform: `scale(${zoom})`,
              }}
            >
              <div className="atlas-grid" />
              {edges.map((edge) => (
                <div
                  key={edge.id}
                  className={`atlas-edge relation-${edge.relation}`}
                  style={{
                    left: edge.x,
                    top: edge.y,
                    width: edge.width,
                    transform: `rotate(${edge.angle}deg)`,
                  }}
                />
              ))}

              {cards.map((card, cardIndex) => {
                const preview = termPreview?.cardId === card.id ? termPreview : null;
                const isActive = card.id === activeCardId;
                const inputValue = cardInputs[card.id] ?? "";
                return (
                  <article
                    key={card.id}
                    className={`knowledge-card relation-${card.relation} ${isActive ? "is-active" : ""}`}
                    style={
                      {
                        left: card.x,
                        top: card.y,
                        "--mobile-top": `${cardIndex * (CARD_HEIGHT + 32) + 24}px`,
                      } as CSSProperties
                    }
                  >
                    <header className="knowledge-card-header">
                      <div className="knowledge-card-index">
                        <span>
                          <RelationIcon relation={card.relation} />
                        </span>
                        {String(cardIndex + 1).padStart(2, "0")}
                      </div>
                      <button
                        type="button"
                        className="knowledge-card-heading"
                        onClick={() => focusCard(card.id)}
                        aria-label={`聚焦卡片：${card.title}`}
                      >
                        <small>{relationMeta[card.relation].label}</small>
                        <h2>{card.title}</h2>
                      </button>
                      <button
                        type="button"
                        className="knowledge-card-delete"
                        onClick={(event) => {
                          event.stopPropagation();
                          setDeleteCardId(card.id);
                        }}
                        aria-label={`删除${card.title}`}
                      >
                        <Trash2 size={15} />
                      </button>
                    </header>

                    <div className="knowledge-card-body">
                      {card.messages.length === 0 && card.status !== "streaming" ? (
                        <div className="knowledge-empty-card">
                          <HelpCircle size={26} />
                          <p>这张卡片还没有回答。</p>
                        </div>
                      ) : null}
                      {card.messages.map((message) =>
                        message.role === "user" ? (
                          <div key={message.id} className="knowledge-question">
                            <span>Q</span>
                            <p>{message.content}</p>
                          </div>
                        ) : (
                          <div
                            key={message.id}
                            className="knowledge-answer"
                            onMouseUp={captureSelection}
                          >
                            <AnnotatedMarkdown
                              content={message.content || "正在展开知识结构…"}
                              onTerm={(term) => void openTerm(card, term)}
                            />
                          </div>
                        )
                      )}

                      {preview ? (
                        <div className="atlas-term-preview">
                          <div>
                            <span>术语预览</span>
                            <button type="button" onClick={() => setTermPreview(null)} aria-label="关闭预览">
                              <X size={14} />
                            </button>
                          </div>
                          <h3>{preview.term}</h3>
                          {preview.loading ? (
                            <p className="atlas-preview-loading">
                              <Loader2 className="animate-spin" size={14} />
                              正在建立上下文解释…
                            </p>
                          ) : (
                            <p>{preview.error || preview.text}</p>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              setSpawnDraft({
                                parentId: card.id,
                                relation: "child",
                                value: `深入解释：${preview.term}`,
                              })
                            }
                          >
                            <ArrowUpRight size={14} />
                            展开为子卡片
                          </button>
                        </div>
                      ) : null}
                    </div>

                    <div className="knowledge-card-footer">
                      {quote && isActive ? (
                        <div className="atlas-quote-chip">
                          <span>已引用：{quote}</span>
                          <button type="button" onClick={() => setQuote("")} aria-label="取消引用">
                            <X size={12} />
                          </button>
                        </div>
                      ) : null}
                      <form
                        className="knowledge-followup"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void askCard(card.id, inputValue, quote);
                        }}
                      >
                        <input
                          value={inputValue}
                          onChange={(event) =>
                            setCardInputs((previous) => ({
                              ...previous,
                              [card.id]: event.target.value,
                            }))
                          }
                          placeholder="在当前卡片继续追问…"
                          disabled={card.status === "streaming"}
                        />
                        <button
                          type="submit"
                          disabled={!inputValue.trim() || card.status === "streaming"}
                          aria-label="发送追问"
                        >
                          {card.status === "streaming" ? (
                            <Loader2 className="animate-spin" size={15} />
                          ) : (
                            <Send size={15} />
                          )}
                        </button>
                      </form>

                      <div className="knowledge-spawn-actions">
                        <button
                          type="button"
                          onClick={() =>
                            setSpawnDraft({
                              parentId: card.id,
                              relation: "child",
                              value: "",
                            })
                          }
                        >
                          <ArrowUpRight size={15} />
                          <span>子卡片</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setSpawnDraft({
                              parentId: card.id,
                              relation: "related",
                              value: "",
                            })
                          }
                        >
                          <ArrowRight size={15} />
                          <span>关联</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setSpawnDraft({
                              parentId: card.id,
                              relation: "branch",
                              value: "",
                            })
                          }
                        >
                          <GitBranch size={15} />
                          <span>分支</span>
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </main>

        <aside className="atlas-inspector">
          <div className="atlas-inspector-heading">
            <div>
              <span>思维宇宙</span>
              <h2>{activeCard?.title ?? "未选择卡片"}</h2>
            </div>
            <BrainCircuit size={22} />
          </div>

          {activeCard ? (
            <>
              <div className="atlas-context-rule">
                <div>
                  <RelationIcon relation={activeCard.relation} />
                </div>
                <p>
                  <strong>{relationMeta[activeCard.relation].label}</strong>
                  {activeCard.relation === "child"
                    ? "读取上游标题与回答，聚焦一个概念。"
                    : activeCard.relation === "related"
                      ? "保留背景主题，横向比较相邻知识。"
                      : activeCard.relation === "branch"
                        ? "继承分支点之前的完整推理脉络。"
                        : "建立整个项目的核心问题与共同背景。"}
                </p>
              </div>

              <section className="atlas-understanding">
                <label htmlFor="atlas-understanding">用自己的话说说你的理解</label>
                <textarea
                  id="atlas-understanding"
                  value={understanding}
                  onChange={(event) => setUnderstanding(event.target.value)}
                  placeholder="例如：纠缠提供的是相关性资源，而不是可以控制的远程信号…"
                  rows={5}
                />
                <button
                  type="button"
                  onClick={() => void validateUnderstanding()}
                  disabled={!understanding.trim() || validatingUnderstanding}
                >
                  {validatingUnderstanding ? (
                    <Loader2 className="animate-spin" size={14} />
                  ) : (
                    <Sparkles size={14} />
                  )}
                  让 AI 校验并收录
                </button>
                {understandingReview ? (
                  <p
                    className={
                      understandingReview.includes("[认可]") ||
                      understandingReview.toLowerCase().includes("[accepted]")
                        ? "is-accepted"
                        : "is-revise"
                    }
                  >
                    {understandingReview}
                  </p>
                ) : null}
              </section>
            </>
          ) : null}

          <section className="atlas-anchor-list">
            <div className="atlas-section-title">
              <span>
                <BrainCircuit size={15} />
                我的知识锚点
              </span>
              <small>{anchors.length}</small>
            </div>
            {anchors.length ? (
              anchors.map((anchor) => (
                <button key={anchor.id} type="button" onClick={() => focusCard(anchor.cardId)}>
                  <span>
                    <Check size={12} />
                  </span>
                  <div>
                    <strong>{anchor.title}</strong>
                    <p>{anchor.understanding}</p>
                  </div>
                </button>
              ))
            ) : (
              <div className="atlas-empty-anchors">
                <BrainCircuit size={24} />
                <p>经过你复述并被校验的理解，会在这里形成个人知识锚点。</p>
              </div>
            )}
          </section>
        </aside>
      </div>

      {spawnDraft ? (
        <div className="atlas-modal-backdrop" role="presentation">
          <form
            className="atlas-spawn-modal"
            onSubmit={(event) => {
              event.preventDefault();
              spawnCard(spawnDraft);
            }}
          >
            <div className={`atlas-modal-relation relation-${spawnDraft.relation}`}>
              <RelationIcon relation={spawnDraft.relation} />
            </div>
            <div>
              <span>{relationMeta[spawnDraft.relation].label}</span>
              <h2>
                {spawnDraft.relation === "child"
                  ? "向下钻进一个概念"
                  : spawnDraft.relation === "related"
                    ? "从这里横向发散"
                    : "继承上下文，另起路线"}
              </h2>
            </div>
            <textarea
              autoFocus
              value={spawnDraft.value}
              onChange={(event) =>
                setSpawnDraft((previous) =>
                  previous ? { ...previous, value: event.target.value } : previous
                )
              }
              placeholder={
                spawnDraft.relation === "child"
                  ? "想深入理解哪个概念？"
                  : spawnDraft.relation === "related"
                    ? "想比较或联系什么？"
                    : "从哪个新问题继续？"
              }
              rows={4}
            />
            <div className="atlas-modal-actions">
              <button type="button" onClick={() => setSpawnDraft(null)}>
                取消
              </button>
              <button type="submit" disabled={!spawnDraft.value.trim()}>
                创建卡片
                <ArrowRight size={15} />
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {deleteCardId ? (
        <div className="atlas-modal-backdrop" role="presentation">
          <div className="atlas-delete-modal" role="dialog" aria-modal="true" aria-labelledby="delete-title">
            <div className="atlas-delete-icon">
              <Trash2 size={20} />
            </div>
            <span>确认操作</span>
            <h2 id="delete-title">删除这张卡片及其子卡片？</h2>
            <p>卡片中的对话和对应知识锚点会从当前设备移除，无法撤销。</p>
            <div className="atlas-modal-actions">
              <button type="button" onClick={() => setDeleteCardId(null)}>
                取消
              </button>
              <button type="button" className="is-danger" onClick={deleteCard}>
                确认删除
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
