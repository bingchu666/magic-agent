"use client";

import {
  AlertCircle,
  ArrowRight,
  ArrowUpRight,
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileUp,
  Folder as FolderIcon,
  GitBranch,
  Home,
  Loader2,
  Maximize2,
  Minimize2,
  Network,
  Paperclip,
  PanelLeft,
  Pencil,
  Plus,
  Send,
  Settings,
  Square,
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
import {
  ChatHistoryMessage,
  FileAsset,
  Folder,
  KnowledgeCardRecord,
  KnowledgeSourceRef,
  Locale,
  Message,
  Thread,
} from "@/lib/domain/types";
import { createId } from "@/lib/domain/utils";
import { MiniTreeMap, type MiniTreeNode } from "@/lib/ui/MiniTreeMap";
import {
  CONCEPT_HREF_PREFIX,
  ensureConceptAnnotations,
  toConceptLinkMarkdown,
} from "@/lib/agent/concept-annotations";
import {
  KnowledgeControlCenter,
  type ControlCenterMode,
} from "@/features/knowledge-explorer/KnowledgeControlCenter";

type CardRelation = "root" | "child" | "related" | "branch";
type CardStatus = "idle" | "streaming" | "error";

type KnowledgeMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  quotedText?: string;
  attachments?: Array<Pick<FileAsset, "id" | "fileName" | "mimeType" | "size">>;
  groundingChecked?: boolean;
  knowledgeSources?: KnowledgeSourceRef[];
};

type KnowledgeCard = {
  id: string;
  threadId?: string;
  parentId: string | null;
  // Only meaningful on root cards (relation === "root") — mirrors the DB
  // CHECK constraint. Populated by the server reconcile; no UI reads it yet
  // (that's Phase C's folders sidebar), but the field ships now so that
  // phase doesn't need another data-shape migration.
  folderId?: string | null;
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
  cardAttachmentIds: Record<string, string[]>;
};

type SpawnDraft = {
  parentId: string;
  relation: Exclude<CardRelation, "root">;
  value: string;
  sourceTerm?: string;
  presetKnowledgeSources?: KnowledgeSourceRef[];
};

type TermPreview = {
  cardId: string;
  term: string;
  text: string;
  loading: boolean;
  error?: string;
};

type SelectionAction = {
  cardId: string;
  text: string;
  left: number;
  top: number;
};

type PendingKnowledgeUpload = {
  localId: string;
  cardId: string;
  fileName: string;
  fileId?: string;
  stage: "queued" | "uploading" | "processing" | "failed";
  error?: string;
};

type FileProcessingDetail = {
  file: FileAsset;
  jobs: Array<{
    status: "queued" | "processing" | "done" | "failed";
    error?: string;
  }>;
};

const STORAGE_KEY = "magic_atlas_glass_stage_v2";
// Keep in sync with the max-height on .knowledge-stage-composer textarea —
// caps auto-grow at roughly 5-6 lines before the textarea scrolls internally.
const COMPOSER_MAX_HEIGHT_PX = 140;
const FILE_PROCESSING_TIMEOUT_MS = 180_000;
const FILE_POLL_INTERVAL_MS = 800;

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

const relationMetaByLocale: Record<
  Locale,
  Record<CardRelation, { label: string; prompt: string }>
> = {
  zh: {
    root: { label: "主线卡片", prompt: "建立项目的核心问题与共同背景" },
    child: { label: "子卡片 · 深入概念", prompt: "向下钻进一个概念" },
    related: { label: "关联卡片 · 横向发散", prompt: "横向比较相邻知识" },
    branch: { label: "分支卡片 · 继承上下文", prompt: "继承上下文，另起路线" },
  },
  en: {
    root: { label: "Main card", prompt: "Establish the project’s core question and shared context" },
    child: { label: "Child card · Deep dive", prompt: "Go deeper into one concept" },
    related: { label: "Related card · Explore", prompt: "Compare adjacent ideas" },
    branch: { label: "Branch card · Continue context", prompt: "Carry context into a new direction" },
  },
};

function createStarterCards(locale: Locale = "zh"): KnowledgeCard[] {
  const zh = locale === "zh";
  return [
    {
      id: "glass_starter",
      parentId: null,
      relation: "root",
      title: zh ? "开始探索" : "Start exploring",
      question: zh
        ? "输入一个问题，建立你的第一张知识卡片"
        : "Ask a question to create your first knowledge card",
      status: "idle",
      unread: false,
      createdAt: new Date().toISOString(),
      messages: [
        {
          id: "glass_starter_assistant",
          role: "assistant",
          content: zh
            ? "这里不再是线性聊天框。AI 会把值得继续理解的[[关键词]]标出来：点击后先看一个小预览，只有你确认创建，才会从当前节点展开一张新的独立卡片。\n\n右侧导航会自动记录卡片之间的父子关系；数据库命中情况也会显示在每次回答下方。"
            : "This is no longer a linear chat. AI marks useful [[concepts]] for deeper exploration: preview one, then confirm to open a new independent card from the current node.\n\nThe navigator records parent-child relationships automatically and each answer shows whether the knowledge base was used.",
        },
      ],
    },
  ];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function cleanTitle(value: string) {
  return value
    .replace(/\[\[|\]\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 34);
}

const KNOWLEDGE_SOURCE_LABEL: Record<KnowledgeSourceRef["source"], string> = {
  term: "术语库",
  trick: "技巧库",
  person: "人物库",
};

// Trick hits and term-glossary hits are visually indistinguishable if just
// joined as plain titles — tag each with which table it actually came from.
function formatKnowledgeSources(sources: KnowledgeSourceRef[]) {
  return sources
    .map((item) => `[${KNOWLEDGE_SOURCE_LABEL[item.source]}] ${item.title}`)
    .join(" · ");
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
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
        content: (
          message.quotedText
            ? `Selected passage: “${message.quotedText}”\nQuestion: ${message.content}`
            : message.content
        ).replace(/\[\[|\]\]/g, ""),
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

function attachmentIdsFromMessageHistory(cards: KnowledgeCard[]) {
  return cards.reduce<Record<string, string[]>>((result, card) => {
    const ids = Array.from(
      new Set(
        card.messages.flatMap((message) =>
          (message.attachments ?? []).map((attachment) => attachment.id)
        )
      )
    );
    if (ids.length > 0) result[card.id] = ids;
    return result;
  }, {});
}

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}

/**
 * Raw dictionary lookup (no AI, no translation) used to ground the
 * "创建分支并放大" follow-up in the term-preview popover. Checks the
 * magician biography dictionary and the term glossary (server picks
 * whichever matches — see /api/explore's "termLookup" mode), so a clicked
 * magician name grounds the same way a clicked term does. A failed lookup
 * should never block branch creation — it just means the follow-up proceeds
 * without forced grounding, same as before this existed.
 */
async function lookupKnowledgeDictionaryMatch(
  term: string
): Promise<{ term: string; definition: string; source: "term" | "person" } | null> {
  try {
    const result = await apiJson<{
      matched: boolean;
      term?: string;
      definition?: string;
      source?: "term" | "person";
    }>("/api/explore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "termLookup", term }),
    });
    return result.matched && result.definition
      ? { term: result.term || term, definition: result.definition, source: result.source ?? "term" }
      : null;
  } catch (error) {
    console.warn("Knowledge dictionary lookup failed", error);
    return null;
  }
}

function AnnotatedMarkdown({
  content,
  onTerm,
  locale,
}: {
  content: string;
  onTerm: (term: string) => void;
  locale: Locale;
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
                title={locale === "zh" ? `预览并追问：${term}` : `Preview and ask: ${term}`}
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

// Pinned row for one folder in the "对话/Chats" sidebar list, sorted above
// the flat conversation list — styled like a conversation row (folder icon,
// name, card count) so it reads as "a pinned item in the same list," not a
// separate collapsible section. Clicking it opens the dedicated FolderView
// overlay rather than expanding anything in place.
function FolderRow({
  folder,
  count,
  locale,
  onOpen,
  onRename,
  onDelete,
}: {
  folder: Folder;
  count: number;
  locale: Locale;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="is-folder-row">
      <button
        type="button"
        className="knowledge-stage-project-select is-root-project is-folder"
        onClick={onOpen}
        aria-label={locale === "zh" ? `打开文件夹：${folder.name}` : `Open folder: ${folder.name}`}
      >
        <FolderIcon size={15} />
        <strong>
          <span className="knowledge-stage-project-title-text">{folder.name}</span>
        </strong>
        <i>{count}</i>
      </button>
      <button
        type="button"
        className="knowledge-stage-project-delete"
        onClick={onRename}
        aria-label={locale === "zh" ? `重命名文件夹：${folder.name}` : `Rename folder: ${folder.name}`}
        title={locale === "zh" ? "重命名" : "Rename"}
      >
        <Pencil size={13} />
      </button>
      <button
        type="button"
        className="knowledge-stage-project-delete"
        onClick={onDelete}
        aria-label={locale === "zh" ? `删除文件夹：${folder.name}` : `Delete folder: ${folder.name}`}
        title={locale === "zh" ? "删除文件夹" : "Delete folder"}
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

// One row in the sidebar's root-card list — identical markup whether it's
// rendered in the sidebar's flat list or inside the FolderView overlay. The
// move-to-folder control only appears once at least one folder exists
// (showMoveMenu), which is what keeps the zero-folder case pixel-identical
// to the sidebar's original flat list.
function CardRow({
  card,
  isActive,
  locale,
  folders,
  showMoveMenu,
  moveMenuOpen,
  onOpen,
  onDelete,
  onToggleMoveMenu,
  onMoveToFolder,
  onCreateFolderForCard,
}: {
  card: KnowledgeCard;
  isActive: boolean;
  locale: Locale;
  folders: Folder[];
  showMoveMenu: boolean;
  moveMenuOpen: boolean;
  onOpen: () => void;
  onDelete: () => void;
  onToggleMoveMenu: () => void;
  onMoveToFolder: (folderId: string | null) => void;
  onCreateFolderForCard: () => void;
}) {
  return (
    <div className={`${isActive ? "is-active" : ""} ${showMoveMenu ? "has-move" : ""}`}>
      <button
        type="button"
        className="knowledge-stage-project-select is-root-project"
        onClick={onOpen}
        aria-label={locale === "zh" ? `打开对话：${card.title}` : `Open: ${card.title}`}
      >
        <strong>
          <span className="knowledge-stage-project-title-text">{card.title}</span>
        </strong>
      </button>
      {showMoveMenu ? (
        <div className="knowledge-stage-move-wrap">
          <button
            type="button"
            className={moveMenuOpen ? "is-open" : ""}
            onClick={onToggleMoveMenu}
            aria-label={locale === "zh" ? `移动到文件夹：${card.title}` : `Move to folder: ${card.title}`}
            title={locale === "zh" ? "移动到文件夹" : "Move to folder"}
            aria-expanded={moveMenuOpen}
            aria-haspopup="menu"
          >
            <FolderIcon size={13} />
          </button>
          {moveMenuOpen ? (
            <div className="knowledge-stage-move-menu" role="menu">
              {folders.map((folder) => (
                <button
                  key={folder.id}
                  type="button"
                  role="menuitem"
                  className={card.folderId === folder.id ? "is-current" : ""}
                  onClick={() => onMoveToFolder(folder.id)}
                >
                  <FolderIcon size={13} />
                  <span>{folder.name}</span>
                </button>
              ))}
              {card.folderId ? (
                <button type="button" role="menuitem" onClick={() => onMoveToFolder(null)}>
                  <X size={13} />
                  <span>{locale === "zh" ? "移出文件夹" : "Remove from folder"}</span>
                </button>
              ) : null}
              <button type="button" role="menuitem" className="is-create" onClick={onCreateFolderForCard}>
                <Plus size={13} />
                <span>{locale === "zh" ? "新建文件夹" : "New folder"}</span>
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      <button
        type="button"
        className="knowledge-stage-project-delete"
        onClick={onDelete}
        aria-label={locale === "zh" ? `删除对话：${card.title}` : `Delete: ${card.title}`}
        title={locale === "zh" ? "删除对话" : "Delete"}
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

// Dedicated overlay shown when a folder row is clicked — a separate view for
// that folder's cards, modeled on `KnowledgeControlCenter`'s panel structure.
// The sidebar itself never expands in place; this is the only way into a
// folder's contents.
function FolderView({
  folder,
  cards,
  activeCardId,
  locale,
  folders,
  moveMenuCardId,
  onClose,
  onRename,
  onDelete,
  onOpenCard,
  onDeleteCard,
  onToggleMoveMenu,
  onMoveToFolder,
  onCreateFolderForCard,
}: {
  folder: Folder;
  cards: KnowledgeCard[];
  activeCardId: string | undefined;
  locale: Locale;
  folders: Folder[];
  moveMenuCardId: string | null;
  onClose: () => void;
  onRename: () => void;
  onDelete: () => void;
  onOpenCard: (cardId: string) => void;
  onDeleteCard: (cardId: string) => void;
  onToggleMoveMenu: (cardId: string) => void;
  onMoveToFolder: (cardId: string, folderId: string | null) => void;
  onCreateFolderForCard: (cardId: string) => void;
}) {
  return (
    <div className="knowledge-folder-view-backdrop" onClick={onClose}>
      <div className="knowledge-folder-view" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <div className="knowledge-folder-view-icon">
              <FolderIcon size={18} />
            </div>
            <div>
              <small>{locale === "zh" ? "文件夹" : "Folder"}</small>
              <h2>{folder.name}</h2>
            </div>
          </div>
          <div className="knowledge-folder-view-actions">
            <button
              type="button"
              onClick={onRename}
              aria-label={locale === "zh" ? "重命名文件夹" : "Rename folder"}
              title={locale === "zh" ? "重命名" : "Rename"}
            >
              <Pencil size={15} />
            </button>
            <button
              type="button"
              onClick={onDelete}
              aria-label={locale === "zh" ? "删除文件夹" : "Delete folder"}
              title={locale === "zh" ? "删除文件夹" : "Delete folder"}
            >
              <Trash2 size={15} />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label={locale === "zh" ? "关闭" : "Close"}
              title={locale === "zh" ? "关闭" : "Close"}
            >
              <X size={15} />
            </button>
          </div>
        </header>
        <div className="knowledge-folder-view-body">
          {cards.length === 0 ? (
            <div className="knowledge-folder-view-empty">
              <FolderIcon size={28} />
              <p>
                {locale === "zh"
                  ? "这个文件夹还是空的。可以在对话列表里点击移动图标，把对话移进来。"
                  : "This folder is empty. Use a card's move icon in the chat list to add one."}
              </p>
            </div>
          ) : (
            <nav className="knowledge-card-row-list">
              {cards.map((card) => (
                <CardRow
                  key={card.id}
                  card={card}
                  isActive={card.id === activeCardId}
                  locale={locale}
                  folders={folders}
                  showMoveMenu
                  moveMenuOpen={moveMenuCardId === card.id}
                  onOpen={() => onOpenCard(card.id)}
                  onDelete={() => onDeleteCard(card.id)}
                  onToggleMoveMenu={() => onToggleMoveMenu(card.id)}
                  onMoveToFolder={(folderId) => onMoveToFolder(card.id, folderId)}
                  onCreateFolderForCard={() => onCreateFolderForCard(card.id)}
                />
              ))}
            </nav>
          )}
        </div>
      </div>
    </div>
  );
}

function KnowledgeCardConversation({
  card,
  onTerm,
  onTextSelection,
  bodyRef,
  locale,
  compact = false,
}: {
  card: KnowledgeCard;
  onTerm: (term: string) => void;
  onTextSelection: (text: string, rect: DOMRect) => void;
  bodyRef?: Ref<HTMLDivElement>;
  locale: Locale;
  compact?: boolean;
}) {
  const zh = locale === "zh";
  const captureSelection = (container: HTMLElement) => {
    window.requestAnimationFrame(() => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      if (!container.contains(range.commonAncestorContainer)) return;
      const text = selection.toString().replace(/\s+/g, " ").trim();
      if (text.length < 2) return;
      const rect = range.getBoundingClientRect();
      if (!rect.width && !rect.height) return;
      onTextSelection(text.slice(0, 1200), rect);
    });
  };

  return (
    <div
      className={`knowledge-stage-card-body ${compact ? "is-compact" : ""}`}
      ref={bodyRef}
    >
      {card.messages.length === 0 ? (
        <div className="knowledge-stage-empty">
          <Network size={28} />
          <h2>{zh ? "准备建立这张知识卡片" : "Ready to build this knowledge card"}</h2>
          <p>{zh ? "在下方输入问题，回答会在这里展开。" : "Ask below and the answer will unfold here."}</p>
        </div>
      ) : null}

      {card.messages.map((message) =>
        message.role === "user" ? (
          <div key={message.id} className="knowledge-stage-question">
            {message.quotedText ? (
              <blockquote>
                <ArrowRight size={14} />
                <span>{message.quotedText}</span>
              </blockquote>
            ) : null}
            {message.attachments?.length ? (
              <div className="knowledge-stage-question-files">
                {message.attachments.map((file) => (
                  <div key={file.id}>
                    <span>
                      <FileUp size={15} />
                    </span>
                    <div>
                      <strong>{file.fileName}</strong>
                      <small>{formatFileSize(file.size)}</small>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            <p>{message.content}</p>
          </div>
        ) : (
          <section
            key={message.id}
            className="knowledge-stage-answer"
            onPointerUp={(event) => captureSelection(event.currentTarget)}
          >
            <div className="knowledge-stage-thinking">
              {card.status === "streaming" && !message.content ? (
                <>
                  <Loader2 className="animate-spin" size={15} />
                  {zh ? "正在读取上下文与知识库" : "Reading context and knowledge base"}
                </>
              ) : (
                <>
                  <span />
                  {zh ? "AI 回答" : "AI answer"}
                </>
              )}
            </div>
            <AnnotatedMarkdown
              content={message.content || (zh ? "正在展开知识结构…" : "Building the knowledge structure…")}
              onTerm={onTerm}
              locale={locale}
            />
            {message.groundingChecked ? (
              message.knowledgeSources?.length ? (
                <div className="knowledge-stage-grounding is-hit">
                  <Check size={14} />
                  <div>
                    <strong>{zh ? "已引用数据库" : "Knowledge base cited"}</strong>
                    <span>{formatKnowledgeSources(message.knowledgeSources)}</span>
                  </div>
                </div>
              ) : (
                <div className="knowledge-stage-grounding is-miss">
                  <Network size={14} />
                  <div>
                  <strong>{zh ? "本次未命中知识库" : "No knowledge-base match"}</strong>
                  <span>{zh ? "回答来自通用模型，没有伪造数据库引用" : "The answer comes from the general model; no database citation was invented."}</span>
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
  const relationMeta = relationMetaByLocale[locale];
  const [cards, setCards] = useState<KnowledgeCard[]>(() => createStarterCards(locale));
  const cardsRef = useRef(cards);
  const [activeCardId, setActiveCardId] = useState("glass_starter");
  const activeCardIdRef = useRef(activeCardId);
  const [cardInputs, setCardInputs] = useState<Record<string, string>>({});
  const [cardSelectionContexts, setCardSelectionContexts] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<FileAsset[]>([]);
  const [cardAttachmentIds, setCardAttachmentIds] = useState<Record<string, string[]>>({});
  const [pendingUploads, setPendingUploads] = useState<PendingKnowledgeUpload[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);
  const [composerDragActive, setComposerDragActive] = useState(false);
  const [controlCenterMode, setControlCenterMode] = useState<ControlCenterMode | null>(null);
  const [spawnDraft, setSpawnDraft] = useState<SpawnDraft | null>(null);
  const [spawnError, setSpawnError] = useState("");
  const [creatingCard, setCreatingCard] = useState(false);
  const [termPreview, setTermPreview] = useState<TermPreview | null>(null);
  const [selectionAction, setSelectionAction] = useState<SelectionAction | null>(null);
  const [deleteCardId, setDeleteCardId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pageError, setPageError] = useState("");
  const [hydrated, setHydrated] = useState(false);
  // Populated by the background server-reconcile effect below.
  const [folders, setFolders] = useState<Folder[]>([]);
  // Id of the folder whose dedicated FolderView overlay is currently open —
  // null means no overlay. Deliberately not persisted, matching how
  // `expandedCardId` also always resets rather than remembering state.
  const [openFolderView, setOpenFolderView] = useState<string | null>(null);
  const [moveMenuCardId, setMoveMenuCardId] = useState<string | null>(null);
  const [folderModal, setFolderModal] = useState<
    { mode: "create"; assignToCardId?: string } | { mode: "rename"; folderId: string } | null
  >(null);
  const [folderNameDraft, setFolderNameDraft] = useState("");
  const [folderModalError, setFolderModalError] = useState("");
  const [savingFolder, setSavingFolder] = useState(false);
  const [deleteFolderId, setDeleteFolderId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);
  const [childCardDragPosition, setChildCardDragPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const [isDraggingChildCard, setIsDraggingChildCard] = useState(false);
  const cardBodyRef = useRef<HTMLDivElement | null>(null);
  const stackRef = useRef<HTMLDivElement | null>(null);
  const childCardRef = useRef<HTMLDivElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const uploadMenuRef = useRef<HTMLDivElement | null>(null);
  const selectionActionRef = useRef<HTMLDivElement | null>(null);
  const childCardDragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startLeft: number;
    startTop: number;
  } | null>(null);
  // Cards can stream concurrently, so each gets its own controller keyed by id.
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());

  const commitCards = (
    update: KnowledgeCard[] | ((previous: KnowledgeCard[]) => KnowledgeCard[])
  ) => {
    const next = typeof update === "function" ? update(cardsRef.current) : update;
    cardsRef.current = next;
    setCards(next);
  };

  // Fire-and-forget metadata sync to the server — every call site below
  // already committed the change locally first, so the UI never waits on
  // this. Failures are swallowed (logged only): the local state stays the
  // source of truth for this tab, and the next successful sync self-heals
  // any drift. If the row doesn't exist yet server-side (e.g. the built-in
  // starter card, or any card created on a device from before this synced
  // to the server), fall back to creating it instead of losing the update.
  const syncKnowledgeCardPatch = (
    cardId: string,
    patch: Partial<{
      title: string;
      question: string;
      status: "idle" | "error";
      unread: boolean;
      threadId: string | null;
      folderId: string | null;
    }>
  ) => {
    void (async () => {
      try {
        const response = await fetch(`/api/knowledge-cards/${cardId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (response.status === 404) {
          const card = cardsRef.current.find((item) => item.id === cardId);
          if (card) syncCreateKnowledgeCard(card);
          return;
        }
        if (!response.ok) {
          console.warn("Failed to sync card update", await response.text().catch(() => ""));
        }
      } catch (error) {
        console.warn("Failed to sync card update", error);
      }
    })();
  };

  // Reads the card's current fields straight off cardsRef (always fresh,
  // even mid-render) and syncs the metadata columns as a single patch —
  // shared by every call site so each one doesn't hand-assemble its own
  // partial payload.
  const syncCardMetadata = (cardId: string) => {
    const card = cardsRef.current.find((item) => item.id === cardId);
    if (!card) return;
    syncKnowledgeCardPatch(cardId, {
      title: card.title,
      question: card.question,
      status: card.status === "streaming" ? undefined : card.status,
      unread: card.unread,
      threadId: card.threadId ?? null,
      folderId: card.folderId ?? null,
    });
  };

  const syncCreateKnowledgeCard = (card: KnowledgeCard) => {
    void apiJson("/api/knowledge-cards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: card.id,
        threadId: card.threadId,
        parentId: card.parentId,
        folderId: card.folderId,
        relation: card.relation,
        title: card.title,
        question: card.question,
      }),
    }).catch((error) => {
      console.warn("Failed to sync new card to server", error);
    });
  };

  // Cross-device message hydration: a card synced in by the reconcile
  // effect below arrives with metadata only (title, tree position, etc) —
  // its message history lives in threads/messages and has to be fetched
  // separately. Guarded so it only ever fills a genuinely empty card, and
  // the commit itself re-checks message length at apply time (not just at
  // call time) so it can never clobber messages askCard already streamed
  // in while this fetch was in flight.
  const hydrateCardMessages = async (card: KnowledgeCard) => {
    if (!card.threadId || card.messages.length > 0) return;
    try {
      const data = await apiJson<{ items: Message[] }>(`/api/threads/${card.threadId}/messages`);
      if (data.items.length === 0) return;
      const mapped: KnowledgeMessage[] = data.items
        .filter((message) => message.role === "user" || message.role === "assistant")
        .map((message) => ({
          id: message.id,
          role: message.role as "user" | "assistant",
          content: message.content,
          attachments: (message.attachmentIds ?? [])
            .map((fileId) => files.find((file) => file.id === fileId))
            .filter((file): file is FileAsset => Boolean(file))
            .map((file) => ({
              id: file.id,
              fileName: file.fileName,
              mimeType: file.mimeType,
              size: file.size,
            })),
        }));
      commitCards((previous) =>
        previous.map((item) =>
          item.id === card.id && item.messages.length === 0
            ? { ...item, messages: mapped }
            : item
        )
      );
    } catch (error) {
      console.warn("Failed to hydrate card messages", error);
    }
  };

  const loadFiles = async () => {
    const data = await apiJson<{ items: FileAsset[] }>("/api/files");
    setFiles(data.items);
  };

  const waitForFileReady = async (fileId: string) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < FILE_PROCESSING_TIMEOUT_MS) {
      const detail = await apiJson<FileProcessingDetail>(`/api/files/${fileId}`);
      setFiles((previous) => {
        const withoutCurrent = previous.filter((file) => file.id !== detail.file.id);
        return [detail.file, ...withoutCurrent];
      });

      if (detail.file.status === "ready") return detail.file;
      if (detail.file.status === "failed") {
        const jobError = detail.jobs.find((job) => job.status === "failed")?.error;
        throw new Error(
          locale === "zh"
            ? `文件解析失败${jobError ? `：${jobError}` : ""}`
            : `File parsing failed${jobError ? `: ${jobError}` : ""}`
        );
      }
      if (detail.file.status === "expired") {
        throw new Error(locale === "zh" ? "文件已过期" : "The file expired");
      }
      await delay(FILE_POLL_INTERVAL_MS);
    }

    throw new Error(
      locale === "zh"
        ? "文件解析超时，请稍后在资料库中查看状态。"
        : "File processing timed out. Check its status in the source library."
    );
  };

  useEffect(() => {
    activeCardIdRef.current = activeCardId;
  }, [activeCardId]);

  useEffect(() => {
    void loadFiles().catch(() => {
      // Upload errors are surfaced when the user actually interacts with the
      // composer. A stale library list should not block the card workspace.
    });
  }, [user?.id]);

  useEffect(() => {
    setUploadMenuOpen(false);
    setComposerDragActive(false);
    setSelectionAction(null);
  }, [activeCardId]);

  useEffect(() => {
    if (!selectionAction) return;

    const closeSelectionAction = (event: PointerEvent) => {
      if (!selectionActionRef.current?.contains(event.target as Node)) {
        setSelectionAction(null);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectionAction(null);
    };
    const closeOnScroll = () => setSelectionAction(null);

    document.addEventListener("pointerdown", closeSelectionAction);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("scroll", closeOnScroll, true);
    return () => {
      document.removeEventListener("pointerdown", closeSelectionAction);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("scroll", closeOnScroll, true);
    };
  }, [selectionAction]);

  useEffect(() => {
    if (!uploadMenuOpen) return;

    const closeMenu = (event: PointerEvent) => {
      if (!uploadMenuRef.current?.contains(event.target as Node)) {
        setUploadMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setUploadMenuOpen(false);
    };

    document.addEventListener("pointerdown", closeMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [uploadMenuOpen]);

  useEffect(() => {
    if (!moveMenuCardId) return;

    // Matched by class rather than a ref (unlike the upload menu above)
    // because this menu can open from any card row in the sidebar list —
    // a single ref can't follow whichever row is currently open.
    const closeMenu = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest?.(".knowledge-stage-move-wrap")) {
        setMoveMenuCardId(null);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMoveMenuCardId(null);
    };

    document.addEventListener("pointerdown", closeMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [moveMenuCardId]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const stored = JSON.parse(raw) as Partial<StoredWorkspace>;
        const storedCards =
          Array.isArray(stored.cards) && stored.cards.length > 0
            ? stored.cards
            : [];
        if (storedCards.length > 0) {
          commitCards(storedCards);
          const storedActive = storedCards.some((card) => card.id === stored.activeCardId)
            ? stored.activeCardId
            : storedCards[0].id;
          setActiveCardId(storedActive ?? storedCards[0].id);
        }
        if (
          stored.cardAttachmentIds &&
          typeof stored.cardAttachmentIds === "object"
        ) {
          const restored = Object.entries(stored.cardAttachmentIds).reduce<
            Record<string, string[]>
          >((result, [cardId, ids]) => {
            const validIds = Array.isArray(ids)
              ? ids.filter((id): id is string => typeof id === "string")
              : [];
            if (validIds.length > 0) result[cardId] = validIds;
            return result;
          }, {});
          setCardAttachmentIds(restored);
        } else if (storedCards.length > 0) {
          // Older workspace versions cleared attachment state after the first
          // question. Recover it from the attachment metadata already stored
          // on that card's user message so existing conversations keep working.
          setCardAttachmentIds(attachmentIdsFromMessageHistory(storedCards));
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
    const workspace: StoredWorkspace = {
      cards,
      activeCardId,
      cardAttachmentIds,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
  }, [activeCardId, cardAttachmentIds, cards, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    const localizedStarter = createStarterCards(locale)[0];
    commitCards((previous) =>
      previous.map((card) => {
        const stillUntouchedStarter =
          card.id === "glass_starter" &&
          card.messages.some((message) => message.id === "glass_starter_assistant");
        return stillUntouchedStarter ? localizedStarter : card;
      })
    );
  }, [hydrated, locale]);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(
      "magic_atlas_sidebar_open",
      String(sidebarOpen)
    );
  }, [hydrated, sidebarOpen]);

  // Background server reconcile — runs once per login, after the
  // instant-first-paint localStorage hydrate above already ran. Local-first,
  // not a replace: merges only tree/UI metadata (never .messages, never the
  // ephemeral "streaming" status) into cards that already exist locally by
  // id, and appends any card the server knows about that this browser
  // doesn't yet (e.g. created on another device). A card that exists only
  // locally and was never synced is left alone here — it starts syncing
  // forward the next time one of the mutation call sites touches it.
  useEffect(() => {
    if (!hydrated || !user?.id) return;
    let cancelled = false;
    void (async () => {
      try {
        const [folderData, cardData] = await Promise.all([
          apiJson<{ items: Folder[] }>("/api/folders"),
          apiJson<{ items: KnowledgeCardRecord[] }>("/api/knowledge-cards"),
        ]);
        if (cancelled) return;
        setFolders(folderData.items);

        commitCards((previous) => {
          const localIds = new Set(previous.map((card) => card.id));
          const merged = previous.map((card) => {
            const remote = cardData.items.find((item) => item.id === card.id);
            if (!remote) return card;
            return {
              ...card,
              title: remote.title || card.title,
              unread: remote.unread,
              folderId: remote.folderId,
              parentId: remote.parentId,
              relation: remote.relation,
              threadId: remote.threadId ?? card.threadId,
            };
          });
          const additions: KnowledgeCard[] = cardData.items
            .filter((remote) => !localIds.has(remote.id))
            .map((remote) => ({
              id: remote.id,
              threadId: remote.threadId ?? undefined,
              parentId: remote.parentId,
              folderId: remote.folderId,
              relation: remote.relation,
              title: remote.title,
              question: remote.question,
              messages: [],
              status: remote.status,
              unread: remote.unread,
              createdAt: remote.createdAt,
            }));
          return additions.length > 0 ? [...merged, ...additions] : merged;
        });
      } catch (error) {
        console.warn("Failed to sync folders/knowledge cards from server", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated, user?.id]);

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
  const sidebarRootCards = useMemo(
    () =>
      [...cards]
        .filter((card) => card.parentId === null)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    [cards]
  );
  const cardsByFolder = useMemo(() => {
    const byFolder = new Map<string, KnowledgeCard[]>();
    const unfiled: KnowledgeCard[] = [];
    for (const card of sidebarRootCards) {
      if (card.folderId) {
        const list = byFolder.get(card.folderId);
        if (list) list.push(card);
        else byFolder.set(card.folderId, [card]);
      } else {
        unfiled.push(card);
      }
    }
    return { byFolder, unfiled };
  }, [sidebarRootCards]);
  const nextCard = activeCard
    ? [...cards]
        .filter((card) => card.parentId === activeCard.id)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]
    : undefined;
  const childExpanded = Boolean(
    parentCard && activeCard && expandedCardId === activeCard.id
  );
  const baseExpanded = Boolean(
    !parentCard && stageBaseCard && expandedCardId === stageBaseCard.id
  );
  const inputValue = activeCard ? cardInputs[activeCard.id] ?? "" : "";
  const composerTextareaRef = useRef<HTMLTextAreaElement>(null);
  const activeAttachmentIds = activeCard ? cardAttachmentIds[activeCard.id] ?? [] : [];
  const activeAttachments = activeAttachmentIds
    .map((fileId) => files.find((file) => file.id === fileId))
    .filter((file): file is FileAsset => Boolean(file));
  const activePendingUploads = activeCard
    ? pendingUploads.filter((file) => file.cardId === activeCard.id)
    : [];
  const activeSelectionContext = activeCard
    ? cardSelectionContexts[activeCard.id] ?? ""
    : "";

  useEffect(() => {
    // Covers both "opened on a new device" (the card just arrived via the
    // reconcile effect above with metadata only) and "focused any card that
    // still has no messages but does have a real thread" — e.g. self-healing
    // local data that lost its messages. A card with no threadId yet (never
    // asked anything) is correctly left alone; there's nothing to fetch.
    if (!activeCard || !activeCard.threadId || activeCard.messages.length > 0) return;
    void hydrateCardMessages(activeCard);
    // Deliberately narrow deps: these three primitives are exactly the
    // guard condition above, so the effect only re-fires when one actually
    // changes. Listing the whole `activeCard` object (a new reference every
    // render) or `hydrateCardMessages` (recreated every render, always
    // closes over current state) would refire this mid-fetch on unrelated
    // re-renders and issue duplicate concurrent hydration requests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCard?.id, activeCard?.threadId, activeCard?.messages.length]);

  useEffect(() => {
    // Dragging is only remembered for as long as this card stays open —
    // reopening it (or switching to a different card) restores the default position.
    setChildCardDragPosition(null);
  }, [activeCard?.id]);

  useEffect(() => {
    // Auto-grow the composer with content, up to COMPOSER_MAX_HEIGHT_PX
    // (~5-6 lines — see the matching max-height in .knowledge-stage-composer
    // textarea), then let the textarea's own scrollbar take over. Re-measure
    // whenever the visible text changes, including on card switches.
    const el = composerTextareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_HEIGHT_PX)}px`;
  }, [inputValue]);

  const handleChildCardDragStart = (event: React.PointerEvent<HTMLElement>) => {
    if (childExpanded) return;
    if ((event.target as HTMLElement).closest("button")) return;
    const cardEl = childCardRef.current;
    const stackEl = stackRef.current;
    if (!cardEl || !stackEl) return;

    const cardRect = cardEl.getBoundingClientRect();
    const stackRect = stackEl.getBoundingClientRect();
    const startLeft = cardRect.left - stackRect.left;
    const startTop = cardRect.top - stackRect.top;

    childCardDragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startLeft,
      startTop,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setChildCardDragPosition({ left: startLeft, top: startTop });
    setIsDraggingChildCard(true);
  };

  const handleChildCardDragMove = (event: React.PointerEvent<HTMLElement>) => {
    const drag = childCardDragRef.current;
    const cardEl = childCardRef.current;
    const stackEl = stackRef.current;
    // .knowledge-stage-main is the actual overflow:hidden boundary (and sits
    // to the right of the rail sidebar, which paints above the card) — clamp
    // against its real rect rather than the narrower stack, so a drag can
    // never tuck the card behind the rail or past the true clipped edge.
    const mainEl = stackEl?.parentElement ?? null;
    if (!drag || drag.pointerId !== event.pointerId || !cardEl || !stackEl || !mainEl) return;

    const SAFE_MARGIN = 8;
    const mainRect = mainEl.getBoundingClientRect();
    const stackRect = stackEl.getBoundingClientRect();
    const dx = event.clientX - drag.startClientX;
    const dy = event.clientY - drag.startClientY;

    const minLeft = 0;
    const maxLeft = Math.max(
      minLeft,
      mainRect.right - stackRect.left - cardEl.offsetWidth - SAFE_MARGIN
    );
    const minTop = 0;
    const maxTop = Math.max(
      minTop,
      mainRect.bottom - stackRect.top - cardEl.offsetHeight - SAFE_MARGIN
    );

    const nextLeft = clamp(drag.startLeft + dx, minLeft, maxLeft);
    const nextTop = clamp(drag.startTop + dy, minTop, maxTop);
    setChildCardDragPosition({ left: nextLeft, top: nextTop });
  };

  const handleChildCardDragEnd = (event: React.PointerEvent<HTMLElement>) => {
    if (childCardDragRef.current?.pointerId === event.pointerId) {
      childCardDragRef.current = null;
      setIsDraggingChildCard(false);
    }
  };

  const atlasMapNodes = useMemo<MiniTreeNode[]>(
    () =>
      activeProjectCards.map((card) => ({
        id: card.id,
        parentId: card.parentId,
        label: card.title,
        eyebrow: `${
          locale === "zh"
            ? `第 ${lineageFor(cards, card.id).length} 层`
            : `Level ${lineageFor(cards, card.id).length}`
        } · ${relationMeta[card.relation].label.split(" · ")[0]}`,
        summary:
          (card.question || lastAssistant(card))
            .replace(/\[\[|\]\]/g, "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 110) ||
          (locale === "zh" ? "空白卡片，等待提问" : "Blank card, waiting for a question"),
        relation: card.relation,
        unread: card.unread,
      })),
    [activeProjectCards, cards, locale, relationMeta]
  );

  useEffect(() => {
    if (!activeCard || activeCard.status !== "streaming") return;
    cardBodyRef.current?.scrollTo({
      top: cardBodyRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [activeCard, activeCard?.messages]);

  const focusCard = (cardId: string) => {
    commitCards((previous) =>
      previous.map((card) => (card.id === cardId ? { ...card, unread: false } : card))
    );
    setTermPreview(null);
    // Focusing any card — root or child — always starts collapsed at its
    // default size; expansion is an explicit, opt-in action via the
    // size-toggle button, not something a navigation should carry over.
    setExpandedCardId(null);
    setActiveCardId(cardId);
  };

  const openSelectionActions = (cardId: string, text: string, rect: DOMRect) => {
    const toolbarWidth = 220;
    const safeLeft = clamp(
      rect.left + rect.width / 2 - toolbarWidth / 2,
      12,
      window.innerWidth - toolbarWidth - 12
    );
    const preferredTop = rect.top - 48;
    setSelectionAction({
      cardId,
      text,
      left: safeLeft,
      top: preferredTop >= 10 ? preferredTop : rect.bottom + 10,
    });
  };

  const clearBrowserSelection = () => {
    window.getSelection()?.removeAllRanges();
  };

  const askAboutSelection = (selection: SelectionAction) => {
    focusCard(selection.cardId);
    setCardSelectionContexts((previous) => ({
      ...previous,
      [selection.cardId]: selection.text.slice(0, 1000),
    }));
    setSelectionAction(null);
    clearBrowserSelection();
    window.requestAnimationFrame(() => composerTextareaRef.current?.focus());
  };

  const createCardFromSelection = (selection: SelectionAction) => {
    const selectedText = selection.text.slice(0, 1000);
    setSelectionAction(null);
    clearBrowserSelection();
    void createChildCard({
      parentId: selection.cardId,
      relation: "child",
      sourceTerm: cleanTitle(selectedText),
      value:
        locale === "zh"
          ? `请结合上游卡片的完整上下文，深入解释用户选中的这段内容：“${selectedText}”。`
          : `Using the full upstream card context, explain this user-selected passage in depth: “${selectedText}”. Respond in English.`,
    });
  };

  // `titleInput` is either the raw (untruncated) question — given an
  // immediate truncated placeholder title, then upgraded to a short
  // AI-generated title in the background once `askCard` starts the first
  // turn on this thread (see the `thread` SSE handler below) — or an
  // already-short explicit title (e.g. a branch's source term), which skips
  // that upgrade entirely.
  const createServerThread = async (
    titleInput: { rawQuestion: string } | { title: string },
    parentThreadId?: string,
    sourceTerm?: string
  ) => {
    const data = await apiJson<{ item: Thread }>("/api/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...titleInput, parentThreadId, sourceTerm }),
    });
    return data.item;
  };

  const ensureThreadForCard = async (card: KnowledgeCard) => {
    if (card.threadId) return card.threadId;
    const thread = await createServerThread({ rawQuestion: card.question || card.title });
    commitCards((previous) =>
      previous.map((item) =>
        item.id === card.id ? { ...item, threadId: thread.id, title: thread.title } : item
      )
    );
    syncCardMetadata(card.id);
    return thread.id;
  };

  const uploadFilesForCard = async (cardId: string, list: FileList | null) => {
    if (!list || list.length === 0 || uploadingFiles) return;
    const incomingFiles = Array.from(list);
    if (incomingFiles.length > 10) {
      setPageError(
        locale === "zh"
          ? "一次最多上传 10 个文件，请分批添加。"
          : "You can upload up to 10 files at a time."
      );
      return;
    }
    const invalidFile = incomingFiles.find(
      (file) => file.size <= 0 || file.size > 25 * 1024 * 1024
    );
    if (invalidFile) {
      setPageError(
        locale === "zh"
          ? `${invalidFile.name} 无法上传：单个文件需小于 25 MB 且不能为空。`
          : `${invalidFile.name} cannot be uploaded. Each file must be non-empty and under 25 MB.`
      );
      return;
    }

    const pendingItems: PendingKnowledgeUpload[] = incomingFiles.map((file) => ({
      localId: createId("knowledge_upload"),
      cardId,
      fileName: file.name,
      stage: "queued",
    }));
    setPendingUploads((previous) => [...previous, ...pendingItems]);
    setUploadingFiles(true);
    setUploadMenuOpen(false);
    setPageError("");

    const uploadedIds: string[] = [];
    try {
      for (const [index, file] of incomingFiles.entries()) {
        const pending = pendingItems[index];
        let createdFileId = "";
        let processingEnqueued = false;
        try {
          setPendingUploads((previous) =>
            previous.map((item) =>
              item.localId === pending.localId ? { ...item, stage: "uploading" } : item
            )
          );
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
          setPendingUploads((previous) =>
            previous.map((item) =>
              item.localId === pending.localId
                ? { ...item, fileId: presign.fileId }
                : item
            )
          );

          const uploadResponse = await fetch(presign.uploadUrl, {
            method: presign.method,
            headers: {
              "Content-Type": file.type || "application/octet-stream",
              "x-upsert": "true",
            },
            body: file,
          });
          if (!uploadResponse.ok) {
            const uploadError = (await uploadResponse.json().catch(() => null)) as
              | { error?: string; message?: string }
              | null;
            throw new Error(
              uploadError?.error ||
                uploadError?.message ||
                (locale === "zh"
                  ? `文件传输失败（${uploadResponse.status}）`
                  : `File transfer failed (${uploadResponse.status})`)
            );
          }

          setPendingUploads((previous) =>
            previous.map((item) =>
              item.localId === pending.localId ? { ...item, stage: "processing" } : item
            )
          );
          await apiJson(`/api/files/${presign.fileId}/enqueue`, { method: "POST" });
          processingEnqueued = true;
          await waitForFileReady(presign.fileId);
          uploadedIds.push(presign.fileId);
          setPendingUploads((previous) =>
            previous.filter((item) => item.localId !== pending.localId)
          );
        } catch (error) {
          if (createdFileId && !processingEnqueued) {
            void fetch(`/api/files/${createdFileId}`, { method: "DELETE" }).catch(
              () => undefined
            );
          }
          setPendingUploads((previous) =>
            previous.map((item) =>
              item.localId === pending.localId
                ? {
                    ...item,
                    stage: "failed",
                    error:
                      error instanceof Error
                        ? error.message
                        : locale === "zh"
                          ? "上传失败"
                          : "Upload failed",
                  }
                : item
            )
          );
        }
      }

      if (uploadedIds.length > 0) {
        await loadFiles();
        setCardAttachmentIds((previous) => ({
          ...previous,
          [cardId]: Array.from(new Set([...(previous[cardId] ?? []), ...uploadedIds])),
        }));
      }
      if (uploadedIds.length !== incomingFiles.length) {
        setPageError(
          locale === "zh"
            ? "部分文件未能上传，请移除失败的附件后重试。"
            : "Some files could not be uploaded. Remove failed items and try again."
        );
      }
    } finally {
      setUploadingFiles(false);
    }
  };

  const askCard = async (
    cardId: string,
    question: string,
    presetKnowledgeSources?: KnowledgeSourceRef[]
  ) => {
    const quotedText = cardSelectionContexts[cardId]?.trim() || "";
    const attachmentIdsForMessage = cardAttachmentIds[cardId] ?? [];
    const hasPendingFile = pendingUploads.some(
      (file) => file.cardId === cardId && file.stage !== "failed"
    );
    if (hasPendingFile) {
      setPageError(
        locale === "zh"
          ? "请等待文件解析完成后再提问。"
          : "Wait for file processing to finish before asking."
      );
      return;
    }

    const resolvedAttachments = attachmentIdsForMessage.map((fileId) =>
      files.find((file) => file.id === fileId)
    );
    const hasUnavailableAttachment =
      resolvedAttachments.some((file) => !file || file.status !== "ready");
    if (hasUnavailableAttachment) {
      setPageError(
        locale === "zh"
          ? "附件正文尚未准备好，请等待解析完成或移除该附件。"
          : "The attachment text is not ready. Wait for processing or remove it."
      );
      return;
    }

    const attachmentsForMessage = attachmentIdsForMessage
      .map((fileId) => files.find((file) => file.id === fileId))
      .filter((file): file is FileAsset => Boolean(file))
      .map((file) => ({
        id: file.id,
        fileName: file.fileName,
        mimeType: file.mimeType,
        size: file.size,
      }));
    const normalized =
      question.trim() ||
      (attachmentsForMessage.length > 0
        ? locale === "zh"
          ? "请阅读并分析我上传的文件。"
          : "Please read and analyze the files I uploaded."
        : "");
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
              title:
                item.title === "开始探索" ||
                item.title === "Start exploring" ||
                item.title === "新对话" ||
                item.title === "New chat"
                  ? cleanTitle(normalized)
                  : item.title,
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
                  quotedText: quotedText || undefined,
                  attachments: attachmentsForMessage,
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
    setCardSelectionContexts((previous) => ({ ...previous, [cardId]: "" }));
    setUploadMenuOpen(false);

    const abortController = new AbortController();
    abortControllersRef.current.set(cardId, abortController);
    const isCurrentGeneration = () =>
      abortControllersRef.current.get(cardId) === abortController &&
      !abortController.signal.aborted;

    try {
      const current = cardsRef.current.find((item) => item.id === cardId);
      const response = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortController.signal,
        body: JSON.stringify({
          threadId: current?.threadId,
          userMessage: quotedText
            ? locale === "zh"
              ? `引用内容：“${quotedText}”\n\n针对这段内容的问题：${normalized}`
              : `Quoted passage: “${quotedText}”\n\nQuestion about this passage: ${normalized}`
            : normalized,
          locale,
          attachmentIds: attachmentIdsForMessage,
          clientHistory: history,
          responseMode: "annotated",
          presetKnowledgeSources,
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
        thread: ({ threadId, title }) => {
          if (!isCurrentGeneration()) return;
          commitCards((previous) =>
            previous.map((item) =>
              item.id === cardId ? { ...item, threadId, title: title || item.title } : item
            )
          );
          syncCardMetadata(cardId);
        },
        token: ({ text }) => {
          if (!isCurrentGeneration()) return;
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
          if (!isCurrentGeneration()) return;
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
          if (!isCurrentGeneration()) return;
          streamError = message;
        },
      }, { signal: abortController.signal });
      if (streamError) throw new Error(streamError);

      if (!isCurrentGeneration()) return;
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
      syncCardMetadata(cardId);
    } catch (error) {
      const isUserAbort =
        abortController.signal.aborted ||
        (error as { name?: string } | null)?.name === "AbortError";

      if (isUserAbort) {
        // The user clicked "stop" — whatever streamed in so far (already in
        // this card's messages) stands as the final content. No error banner
        // for an intentional stop; only fall back to a placeholder if nothing
        // ever streamed at all.
        commitCards((previous) =>
          previous.map((item) =>
            item.id === cardId
              ? {
                  ...item,
                  status: "idle",
                  unread: item.id !== activeCardIdRef.current,
                  messages: item.messages.map((entry) =>
                    entry.id === assistantId && !entry.content
                      ? {
                          ...entry,
                          content: locale === "zh" ? "（已停止生成）" : "(Generation stopped)",
                        }
                      : entry
                  ),
                }
              : item
          )
        );
        syncCardMetadata(cardId);
      } else {
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
        syncCardMetadata(cardId);
        setPageError(message);
      }
    } finally {
      if (abortControllersRef.current.get(cardId) === abortController) {
        abortControllersRef.current.delete(cardId);
      }
    }
  };

  const stopCardGeneration = (cardId: string) => {
    const controller = abortControllersRef.current.get(cardId);
    if (!controller || controller.signal.aborted) return;

    console.info("[knowledge-stream] stop requested", { cardId });
    controller.abort();
    // Reflect the stop immediately instead of waiting for the pending reader
    // to reject. Late events are ignored by isCurrentGeneration().
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
  };

  const createBlankRootCard = () => {
    const root: KnowledgeCard = {
      id: createId("knowledge_root"),
      parentId: null,
      relation: "root",
      title: locale === "zh" ? "新对话" : "New chat",
      question: "",
      messages: [],
      status: "idle",
      unread: false,
      createdAt: new Date().toISOString(),
    };
    commitCards((previous) => [...previous, root]);
    setExpandedCardId(null);
    setActiveCardId(root.id);
    setCardInputs((previous) => ({ ...previous, [root.id]: "" }));
    setTermPreview(null);
    setSpawnDraft(null);
    setSpawnError("");
    window.requestAnimationFrame(() => composerTextareaRef.current?.focus());
    syncCreateKnowledgeCard(root);
  };

  // Shared by both the two-step branch modal (spawnCard, below — used when
  // the user still needs to type their own question) and the term-preview
  // popover's "创建分支并放大" button, which already has a fixed prompt and
  // creates straight away without showing that modal at all.
  const createChildCard = async (draft: SpawnDraft) => {
    if (creatingCard) return;
    const question = draft.value.trim();
    const parent = cardsRef.current.find((card) => card.id === draft.parentId);
    if (!parent || !question) return;

    setCreatingCard(true);
    setSpawnError("");
    try {
      const parentThreadId = await ensureThreadForCard(parent);
      // A source term is already short and meaningful (e.g. a concept the
      // user drilled into) — use it as the title as-is and skip the extra
      // model call; otherwise summarize the raw question server-side.
      const titleInput = draft.sourceTerm
        ? { title: cleanTitle(draft.sourceTerm) }
        : { rawQuestion: question };
      const thread = await createServerThread(
        titleInput,
        parentThreadId,
        draft.sourceTerm || cleanTitle(question)
      );
      const child: KnowledgeCard = {
        id: createId(`knowledge_${draft.relation}`),
        threadId: thread.id,
        parentId: parent.id,
        relation: draft.relation,
        title: thread.title,
        question,
        messages: [],
        status: "idle",
        unread: false,
        createdAt: new Date().toISOString(),
      };
      commitCards((previous) => [...previous, child]);
      setSpawnDraft(null);
      setTermPreview(null);
      // Newly created cards open at their default (non-expanded) size,
      // same as opening any existing card — expansion is always an
      // explicit, opt-in click on the size-toggle button.
      setExpandedCardId(null);
      setActiveCardId(child.id);
      syncCreateKnowledgeCard(child);
      void askCard(child.id, question, draft.presetKnowledgeSources);
    } catch (error) {
      setSpawnError(
        error instanceof Error
          ? error.message
          : locale === "zh"
            ? "无法创建分支卡片"
            : "Unable to create branch card"
      );
    } finally {
      setCreatingCard(false);
    }
  };

  const spawnCard = async (event: FormEvent) => {
    event.preventDefault();
    if (!spawnDraft || creatingCard) return;
    await createChildCard(spawnDraft);
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
        // Deletes the knowledge_cards row and cascades to its own thread
        // (and that thread's messages/learning state) server-side — see
        // supabaseDb.deleteKnowledgeCard. A 404 just means this card was
        // never synced to the server (e.g. the built-in starter card, or a
        // card created before this device started syncing), which is fine.
        const response = await fetch(`/api/knowledge-cards/${card.id}`, {
          method: "DELETE",
        });
        if (!response.ok && response.status !== 404) {
          throw new Error(
            locale === "zh"
              ? `删除数据库卡片失败（${response.status}）`
              : `Failed to delete the database card (${response.status})`
          );
        }
      }
      const remaining = cardsRef.current.filter((card) => !ids.has(card.id));
      const next = remaining.length ? remaining : createStarterCards(locale);
      commitCards(next);
      setExpandedCardId(null);
      setActiveCardId(next[0].id);
      setDeleteCardId(null);
      setTermPreview(null);
    } catch (error) {
      setPageError(
        error instanceof Error
          ? error.message
          : locale === "zh"
            ? "删除失败"
            : "Delete failed"
      );
    } finally {
      setCreatingCard(false);
    }
  };

  // `assignToCardId` is set when this modal was opened from a card's move-
  // to-folder menu ("新建文件夹") — on success the new folder is assigned to
  // that card in the same flow, mirroring the same affordance in Claude.ai.
  const openCreateFolderModal = (assignToCardId?: string) => {
    setFolderModal({ mode: "create", assignToCardId });
    setFolderNameDraft("");
    setFolderModalError("");
    setMoveMenuCardId(null);
  };

  const openRenameFolderModal = (folder: Folder) => {
    setFolderModal({ mode: "rename", folderId: folder.id });
    setFolderNameDraft(folder.name);
    setFolderModalError("");
  };

  const moveCardToFolder = (cardId: string, folderId: string | null) => {
    commitCards((previous) =>
      previous.map((item) => (item.id === cardId ? { ...item, folderId } : item))
    );
    setMoveMenuCardId(null);
    syncKnowledgeCardPatch(cardId, { folderId });
  };

  const submitFolderModal = async (event: FormEvent) => {
    event.preventDefault();
    if (!folderModal) return;
    const name = folderNameDraft.trim();
    if (!name) {
      setFolderModalError(locale === "zh" ? "请输入文件夹名称" : "Enter a folder name");
      return;
    }
    setSavingFolder(true);
    setFolderModalError("");
    try {
      if (folderModal.mode === "create") {
        const data = await apiJson<{ item: Folder }>("/api/folders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        setFolders((previous) => [...previous, data.item].sort((a, b) => a.sortOrder - b.sortOrder));
        if (folderModal.assignToCardId) {
          moveCardToFolder(folderModal.assignToCardId, data.item.id);
        }
      } else {
        const data = await apiJson<{ item: Folder }>(`/api/folders/${folderModal.folderId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        setFolders((previous) =>
          previous.map((item) => (item.id === data.item.id ? data.item : item))
        );
      }
      setFolderModal(null);
    } catch (error) {
      setFolderModalError(
        error instanceof Error
          ? error.message
          : locale === "zh"
            ? "保存文件夹失败"
            : "Failed to save the folder"
      );
    } finally {
      setSavingFolder(false);
    }
  };

  // The server unfiles the folder's cards (folder_id -> null) rather than
  // deleting them — mirrored locally so the sidebar doesn't wait on the
  // next background reconcile to reflect it.
  const confirmDeleteFolder = async () => {
    if (!deleteFolderId) return;
    setSavingFolder(true);
    try {
      await apiJson(`/api/folders/${deleteFolderId}`, { method: "DELETE" });
      setFolders((previous) => previous.filter((item) => item.id !== deleteFolderId));
      commitCards((previous) =>
        previous.map((item) =>
          item.folderId === deleteFolderId ? { ...item, folderId: null } : item
        )
      );
      if (openFolderView === deleteFolderId) setOpenFolderView(null);
      setDeleteFolderId(null);
    } catch (error) {
      setPageError(
        error instanceof Error
          ? error.message
          : locale === "zh"
            ? "删除文件夹失败"
            : "Failed to delete the folder"
      );
    } finally {
      setSavingFolder(false);
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
      <aside className="knowledge-stage-rail" aria-label={locale === "zh" ? "知识探索工具" : "Knowledge tools"}>
        <button
          type="button"
          className="knowledge-stage-sidebar-toggle"
          onClick={() => setSidebarOpen((value) => !value)}
          title={sidebarOpen ? (locale === "zh" ? "隐藏侧边栏" : "Hide sidebar") : locale === "zh" ? "打开侧边栏" : "Open sidebar"}
          aria-label={sidebarOpen ? (locale === "zh" ? "隐藏侧边栏" : "Hide sidebar") : locale === "zh" ? "打开侧边栏" : "Open sidebar"}
        >
          <PanelLeft size={21} />
          <span>{sidebarOpen ? (locale === "zh" ? "隐藏侧边栏" : "Hide sidebar") : locale === "zh" ? "打开侧边栏" : "Open sidebar"}</span>
        </button>
        <button
          type="button"
          onClick={createBlankRootCard}
          title={locale === "zh" ? "新建主线" : "New main card"}
          aria-label={locale === "zh" ? "新建主线" : "New main card"}
        >
          <Plus size={21} />
          <span>{locale === "zh" ? "新建项目" : "New project"}</span>
        </button>
        <button
          type="button"
          onClick={() => openCreateFolderModal()}
          title={locale === "zh" ? "新建文件夹" : "New folder"}
          aria-label={locale === "zh" ? "新建文件夹" : "New folder"}
        >
          <FolderIcon size={20} />
          <span>{locale === "zh" ? "新建文件夹" : "New folder"}</span>
        </button>
        <Link href="/files" title={locale === "zh" ? "上传文档" : "Upload documents"} aria-label={locale === "zh" ? "上传文档" : "Upload documents"}>
          <FileUp size={20} />
          <span>{locale === "zh" ? "上传文档" : "Upload documents"}</span>
        </Link>
        <Link href="/" title={locale === "zh" ? "产品首页" : "Home"} aria-label={locale === "zh" ? "产品首页" : "Home"}>
          <Home size={20} />
          <span>{locale === "zh" ? "产品首页" : "Home"}</span>
        </Link>

        <section className="knowledge-stage-projects" aria-label={locale === "zh" ? "本地项目" : "Local projects"}>
          <div>
            <Network size={14} />
            <span>{locale === "zh" ? "对话" : "Chats"}</span>
            <i>{sidebarRootCards.length}</i>
          </div>
          <nav className="knowledge-card-row-list">
            {folders.map((folder) => (
              <FolderRow
                key={folder.id}
                folder={folder}
                count={(cardsByFolder.byFolder.get(folder.id) ?? []).length}
                locale={locale}
                onOpen={() => setOpenFolderView(folder.id)}
                onRename={() => openRenameFolderModal(folder)}
                onDelete={() => setDeleteFolderId(folder.id)}
              />
            ))}
            {cardsByFolder.unfiled.map((card) => (
              <CardRow
                key={card.id}
                card={card}
                isActive={card.id === activeRootCard?.id}
                locale={locale}
                folders={folders}
                showMoveMenu={folders.length > 0}
                moveMenuOpen={moveMenuCardId === card.id}
                onOpen={() => focusCard(card.id)}
                onDelete={() => setDeleteCardId(card.id)}
                onToggleMoveMenu={() =>
                  setMoveMenuCardId((current) => (current === card.id ? null : card.id))
                }
                onMoveToFolder={(folderId) => moveCardToFolder(card.id, folderId)}
                onCreateFolderForCard={() => openCreateFolderModal(card.id)}
              />
            ))}
          </nav>
        </section>

        <div className="knowledge-stage-rail-spacer" />
        <button
          type="button"
          onClick={() => setControlCenterMode("settings")}
          title={locale === "zh" ? "设置" : "Settings"}
          aria-label={locale === "zh" ? "设置" : "Settings"}
        >
          <Settings size={20} />
          <span>{locale === "zh" ? "设置" : "Settings"}</span>
        </button>
        <button
          type="button"
          className="knowledge-stage-account"
          onClick={() => setControlCenterMode("account")}
          title={user?.name || (locale === "zh" ? "账户" : "Account")}
        >
          <div className="knowledge-stage-avatar">
            {(user?.name || "M").slice(0, 1).toUpperCase()}
          </div>
          <span>{user?.name || (locale === "zh" ? "账户" : "Account")}</span>
        </button>
      </aside>

      <main className="knowledge-stage-main">
        <nav className="knowledge-stage-breadcrumb" aria-label={locale === "zh" ? "当前知识路径" : "Current knowledge path"}>
          {activeLineage.map((card, index) => (
            <button key={card.id} type="button" onClick={() => focusCard(card.id)}>
              {index > 0 ? <span>/</span> : null}
              {card.title}
            </button>
          ))}
        </nav>

        <section
          ref={stackRef}
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
              title={locale === "zh" ? `切换到：${card.title}` : `Switch to: ${card.title}`}
            >
              <span>{card.title}</span>
            </button>
          ))}

          {stageBaseCard ? (
            <article
              key={stageBaseCard.id}
              className={`knowledge-stage-card relation-${stageBaseCard.relation} ${
                parentCard ? "has-child-open" : ""
              } ${baseExpanded ? "is-expanded" : ""}`}
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
                  {!parentCard ? (
                    <button
                      type="button"
                      className="knowledge-stage-size-toggle"
                      onClick={() =>
                        setExpandedCardId((current) =>
                          current === stageBaseCard.id ? null : stageBaseCard.id
                        )
                      }
                      title={baseExpanded ? (locale === "zh" ? "缩小这张卡片" : "Shrink card") : locale === "zh" ? "放大这张卡片" : "Expand card"}
                      aria-label={baseExpanded ? (locale === "zh" ? "缩小这张卡片" : "Shrink card") : locale === "zh" ? "放大这张卡片" : "Expand card"}
                    >
                      {baseExpanded ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
                      <span>{baseExpanded ? (locale === "zh" ? "缩小" : "Shrink") : locale === "zh" ? "放大" : "Expand"}</span>
                    </button>
                  ) : null}
                  {parentCard ? (
                    <button
                      type="button"
                      onClick={() => focusCard(stageBaseCard.id)}
                      title={locale === "zh" ? "切换到这张父卡片" : "Switch to parent card"}
                      aria-label={locale === "zh" ? "切换到这张父卡片" : "Switch to parent card"}
                    >
                      <ChevronLeft size={17} />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void copyAnswer(stageBaseCard)}
                    title={locale === "zh" ? "复制回答" : "Copy answer"}
                    aria-label={locale === "zh" ? "复制回答" : "Copy answer"}
                  >
                    {copied ? <Check size={17} /> : <Copy size={17} />}
                  </button>
                  <button type="button" title={locale === "zh" ? "收藏卡片" : "Bookmark card"} aria-label={locale === "zh" ? "收藏卡片" : "Bookmark card"}>
                    <Bookmark size={17} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteCardId(stageBaseCard.id)}
                    title={locale === "zh" ? "删除卡片" : "Delete card"}
                    aria-label={locale === "zh" ? "删除卡片" : "Delete card"}
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              </header>

              <KnowledgeCardConversation
                card={stageBaseCard}
                onTerm={(term) => void openTerm(stageBaseCard, term)}
                onTextSelection={(text, rect) =>
                  openSelectionActions(stageBaseCard.id, text, rect)
                }
                bodyRef={parentCard ? undefined : cardBodyRef}
                locale={locale}
              />
              {!parentCard && nextCard ? (
                <button
                  type="button"
                  className="knowledge-stage-card-forward"
                  onClick={() => focusCard(nextCard.id)}
                  title={locale === "zh" ? `进入：${nextCard.title}` : `Open: ${nextCard.title}`}
                  aria-label={locale === "zh" ? `进入下一层：${nextCard.title}` : `Open next level: ${nextCard.title}`}
                >
                  <span>{locale === "zh" ? "下一层" : "Next"}</span>
                  <ChevronRight size={19} />
                </button>
              ) : null}
            </article>
          ) : null}

          {parentCard && activeCard ? (
            <article
              key={`child_${activeCard.id}`}
              ref={childCardRef}
              className={`knowledge-stage-child-card relation-${activeCard.relation} ${
                childExpanded ? "is-expanded" : "is-collapsed"
              } ${isDraggingChildCard ? "is-dragging" : ""}`}
              style={
                !childExpanded && childCardDragPosition
                  ? {
                      left: childCardDragPosition.left,
                      top: childCardDragPosition.top,
                      right: "auto",
                    }
                  : undefined
              }
            >
              <header
                className="knowledge-stage-child-header"
                onPointerDown={handleChildCardDragStart}
                onPointerMove={handleChildCardDragMove}
                onPointerUp={handleChildCardDragEnd}
                onPointerCancel={handleChildCardDragEnd}
              >
                <div>
                  <span>
                    <RelationIcon relation={activeCard.relation} />
                    {locale === "zh"
                      ? `第 ${activeLineage.length} 层`
                      : `Level ${activeLineage.length}`}{" "}
                    · {relationMeta[activeCard.relation].label}
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
                    title={
                      childExpanded
                        ? locale === "zh"
                          ? "缩小为浮动卡片"
                          : "Shrink to floating card"
                        : locale === "zh"
                          ? "放大这张卡片"
                          : "Expand card"
                    }
                    aria-label={
                      childExpanded
                        ? locale === "zh"
                          ? "缩小为浮动卡片"
                          : "Shrink to floating card"
                        : locale === "zh"
                          ? "放大这张卡片"
                          : "Expand card"
                    }
                  >
                    {childExpanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                    <span>
                      {childExpanded
                        ? locale === "zh"
                          ? "缩小"
                          : "Shrink"
                        : locale === "zh"
                          ? "放大"
                          : "Expand"}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void copyAnswer(activeCard)}
                    title={locale === "zh" ? "复制回答" : "Copy answer"}
                    aria-label={locale === "zh" ? "复制回答" : "Copy answer"}
                  >
                    <Copy size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteCardId(activeCard.id)}
                    title={locale === "zh" ? "删除这层对话" : "Delete this level"}
                    aria-label={locale === "zh" ? "删除这层对话" : "Delete this level"}
                  >
                    <Trash2 size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => focusCard(parentCard.id)}
                    title={locale === "zh" ? "关闭并返回父卡片" : "Close and return to parent"}
                    aria-label={locale === "zh" ? "关闭并返回父卡片" : "Close and return to parent"}
                  >
                    <X size={16} />
                  </button>
                </div>
              </header>
              <KnowledgeCardConversation
                card={activeCard}
                onTerm={(term) => void openTerm(activeCard, term)}
                onTextSelection={(text, rect) =>
                  openSelectionActions(activeCard.id, text, rect)
                }
                bodyRef={cardBodyRef}
                locale={locale}
                compact={!childExpanded}
              />
              <button
                type="button"
                className="knowledge-stage-child-card-back"
                onClick={() => focusCard(parentCard.id)}
                title={locale === "zh" ? `返回：${parentCard.title}` : `Back to: ${parentCard.title}`}
                aria-label={locale === "zh" ? `返回父卡片：${parentCard.title}` : `Return to parent: ${parentCard.title}`}
              >
                <ChevronLeft size={19} />
                <span>{locale === "zh" ? "上一层" : "Previous"}</span>
              </button>
              {nextCard ? (
                <button
                  type="button"
                  className="knowledge-stage-card-forward"
                  onClick={() => focusCard(nextCard.id)}
                  title={locale === "zh" ? `进入：${nextCard.title}` : `Open: ${nextCard.title}`}
                  aria-label={locale === "zh" ? `进入下一层：${nextCard.title}` : `Open next level: ${nextCard.title}`}
                >
                  <span>{locale === "zh" ? "下一层" : "Next"}</span>
                  <ChevronRight size={19} />
                </button>
              ) : null}
            </article>
          ) : null}

          {termPreview && previewSourceCard ? (
            <aside className="knowledge-term-popover">
              <div>
                <span>
                  {locale === "zh"
                    ? `从“${previewSourceCard.title}”向下一层`
                    : `Next level from “${previewSourceCard.title}”`}
                </span>
                <button
                  type="button"
                  onClick={() => setTermPreview(null)}
                  aria-label={locale === "zh" ? "关闭关键词预览" : "Close concept preview"}
                >
                  <X size={15} />
                </button>
              </div>
              <h2>{termPreview.term}</h2>
              {termPreview.loading ? (
                <p className="is-loading">
                  <Loader2 className="animate-spin" size={15} />
                  {locale === "zh"
                    ? "正在结合当前卡片解释…"
                    : "Explaining with the current card…"}
                </p>
              ) : (
                <p>{termPreview.error || termPreview.text}</p>
              )}
              {spawnError ? <p className="knowledge-stage-modal-error">{spawnError}</p> : null}
              <button
                type="button"
                disabled={termPreview.loading || creatingCard}
                onClick={() => {
                  setSpawnError("");
                  const term = termPreview.term;
                  void (async () => {
                    const glossary = await lookupKnowledgeDictionaryMatch(term);
                    const isPerson = glossary?.source === "person";
                    const value = glossary
                      ? locale === "zh"
                        ? isPerson
                          ? `请结合上游内容，深入介绍“${term}”。\n\n人物库中该词条的传记原文如下，你的介绍必须严格依据这份传记，禁止编造、延伸或补充传记中没有的生平细节：\n${glossary.definition}`
                          : `请结合上游内容，深入解释“${term}”。\n\n术语库中该词条的权威定义如下，你的解释必须严格遵循这份定义，禁止编造、延伸或补充词典中没有的内容：\n${glossary.definition}`
                        : isPerson
                          ? `Using the upstream context, introduce “${term}” in depth. The biography dictionary's authoritative entry is below — your introduction must strictly follow it, with no invented or extended biographical detail beyond it:\n${glossary.definition}`
                          : `Using the upstream context, explain “${term}” in depth. The glossary's authoritative definition is below — your explanation must strictly follow it, with no invented or extended content beyond it:\n${glossary.definition}`
                      : locale === "zh"
                        ? `请结合上游内容，深入解释“${term}”。`
                        : `Using the upstream context, explain “${term}” in depth. Respond in English.`;
                    const presetKnowledgeSources: KnowledgeSourceRef[] | undefined = glossary
                      ? [{ title: glossary.term, source: glossary.source }]
                      : undefined;
                    void createChildCard({
                      parentId: previewSourceCard.id,
                      relation: "child",
                      sourceTerm: term,
                      value,
                      presetKnowledgeSources,
                    });
                  })();
                }}
              >
                {creatingCard ? (
                  <Loader2 className="animate-spin" size={15} />
                ) : (
                  <Maximize2 size={15} />
                )}
                {locale === "zh" ? "创建分支并放大" : "Create branch and expand"}
              </button>
              <small>
                {locale === "zh"
                  ? "点击后直接创建子卡片并进入"
                  : "Creates the child card and opens it immediately"}
              </small>
            </aside>
          ) : null}
        </section>

        <aside className="knowledge-stage-navigator">
          <MiniTreeMap
            nodes={atlasMapNodes}
            activeId={activeCardId}
            onSelect={focusCard}
            label={locale === "zh" ? "卡片导航" : "Card navigation"}
            currentLabel={locale === "zh" ? "当前卡片" : "Current card"}
          />
          <p>{locale === "zh" ? "节点由卡片关系自动生成" : "Nodes are generated from card relationships"}</p>
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
            className={`knowledge-stage-composer ${
              activeAttachments.length > 0 || activePendingUploads.length > 0
                ? "has-files"
                : ""
            } ${activeSelectionContext ? "has-reference" : ""} ${
              composerDragActive ? "is-dragging" : ""
            }`}
            onSubmit={(event) => {
              event.preventDefault();
              const current = cardsRef.current.find((item) => item.id === activeCard.id);
              if (current?.status === "streaming") return;
              void askCard(activeCard.id, inputValue);
            }}
            onDragEnter={(event) => {
              event.preventDefault();
              if (!uploadingFiles && activeCard.status !== "streaming") {
                setComposerDragActive(true);
              }
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
            }}
            onDragLeave={(event) => {
              if (event.currentTarget.contains(event.relatedTarget as Node)) return;
              setComposerDragActive(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setComposerDragActive(false);
              void uploadFilesForCard(activeCard.id, event.dataTransfer.files);
            }}
          >
            {activeSelectionContext ? (
              <div className="knowledge-stage-composer-reference">
                <ArrowRight size={16} />
                <span>“{activeSelectionContext}”</span>
                <button
                  type="button"
                  onClick={() =>
                    setCardSelectionContexts((previous) => ({
                      ...previous,
                      [activeCard.id]: "",
                    }))
                  }
                  aria-label={locale === "zh" ? "移除引用内容" : "Remove quoted passage"}
                >
                  <X size={15} />
                </button>
              </div>
            ) : null}
            {activeAttachments.length > 0 || activePendingUploads.length > 0 ? (
              <div className="knowledge-stage-composer-files" aria-live="polite">
                {activeAttachments.map((file) => (
                  <div key={file.id} className="is-ready">
                    <span>
                      <FileUp size={16} />
                    </span>
                    <div>
                      <strong>{file.fileName}</strong>
                      <small>
                        <Check size={10} />
                        {locale === "zh" ? "已附加" : "Attached"} · {formatFileSize(file.size)}
                      </small>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setCardAttachmentIds((previous) => ({
                          ...previous,
                          [activeCard.id]: (previous[activeCard.id] ?? []).filter(
                            (fileId) => fileId !== file.id
                          ),
                        }))
                      }
                      aria-label={
                        locale === "zh"
                          ? `移除 ${file.fileName}`
                          : `Remove ${file.fileName}`
                      }
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
                {activePendingUploads.map((file) => (
                  <div key={file.localId} className={file.stage === "failed" ? "is-failed" : ""}>
                    <span>
                      {file.stage === "failed" ? (
                        <AlertCircle size={16} />
                      ) : (
                        <Loader2 className="animate-spin" size={16} />
                      )}
                    </span>
                    <div>
                      <strong>{file.fileName}</strong>
                      <small>
                        {file.stage === "queued"
                          ? locale === "zh" ? "等待上传" : "Waiting"
                          : file.stage === "uploading"
                            ? locale === "zh" ? "正在上传…" : "Uploading…"
                            : file.stage === "processing"
                              ? locale === "zh" ? "正在解析…" : "Processing…"
                              : file.error || (locale === "zh" ? "上传失败" : "Upload failed")}
                      </small>
                    </div>
                    {file.stage === "failed" ? (
                      <button
                        type="button"
                        onClick={() =>
                          setPendingUploads((previous) =>
                            previous.filter((item) => item.localId !== file.localId)
                          )
                        }
                        aria-label={
                          locale === "zh"
                            ? `移除 ${file.fileName}`
                            : `Remove ${file.fileName}`
                        }
                      >
                        <X size={12} />
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}

            <div className="knowledge-stage-upload-wrap" ref={uploadMenuRef}>
              <button
                type="button"
                className={uploadMenuOpen ? "is-open" : ""}
                onClick={() => setUploadMenuOpen((open) => !open)}
                disabled={uploadingFiles || activeCard.status === "streaming"}
                aria-label={locale === "zh" ? "添加照片和文件" : "Add photos and files"}
                aria-expanded={uploadMenuOpen}
                aria-haspopup="menu"
              >
                {uploadingFiles ? <Loader2 className="animate-spin" size={18} /> : <Plus size={21} />}
              </button>
              {uploadMenuOpen ? (
                <div className="knowledge-stage-upload-menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => uploadInputRef.current?.click()}
                  >
                    <span>
                      <Paperclip size={18} />
                    </span>
                    <div>
                      <strong>{locale === "zh" ? "上传照片和文件" : "Upload photos and files"}</strong>
                      <small>{locale === "zh" ? "从电脑选择，单个文件最大 25 MB" : "Choose from your computer, up to 25 MB each"}</small>
                    </div>
                  </button>
                  <p>
                    <FileUp size={13} />
                    {locale === "zh" ? "也可以把文件直接拖到输入框" : "You can also drag files into the composer"}
                  </p>
                </div>
              ) : null}
              <input
                ref={uploadInputRef}
                type="file"
                multiple
                className="knowledge-stage-upload-input"
                onChange={(event) => {
                  void uploadFilesForCard(activeCard.id, event.target.files);
                  event.currentTarget.value = "";
                }}
              />
            </div>
            <span className="knowledge-stage-model">AI</span>
            <textarea
              ref={composerTextareaRef}
              value={inputValue}
              onChange={(event) =>
                setCardInputs((previous) => ({
                  ...previous,
                  [activeCard.id]: event.target.value,
                }))
              }
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder={
                activeSelectionContext
                  ? locale === "zh"
                    ? "针对引用内容提问…"
                    : "Ask about the quoted passage…"
                  : locale === "zh"
                    ? "在当前卡片继续提问…"
                    : "Continue asking on this card…"
              }
              rows={1}
              disabled={activeCard.status === "streaming"}
            />
            {activeCard.status === "streaming" ? (
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  stopCardGeneration(activeCard.id);
                }}
                aria-label={locale === "zh" ? "停止生成" : "Stop generating"}
                title={locale === "zh" ? "停止生成" : "Stop generating"}
              >
                <Square size={16} fill="currentColor" strokeWidth={0} />
              </button>
            ) : (
              <button
                type="submit"
                disabled={
                  (!inputValue.trim() && activeAttachments.length === 0) ||
                  uploadingFiles ||
                  activePendingUploads.some((file) => file.stage !== "failed")
                }
                aria-label={locale === "zh" ? "发送" : "Send"}
              >
                <Send size={18} />
              </button>
            )}
            {composerDragActive ? (
              <div className="knowledge-stage-composer-drop">
                <FileUp size={20} />
                <strong>{locale === "zh" ? "松开以上传文件" : "Drop files to upload"}</strong>
              </div>
            ) : null}
          </form>
        ) : null}

        {selectionAction ? (
          <div
            ref={selectionActionRef}
            className="knowledge-stage-selection-actions"
            style={{ left: selectionAction.left, top: selectionAction.top }}
            role="toolbar"
            aria-label={locale === "zh" ? "选中文字操作" : "Selected text actions"}
          >
            <button
              type="button"
              onClick={() => askAboutSelection(selectionAction)}
            >
              <Send size={14} />
              {locale === "zh" ? "针对性提问" : "Ask AI"}
            </button>
            <button
              type="button"
              onClick={() => createCardFromSelection(selectionAction)}
              disabled={creatingCard}
            >
              {creatingCard ? (
                <Loader2 className="animate-spin" size={14} />
              ) : (
                <ArrowUpRight size={14} />
              )}
              {locale === "zh" ? "进入下一层" : "Open next level"}
            </button>
          </div>
        ) : null}

        {pageError ? (
          <div className="knowledge-stage-error">
            <span>{pageError}</span>
            <button
              type="button"
              onClick={() => setPageError("")}
              aria-label={locale === "zh" ? "关闭错误" : "Dismiss error"}
            >
              <X size={14} />
            </button>
          </div>
        ) : null}
      </main>

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
                {locale === "zh" ? "来源关键词：" : "Source concept: "}
                {spawnDraft.sourceTerm}
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
              placeholder={locale === "zh" ? "输入这张新卡片要探索的问题…" : "Enter the question for this new card…"}
              rows={4}
            />
            {spawnError ? <p className="knowledge-stage-modal-error">{spawnError}</p> : null}
            <div>
              <button type="button" onClick={() => setSpawnDraft(null)}>
                {locale === "zh" ? "取消" : "Cancel"}
              </button>
              <button type="submit" disabled={!spawnDraft.value.trim() || creatingCard}>
                {creatingCard ? <Loader2 className="animate-spin" size={15} /> : null}
                {locale === "zh" ? "创建并进入下一层" : "Create and open next level"}
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
            <span>{locale === "zh" ? "确认操作" : "Confirm action"}</span>
            <h2>{locale === "zh" ? "删除这张卡片及其下游分支？" : "Delete this card and its descendants?"}</h2>
            <p className="knowledge-stage-delete-copy">
              {locale === "zh" ? "对应数据库线程和消息也会一起删除，无法撤销。" : "The linked database thread and messages will also be deleted. This cannot be undone."}
            </p>
            <div>
              <button type="button" onClick={() => setDeleteCardId(null)}>
                {locale === "zh" ? "取消" : "Cancel"}
              </button>
              <button
                type="button"
                className="is-danger"
                onClick={() => void deleteCard()}
                disabled={creatingCard}
              >
                {creatingCard ? <Loader2 className="animate-spin" size={15} /> : null}
                {locale === "zh" ? "确认删除" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {folderModal ? (
        <div className="knowledge-stage-modal-backdrop">
          <form className="knowledge-stage-modal" onSubmit={submitFolderModal}>
            <div className="knowledge-stage-modal-icon">
              <FolderIcon size={19} />
            </div>
            <span>
              {folderModal.mode === "create"
                ? locale === "zh" ? "新建文件夹" : "New folder"
                : locale === "zh" ? "重命名文件夹" : "Rename folder"}
            </span>
            <h2>
              {locale === "zh"
                ? "用于整理侧边栏里的对话卡片"
                : "Used to organize the conversation cards in your sidebar"}
            </h2>
            <input
              type="text"
              autoFocus
              value={folderNameDraft}
              onChange={(event) => setFolderNameDraft(event.target.value)}
              placeholder={locale === "zh" ? "文件夹名称" : "Folder name"}
              maxLength={80}
            />
            {folderModalError ? <p className="knowledge-stage-modal-error">{folderModalError}</p> : null}
            <div>
              <button type="button" onClick={() => setFolderModal(null)}>
                {locale === "zh" ? "取消" : "Cancel"}
              </button>
              <button type="submit" disabled={!folderNameDraft.trim() || savingFolder}>
                {savingFolder ? <Loader2 className="animate-spin" size={15} /> : null}
                {folderModal.mode === "create"
                  ? locale === "zh" ? "创建" : "Create"
                  : locale === "zh" ? "保存" : "Save"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {deleteFolderId ? (
        <div className="knowledge-stage-modal-backdrop">
          <div className="knowledge-stage-modal">
            <div className="knowledge-stage-modal-icon is-danger">
              <Trash2 size={19} />
            </div>
            <span>{locale === "zh" ? "确认操作" : "Confirm action"}</span>
            <h2>{locale === "zh" ? "删除这个文件夹？" : "Delete this folder?"}</h2>
            <p className="knowledge-stage-delete-copy">
              {locale === "zh"
                ? "文件夹内的对话卡片会移到「未归类」，卡片本身不会被删除。"
                : "Cards inside will move to “Unfiled” — the cards themselves are not deleted."}
            </p>
            <div>
              <button type="button" onClick={() => setDeleteFolderId(null)}>
                {locale === "zh" ? "取消" : "Cancel"}
              </button>
              <button
                type="button"
                className="is-danger"
                onClick={() => void confirmDeleteFolder()}
                disabled={savingFolder}
              >
                {savingFolder ? <Loader2 className="animate-spin" size={15} /> : null}
                {locale === "zh" ? "确认删除" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {openFolderView
        ? (() => {
            const folder = folders.find((item) => item.id === openFolderView);
            if (!folder) return null;
            return (
              <FolderView
                folder={folder}
                cards={cardsByFolder.byFolder.get(folder.id) ?? []}
                activeCardId={activeRootCard?.id}
                locale={locale}
                folders={folders}
                moveMenuCardId={moveMenuCardId}
                onClose={() => setOpenFolderView(null)}
                onRename={() => openRenameFolderModal(folder)}
                onDelete={() => setDeleteFolderId(folder.id)}
                onOpenCard={(cardId) => {
                  focusCard(cardId);
                  setOpenFolderView(null);
                }}
                onDeleteCard={(cardId) => setDeleteCardId(cardId)}
                onToggleMoveMenu={(cardId) =>
                  setMoveMenuCardId((current) => (current === cardId ? null : cardId))
                }
                onMoveToFolder={(cardId, folderId) => moveCardToFolder(cardId, folderId)}
                onCreateFolderForCard={(cardId) => openCreateFolderModal(cardId)}
              />
            );
          })()
        : null}

      {controlCenterMode ? (
        <KnowledgeControlCenter
          mode={controlCenterMode}
          cardCount={cards.length}
          fileCount={files.length}
          onModeChange={setControlCenterMode}
          onClose={() => setControlCenterMode(null)}
        />
      ) : null}
    </div>
  );
}
