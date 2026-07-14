"use client";

import {
  CheckIcon,
  ClockCounterClockwiseIcon,
  CornersInIcon,
  CornersOutIcon,
  ImageIcon,
  PaperPlaneRightIcon,
  PlusIcon,
  SparkleIcon,
  StopIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useEffect, useRef, useState } from "react";
import type { ProposedDocumentPatch } from "./documentPatch";
import {
  foregroundContextDescription,
  type AgentForegroundContext,
} from "./agentForegroundContext";
import type { ChangeEvent, DragEvent, FormEvent, KeyboardEvent, ClipboardEvent } from "react";
import { runStudyAgentLoop, type AgentContextState, type AgentSource, type AgentToolCall } from "./studyAgent";
import type { CurrentDocumentAgentTools } from "@/components/editor/TiptapEditor";
import RichMarkdown from "@/components/markdown/RichMarkdown";

const sessionsStorageKey = "learner.ai.sessions.v2";
const currentSessionStorageKey = "learner.ai.currentSession.v2";
const legacyChatStorageKey = "learner.ai.chat.v1";
const oldSessionStorageKeys = ["learner.ai.sessions.v1", "learner.ai.currentSession.v1", legacyChatStorageKey];

const maxImages = 5;
const maxImageSize = 4 * 1024 * 1024;
const acceptedImageTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];

function documentToolPath(documentPath: string) {
  const trimmedPath = documentPath.trim().replace(/^\/+/, "");
  return trimmedPath.toLowerCase().endsWith(".json") ? trimmedPath : `${trimmedPath}.json`;
}

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  createdAt: number;
  images?: string[];
  isStreaming?: boolean;
  patches?: ProposedDocumentPatch[];
  toolCallId?: string;
  toolCalls?: AgentToolCall[];
  toolName?: string;
  toolResult?: unknown;
  viewingContext?: {
    attached: boolean;
    description: string | null;
    key: string | null;
  };
};

type ChatSession = {
  id: string;
  title: string;
  messages: ChatMessage[];
  agentContextState?: AgentContextState;
  createdAt: number;
  updatedAt: number;
};

type PendingImage = {
  id: string;
  previewUrl: string;
  dataUrl: string | null;
  status: "loading" | "ready" | "error";
};

function generateId(prefix: string) {
  return `${prefix}_${Date.now()}_${crypto.randomUUID()}`;
}

function validSource(source: unknown): source is AgentSource {
  if (!source || typeof source !== "object") return false;

  const candidate = source as Partial<AgentSource>;
  return (
    typeof candidate.chunkIndex === "number" &&
    typeof candidate.excerpt === "string" &&
    typeof candidate.id === "number" &&
    typeof candidate.path === "string" &&
    typeof candidate.score === "number" &&
    typeof candidate.title === "string"
  );
}

function validMessage(message: unknown): message is ChatMessage {
  if (!message || typeof message !== "object") return false;

  const candidate = message as Partial<ChatMessage>;
  return (
    typeof candidate.id === "string" &&
    (candidate.role === "user" || candidate.role === "assistant" || candidate.role === "tool") &&
    typeof candidate.content === "string" &&
    typeof candidate.createdAt === "number" &&
    (typeof candidate.patches === "undefined" ||
      (Array.isArray(candidate.patches) && candidate.patches.every(validPatch))) &&
    (typeof candidate.toolCalls === "undefined" || Array.isArray(candidate.toolCalls))
  );
}

function validAgentContextState(contextState: unknown): contextState is AgentContextState {
  if (!contextState || typeof contextState !== "object") return false;

  const candidate = contextState as Partial<AgentContextState>;
  return (
    (typeof candidate.summary === "undefined" || typeof candidate.summary === "string") &&
    (typeof candidate.summarizedThroughMessageIndex === "undefined" ||
      typeof candidate.summarizedThroughMessageIndex === "number")
  );
}

function validPatch(patch: unknown): patch is ProposedDocumentPatch {
  if (!patch || typeof patch !== "object") return false;

  const candidate = patch as Partial<ProposedDocumentPatch>;
  const changeType = candidate.changeType ?? "patch";

  if (changeType !== "patch" && changeType !== "replace") {
    return false;
  }

  const hasValidContent =
    changeType === "replace"
      ? typeof candidate.replacementMarkdown === "string"
      : typeof candidate.patchText === "string";

  return (
    typeof candidate.id === "string" &&
    typeof candidate.documentPath === "string" &&
    typeof candidate.baseHash === "string" &&
    typeof candidate.summary === "string" &&
    hasValidContent &&
    ["pending", "previewing", "applied", "undone", "rejected", "error"].includes(candidate.status ?? "") &&
    typeof candidate.createdAt === "number"
  );
}

function titleFromMessages(messages: ChatMessage[]) {
  const firstUserMessage = messages.find((message) => message.role === "user" && message.content.trim());
  if (!firstUserMessage) return "New Chat";

  const title = firstUserMessage.content.trim();
  return title.length > 40 ? `${title.slice(0, 40)}...` : title;
}

function PatchPreview({
  onApply,
  onReject,
  onUndo,
  patch,
}: {
  onApply: (patchId: string) => void;
  onReject: (patchId: string) => void;
  onUndo: (patchId: string) => void;
  patch: ProposedDocumentPatch;
}) {
  const [showDetails, setShowDetails] = useState(true);
  const canReviewPatch = patch.status === "pending" || patch.status === "previewing" || patch.status === "error";
  const canApplyPatch = patch.status === "pending" || patch.status === "previewing";
  const changeType = patch.changeType ?? "patch";
  const detailsText = changeType === "replace" ? patch.replacementMarkdown : patch.patchText;

  return (
    <div className="mt-3 rounded-xl bg-black/20 p-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-white/48">
            {changeType === "replace" ? "Proposed Replacement" : "Proposed Patch"}
          </p>
          <p className="mt-1 text-sm text-white/88">{patch.summary}</p>
          <p className="mt-1 text-xs text-white/42">
            {patch.status === "applied"
              ? "Applied to the note. You can undo this change from here."
              : patch.status === "undone"
                ? "This change was undone."
                : "Review the proposed change here before applying."}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-1 text-[11px] ${
            patch.status === "pending"
              ? "bg-amber-300/12 text-amber-200/90"
              : patch.status === "previewing"
                ? "bg-sky-300/12 text-sky-200/90"
                : patch.status === "applied"
                  ? "bg-emerald-300/12 text-emerald-200/90"
                  : patch.status === "undone"
                    ? "bg-violet-300/12 text-violet-200/90"
                    : patch.status === "error"
                      ? "bg-red-300/12 text-red-200/90"
                      : "bg-white/10 text-white/55"
          }`}
        >
          {patch.status === "previewing" ? "previewing" : patch.status}
        </span>
      </div>

      {showDetails && (
        <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-black/30 p-3 text-xs leading-5 text-white/72">
          {detailsText}
        </pre>
      )}

      {patch.error && <p className="mt-3 rounded-lg bg-red-300/10 px-2 py-1.5 text-xs text-red-200">{patch.error}</p>}

      {(canReviewPatch || patch.status === "applied") && (
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-full px-3 py-1.5 text-xs text-white/55 transition hover:bg-white/[0.08] hover:text-white/85"
            onClick={() => setShowDetails((detailsVisible) => !detailsVisible)}
          >
            {showDetails ? "Hide patch" : "Details"}
          </button>
          {patch.status === "applied" ? (
            <button
              type="button"
              className="rounded-full px-3 py-1.5 text-xs text-white/55 transition hover:bg-white/[0.08] hover:text-white/85"
              onClick={() => onUndo(patch.id)}
            >
              Undo
            </button>
          ) : (
            <button
              type="button"
              className="rounded-full px-3 py-1.5 text-xs text-white/55 transition hover:bg-white/[0.08] hover:text-white/85"
              onClick={() => onReject(patch.id)}
            >
              Reject
            </button>
          )}
          {canApplyPatch && (
            <button
              type="button"
              className="rounded-full bg-white/90 px-3 py-1.5 text-xs font-medium text-black transition hover:bg-white"
              onClick={() => onApply(patch.id)}
            >
              Apply
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function readSessions() {
  if (typeof window === "undefined") return [];

  try {
    const stored = localStorage.getItem(sessionsStorageKey);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        return parsed.filter((session): session is ChatSession => {
          return (
            typeof session?.id === "string" &&
            typeof session.title === "string" &&
            Array.isArray(session.messages) &&
            session.messages.every(validMessage) &&
            (typeof session.agentContextState === "undefined" || validAgentContextState(session.agentContextState)) &&
            typeof session.createdAt === "number" &&
            typeof session.updatedAt === "number"
          );
        });
      }
    }

    const legacy = localStorage.getItem(legacyChatStorageKey);
    if (!legacy) return [];

    const legacyMessages = JSON.parse(legacy);
    if (!Array.isArray(legacyMessages)) return [];

    const messages = legacyMessages.filter(validMessage);
    if (messages.length === 0) return [];

    return [
      {
        id: generateId("session"),
        title: titleFromMessages(messages),
        messages,
        createdAt: messages[0]?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
      },
    ];
  } catch {
    return [];
  }
}

function formatSessionDate(timestamp: number) {
  const now = new Date();
  const date = new Date(timestamp);
  const days = Math.floor((now.getTime() - date.getTime()) / 86_400_000);

  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return date.toLocaleDateString();
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read image."));
    reader.readAsDataURL(file);
  });
}

function contentWithSourceLinks(content: string) {
  return content.replace(/<source\s*(\d+)>/gi, (_match, sourceId: string) => {
    return `[source ${sourceId}](#learner-source-${sourceId})`;
  });
}

function truncateSourceTitle(title: string, maxLength = 28) {
  const normalizedTitle = title.trim() || "Untitled note";
  if (normalizedTitle.length <= maxLength) return normalizedTitle;

  return `${normalizedTitle.slice(0, Math.max(1, maxLength - 3)).trim()}...`;
}

function normalizeMathDelimiters(content: string) {
  return content
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((segment) => {
      if (segment.startsWith("```") || segment.startsWith("`")) return segment;

      return segment
        .replace(/\\\[((?:.|\n)*?)\\\]/g, (_match, math: string) => `$$\n${math.trim()}\n$$`)
        .replace(/\\\(((?:.|\n)*?)\\\)/g, (_match, math: string) => `$${math.trim()}$`);
    })
    .join("");
}

function sourceFromHref(href: string | undefined, sources: AgentSource[]) {
  const match = href?.match(/^#learner-source-(\d+)$/);
  if (!match) return null;

  const sourceId = Number(match[1]);
  return sources.find((source) => source.id === sourceId) ?? null;
}

function parseToolResult(result: unknown) {
  if (typeof result !== "string") return result;

  try {
    return JSON.parse(result);
  } catch {
    return result;
  }
}

function toolResultSources(result: unknown) {
  const parsed = parseToolResult(result);
  if (!parsed || typeof parsed !== "object") return [];

  const sources = (parsed as { sources?: unknown }).sources;
  if (!Array.isArray(sources)) return [];

  return sources.filter(validSource);
}

function toolResultPatch(result: unknown) {
  const parsed = parseToolResult(result);
  if (!parsed || typeof parsed !== "object") return null;

  const patch = (parsed as { patch?: unknown }).patch;
  return validPatch(patch) ? patch : null;
}

function sourcesForMessage(messages: ChatMessage[], messageIndex: number) {
  const sourcesById = new Map<number, AgentSource>();

  for (let index = messageIndex - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user") break;

    for (const source of toolResultSources(message.toolResult)) {
      sourcesById.set(source.id, source);
    }
  }

  return [...sourcesById.values()].sort((left, right) => left.id - right.id);
}

function MessageContent({
  message,
  onOpenSource,
  sources,
}: {
  message: ChatMessage;
  onOpenSource: (source: AgentSource) => void;
  sources: AgentSource[];
}) {
  if (message.role === "user") {
    return <p className="whitespace-pre-wrap">{message.content}</p>;
  }

  return (
      <RichMarkdown
        components={{
          a: ({ children, href }) => {
            const source = sourceFromHref(href, sources);

            if (source) {
              return (
                <button
                  type="button"
                  className="mx-0.5 inline-flex translate-y-[-1px] items-center rounded-full bg-sky-300/12 px-1.5 py-0.5 text-[0.75em] font-medium text-sky-100/90 transition hover:bg-sky-300/20"
                  onClick={() => onOpenSource(source)}
                  title={`${source.path}\n\n${source.excerpt}`}
                >
                  {truncateSourceTitle(source.title)}
                </button>
              );
            }

            return (
              <a href={href} rel="noreferrer" target="_blank">
                {children}
              </a>
            );
          },
        }}
      >
        {contentWithSourceLinks(normalizeMathDelimiters(message.content))}
      </RichMarkdown>
  );
}

function ChatLoadingSkeleton() {
  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[72%] space-y-2 px-1 py-1" aria-label="Assistant is thinking">
        <div className="h-3.5 w-24 animate-pulse rounded-full bg-white/[0.10]" />
        <div className="space-y-2">
          <div className="h-3.5 w-full animate-pulse rounded-full bg-white/[0.08]" />
          <div className="h-3.5 w-5/6 animate-pulse rounded-full bg-white/[0.07]" />
          <div className="h-3.5 w-2/3 animate-pulse rounded-full bg-white/[0.06]" />
        </div>
      </div>
    </div>
  );
}

function ToolCallMessage({ toolCalls }: { toolCalls: AgentToolCall[] }) {
  return (
    <div className="space-y-1 text-xs text-white/45">
      {toolCalls.map((toolCall) => (
        <p key={toolCall.id}>
          Using <span className="font-medium text-white/65">{toolCall.name}</span>
        </p>
      ))}
    </div>
  );
}

function ToolResultMessage({ message }: { message: ChatMessage }) {
  const parsedResult = parseToolResult(message.toolResult);
  const sources = toolResultSources(message.toolResult);

  if (sources.length > 0) {
    return (
      <p className="text-xs text-white/42">
        Found {sources.length} note source{sources.length === 1 ? "" : "s"} with{" "}
        <span className="text-white/62">{message.toolName}</span>.
      </p>
    );
  }

  if (message.patches?.length) {
    return null;
  }

  const text =
    typeof parsedResult === "string"
      ? parsedResult
      : parsedResult && typeof parsedResult === "object" && typeof (parsedResult as { message?: unknown }).message === "string"
        ? (parsedResult as { message: string }).message
        : `${message.toolName ?? "tool"} finished.`;

  return <p className="text-xs text-white/42">{text}</p>;
}

export default function ChatPanel({
  closeDocumentTab,
  ensureDocumentTools,
  foregroundContext,
  getCurrentDocumentTools,
  getDocumentTools,
  getOpenDocumentPaths,
  isSidebarOpen,
  isOpen,
  onClose,
  onDocumentsChanged,
  onOpenDocument,
}: {
  closeDocumentTab: (documentPath: string, documentType?: DocumentNode["type"]) => void;
  ensureDocumentTools: (documentPath: string) => Promise<CurrentDocumentAgentTools | null>;
  foregroundContext: AgentForegroundContext | null;
  getCurrentDocumentTools: () => CurrentDocumentAgentTools | null;
  getDocumentTools: (documentPath: string) => CurrentDocumentAgentTools | null;
  getOpenDocumentPaths: () => string[];
  isSidebarOpen: boolean;
  isOpen: boolean;
  onClose: () => void;
  onDocumentsChanged: () => void;
  onOpenDocument: (documentPath: string) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [dismissedForegroundContextKey, setDismissedForegroundContextKey] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [images, setImages] = useState<PendingImage[]>([]);
  const [isAgentRunning, setIsAgentRunning] = useState(false);
  const [agentContextState, setAgentContextState] = useState<AgentContextState>({});
  const [isDragOver, setIsDragOver] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [storageLoaded, setStorageLoaded] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imagesRef = useRef<PendingImage[]>([]);
  const foregroundContextEnabled = Boolean(
    foregroundContext && foregroundContext.key !== dismissedForegroundContextKey,
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      oldSessionStorageKeys.forEach((storageKey) => localStorage.removeItem(storageKey));

      const loadedSessions = readSessions();
      const savedSessionId = localStorage.getItem(currentSessionStorageKey);
      const activeSession =
        loadedSessions.find((session) => session.id === savedSessionId) ?? loadedSessions[0] ?? null;
      const nextSessionId = activeSession?.id ?? generateId("session");

      setSessions(loadedSessions);
      setCurrentSessionId(nextSessionId);
      setMessages(activeSession?.messages ?? []);
      setAgentContextState(activeSession?.agentContextState ?? {});
      setStorageLoaded(true);
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!storageLoaded || !currentSessionId) return;
    localStorage.setItem(currentSessionStorageKey, currentSessionId);
  }, [currentSessionId, storageLoaded]);

  useEffect(() => {
    if (!storageLoaded) return;
    localStorage.setItem(sessionsStorageKey, JSON.stringify(sessions));
  }, [sessions, storageLoaded]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    if (!isOpen) return;
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [isOpen, messages]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 132)}px`;
  }, [input]);

  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  useEffect(() => {
    return () => {
      for (const image of imagesRef.current) {
        URL.revokeObjectURL(image.previewUrl);
      }
    };
  }, []);

  function saveMessagesToSession(nextMessages: ChatMessage[], nextAgentContextState = agentContextState) {
    if (!currentSessionId || nextMessages.length === 0) return;

    setSessions((current) => {
      const existingSession = current.find((session) => session.id === currentSessionId);
      const nextSession: ChatSession = {
        id: currentSessionId,
        title: titleFromMessages(nextMessages),
        messages: nextMessages,
        agentContextState: nextAgentContextState,
        createdAt: existingSession?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
      };

      return [nextSession, ...current.filter((session) => session.id !== currentSessionId)];
    });
  }

  function startNewChat() {
    abortControllerRef.current?.abort();
    setCurrentSessionId(generateId("session"));
    setMessages([]);
    setAgentContextState({});
    setInput("");
    setImages((current) => {
      current.forEach((image) => URL.revokeObjectURL(image.previewUrl));
      return [];
    });
    setHistoryOpen(false);
  }

  function loadSession(session: ChatSession) {
    abortControllerRef.current?.abort();
    setCurrentSessionId(session.id);
    setMessages(session.messages);
    setAgentContextState(session.agentContextState ?? {});
    setHistoryOpen(false);
  }

  function deleteSession(sessionId: string) {
    setSessions((current) => current.filter((session) => session.id !== sessionId));

    if (sessionId === currentSessionId) {
      setCurrentSessionId(generateId("session"));
      setMessages([]);
      setAgentContextState({});
    }
  }

  async function processFiles(files: File[]) {
    const availableSlots = maxImages - images.length;
    const acceptedFiles = files
      .filter((file) => acceptedImageTypes.includes(file.type) && file.size <= maxImageSize)
      .slice(0, availableSlots);

    if (acceptedFiles.length === 0) return;

    const pendingImages = acceptedFiles.map((file) => ({
      id: generateId("image"),
      previewUrl: URL.createObjectURL(file),
      dataUrl: null,
      status: "loading" as const,
      file,
    }));

    setImages((current) => [
      ...current,
      ...pendingImages.map((image) => ({
        id: image.id,
        previewUrl: image.previewUrl,
        dataUrl: image.dataUrl,
        status: image.status,
      })),
    ]);

    for (const pendingImage of pendingImages) {
      try {
        const dataUrl = await fileToDataUrl(pendingImage.file);
        setImages((current) =>
          current.map((image) =>
            image.id === pendingImage.id ? { ...image, dataUrl, status: "ready" } : image,
          ),
        );
      } catch {
        setImages((current) =>
          current.map((image) =>
            image.id === pendingImage.id ? { ...image, status: "error" } : image,
          ),
        );
      }
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) {
      void processFiles(Array.from(event.target.files));
    }
    event.target.value = "";
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const pastedFiles = Array.from(event.clipboardData?.items ?? [])
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => file instanceof File && acceptedImageTypes.includes(file.type));

    if (pastedFiles.length === 0) return;

    event.preventDefault();
    void processFiles(pastedFiles);
  }

  function handleDrop(event: DragEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsDragOver(false);
    void processFiles(Array.from(event.dataTransfer.files));
  }

  function removeImage(imageId: string) {
    setImages((current) => {
      const target = current.find((image) => image.id === imageId);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((image) => image.id !== imageId);
    });
  }

  function updatePatch(patchId: string, update: (patch: ProposedDocumentPatch) => ProposedDocumentPatch) {
    const nextMessages = messagesRef.current.map((message) => {
      if (!message.patches?.some((patch) => patch.id === patchId)) return message;

      return {
        ...message,
        patches: message.patches.map((patch) => (patch.id === patchId ? update(patch) : patch)),
      };
    });

    messagesRef.current = nextMessages;
    setMessages(nextMessages);
    saveMessagesToSession(nextMessages);
  }

  function commitMessages(nextMessages: ChatMessage[], options?: { persist?: boolean; contextState?: AgentContextState }) {
    messagesRef.current = nextMessages;
    setMessages(nextMessages);

    if (options?.persist ?? true) {
      saveMessagesToSession(nextMessages, options?.contextState ?? agentContextState);
    }
  }

  function getPatchDocumentTools(patch: ProposedDocumentPatch) {
    const normalizedPath = documentToolPath(patch.documentPath);
    const exactTools = getDocumentTools(normalizedPath);
    if (exactTools) return exactTools;

    const currentTools = getCurrentDocumentTools();
    return currentTools?.path === normalizedPath ? currentTools : null;
  }

  function applyPatchToDocument(patch: ProposedDocumentPatch): ProposedDocumentPatch {
    const documentTools = getPatchDocumentTools(patch);
    if (!documentTools) {
      return {
        ...patch,
        status: "error",
        error: `Open ${patch.documentPath} before applying this edit.`,
      };
    }

    const result = documentTools.applyPatch(patch);

    if (result.failures.length === 0) {
      documentTools.clearPatchPreview(patch.id);
    }

    return {
      ...patch,
      status: result.failures.length > 0 ? "error" : "applied",
      error: result.failures.join("\n") || undefined,
    };
  }

  function toolResultWithPatchStatus(result: unknown, patch: ProposedDocumentPatch) {
    const parsed = parseToolResult(result);
    if (!parsed || typeof parsed !== "object") return result;

    return JSON.stringify(
      {
        ...(parsed as Record<string, unknown>),
        message:
          patch.status === "applied"
            ? "Edit applied automatically. The user can undo it from this message."
            : patch.error ?? "Edit could not be applied automatically.",
        patch,
      },
      null,
      2,
    );
  }

  function applyPatch(patchId: string) {
    const patch = messagesRef.current
      .flatMap((message) => message.patches ?? [])
      .find((candidate) => candidate.id === patchId);

    if (!patch) return;

    updatePatch(patchId, () => applyPatchToDocument(patch));
  }

  function undoPatch(patchId: string) {
    const patch = messagesRef.current
      .flatMap((message) => message.patches ?? [])
      .find((candidate) => candidate.id === patchId);
    const documentTools = patch ? getPatchDocumentTools(patch) : getCurrentDocumentTools();
    if (!documentTools) {
      updatePatch(patchId, (current) => ({
        ...current,
        status: "error",
        error: "Open the target document before undoing this change.",
      }));
      return;
    }

    const result = documentTools.undoPatch(patchId);

    updatePatch(patchId, (current) => ({
      ...current,
      status: result.failures.length > 0 ? "error" : "undone",
      error: result.failures.join("\n") || undefined,
    }));
  }

  function rejectPatch(patchId: string) {
    const patch = messagesRef.current
      .flatMap((message) => message.patches ?? [])
      .find((candidate) => candidate.id === patchId);
    if (patch) {
      getPatchDocumentTools(patch)?.clearPatchPreview(patchId);
    } else {
      getCurrentDocumentTools()?.clearPatchPreview(patchId);
    }
    updatePatch(patchId, (patch) => ({
      ...patch,
      status: "rejected",
      error: undefined,
    }));
  }

  function openSource(source: AgentSource) {
    onOpenDocument(source.path);
  }

  function stopAgent() {
    abortControllerRef.current?.abort();
  }

  async function submitMessage(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (isAgentRunning) return;

    const content = input.trim();
    const readyImages = images.filter((image) => image.status === "ready" && image.dataUrl);
    if (!content && readyImages.length === 0) return;
    const attachedForegroundContext = foregroundContextEnabled ? foregroundContext : null;

    const userMessage: ChatMessage = {
      id: generateId("message"),
      role: "user",
      content,
      createdAt: Date.now(),
      images: readyImages.map((image) => image.dataUrl as string),
      viewingContext: attachedForegroundContext
        ? {
            attached: true,
            description: foregroundContextDescription(attachedForegroundContext),
            key: attachedForegroundContext.key,
          }
        : undefined,
    };
    const messagesForAgent = [...messages, userMessage];
    const nextMessages = [...messages, userMessage];

    commitMessages(nextMessages);

    setInput("");
    setImages((current) => {
      current.forEach((image) => URL.revokeObjectURL(image.previewUrl));
      return [];
    });

    setIsAgentRunning(true);
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      let streamingMessageId = "";
      let streamingContent = "";

      for await (const chunk of runStudyAgentLoop({
        contextState: agentContextState,
        closeDocumentTab,
        ensureDocumentTools,
        getCurrentDocumentTools,
        getDocumentTools,
        getOpenDocumentPaths,
        foregroundContext: attachedForegroundContext,
        messages: messagesForAgent
          .filter(
            (message): message is ChatMessage & { role: "user" | "assistant" } =>
              message.role === "user" || (message.role === "assistant" && Boolean(message.content.trim())),
          )
          .map((message) => ({
            role: message.role,
            content: message.content,
            images: message.images,
          })),
        onDocumentsChanged,
        signal: abortController.signal,
      })) {
        if (chunk.type === "tool_call") {
          const toolCallMessage: ChatMessage = {
            id: generateId("message"),
            role: "assistant",
            content: "",
            createdAt: Date.now(),
            toolCalls: [chunk.toolCall],
          };

          commitMessages([...messagesRef.current, toolCallMessage]);
          continue;
        }

        if (chunk.type === "tool_result") {
          const proposedPatch = toolResultPatch(chunk.result);
          const appliedPatch = proposedPatch ? applyPatchToDocument(proposedPatch) : null;
          const toolMessage: ChatMessage = {
            id: generateId("message"),
            role: "tool",
            content: "",
            createdAt: Date.now(),
            patches: appliedPatch ? [appliedPatch] : undefined,
            toolCallId: chunk.toolCallId,
            toolName: chunk.toolName,
            toolResult: appliedPatch ? toolResultWithPatchStatus(chunk.result, appliedPatch) : chunk.result,
          };

          commitMessages([...messagesRef.current, toolMessage]);
          continue;
        }

        if (chunk.type === "text_delta") {
          streamingContent += chunk.content;

          if (!streamingMessageId) {
            streamingMessageId = generateId("message");
            commitMessages(
              [
                ...messagesRef.current,
                {
                  id: streamingMessageId,
                  role: "assistant",
                  content: streamingContent,
                  createdAt: Date.now(),
                  isStreaming: true,
                },
              ],
              { persist: false },
            );
          } else {
            commitMessages(
              messagesRef.current.map((message) =>
                message.id === streamingMessageId ? { ...message, content: streamingContent } : message,
              ),
              { persist: false },
            );
          }

          continue;
        }

        if (chunk.type === "text_done" && streamingMessageId) {
          commitMessages(
            messagesRef.current.map((message) =>
              message.id === streamingMessageId ? { ...message, isStreaming: false } : message,
            ),
          );
          streamingMessageId = "";
          streamingContent = "";
          continue;
        }

        if (chunk.type === "done") {
          setAgentContextState(chunk.contextState);
          commitMessages(messagesRef.current, { contextState: chunk.contextState });
        }
      }
    } catch (agentError) {
      if (abortController.signal.aborted) {
        commitMessages(
          messagesRef.current.map((message) =>
            message.isStreaming ? { ...message, isStreaming: false } : message,
          ),
        );
        return;
      }

      const errorMessage =
        agentError instanceof Error ? agentError.message : "The study agent failed to respond.";
      commitMessages([
        ...messagesRef.current,
        {
          id: generateId("message"),
          role: "assistant",
          content: `I couldn't complete that request.\n\n${errorMessage}`,
          createdAt: Date.now(),
        },
      ]);
    } finally {
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
      }
      setIsAgentRunning(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitMessage();
    }
  }

  const hasDraftMessage = Boolean(input.trim()) || images.some((image) => image.status === "ready");
  const canSend = !isAgentRunning && hasDraftMessage;
  const isUploading = images.some((image) => image.status === "loading");
  const panelBounds = isFullscreen
    ? `${isSidebarOpen ? "left-64" : "left-0"} right-0 top-10 bottom-0 h-auto w-auto rounded-none`
    : "bottom-16 right-4 h-[min(620px,calc(100vh-6rem))] w-[min(520px,calc(100vw-2rem))] rounded-[22px]";
  const contentWidth = isFullscreen ? "mx-auto w-full max-w-4xl" : "";
  const showAgentSkeleton =
    isAgentRunning && !messages.some((message) => message.role === "assistant" && message.isStreaming);

  return (
    <section
      aria-hidden={!isOpen}
      className={`app-no-drag fixed z-40 flex flex-col overflow-hidden bg-[#121212]/72 text-white shadow-[0_30px_90px_rgba(0,0,0,0.55)] ring-1 ring-white/[0.08] backdrop-blur-[24px] transition-all duration-200 ${panelBounds} ${
        isOpen ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0"
      }`}
    >
      <header className="relative z-10 flex h-14 shrink-0 items-center justify-between px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/[0.08] text-white/90 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
            <SparkleIcon size={18} weight="fill" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-5">AI Chat</p>
            <p className="truncate text-[11px] text-white/45">Study agent</p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Chat history"
            className="flex h-8 w-8 items-center justify-center rounded-full text-white/50 transition-colors hover:bg-white/[0.08] hover:text-white/85"
            onClick={() => setHistoryOpen(true)}
          >
            <ClockCounterClockwiseIcon size={17} />
          </button>
          <button
            type="button"
            aria-label="New chat"
            className="flex h-8 w-8 items-center justify-center rounded-full text-white/50 transition-colors hover:bg-white/[0.08] hover:text-white/85"
            onClick={startNewChat}
          >
            <PlusIcon size={17} weight="bold" />
          </button>
          <button
            type="button"
            aria-label={isFullscreen ? "Exit fullscreen chat" : "Fullscreen chat"}
            className="flex h-8 w-8 items-center justify-center rounded-full text-white/50 transition-colors hover:bg-white/[0.08] hover:text-white/85"
            onClick={() => setIsFullscreen((fullscreen) => !fullscreen)}
          >
            {isFullscreen ? <CornersInIcon size={17} /> : <CornersOutIcon size={17} />}
          </button>
          <button
            type="button"
            aria-label="Close AI chat"
            className="flex h-8 w-8 items-center justify-center rounded-full text-white/50 transition-colors hover:bg-white/[0.08] hover:text-white/85"
            onClick={onClose}
          >
            <XIcon size={16} />
          </button>
        </div>
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div className="absolute inset-0 overflow-y-auto overflow-x-hidden px-5 pb-4 pt-2">
          {messages.length === 0 ? (
            <div className={`${contentWidth} flex min-h-full flex-col items-center justify-center px-8 text-center`}>
              <p className="bg-gradient-to-br from-white to-white/45 bg-clip-text text-2xl font-semibold text-transparent">
                How can I help?
              </p>
              <p className="mt-3 max-w-[22rem] text-sm leading-6 text-white/45">
                Ask me to explain, rewrite, summarize, or turn your notes into practice prompts.
              </p>
            </div>
          ) : (
            <div className={`${contentWidth} space-y-4`}>
              {messages.map((message, messageIndex) => (
                <div
                  className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                  key={message.id}
                >
                  <div
                    className={`text-sm leading-relaxed ${
                      message.role === "user"
                        ? "max-w-[78%] rounded-2xl rounded-br-md bg-white/[0.10] px-3.5 py-2.5 text-left text-white/92 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
                        : message.role === "tool"
                          ? "max-w-[78%] px-1 py-0.5 text-white/55"
                          : "min-w-0 flex-1 px-1 py-1 text-white/88"
                    }`}
                  >
                    {message.images && message.images.length > 0 && (
                      <div className={`${message.content ? "mb-3" : ""} flex flex-wrap gap-2`}>
                        {message.images.map((image, index) => (
                          <button
                            type="button"
                            className="h-24 w-24 overflow-hidden rounded-xl bg-black/30 transition hover:scale-[1.02]"
                            key={`${message.id}-${index}`}
                            onClick={() => setPreviewImage(image)}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img alt="" className="h-full w-full object-cover" src={image} />
                          </button>
                        ))}
                      </div>
                    )}
                    {message.role === "user" && message.viewingContext?.attached && (
                      <p className={`${message.content || message.images?.length ? "mt-2" : ""} text-[11px] text-white/42`}>
                        Viewing context attached · {message.viewingContext.description}
                      </p>
                    )}
                    {message.toolCalls?.length ? (
                      <ToolCallMessage toolCalls={message.toolCalls} />
                    ) : message.role === "tool" ? (
                      <ToolResultMessage message={message} />
                    ) : message.role === "assistant" && !message.content ? (
                      <ChatLoadingSkeleton />
                    ) : (
                      (message.content || message.role === "assistant") && (
                        <MessageContent
                          message={message}
                          onOpenSource={openSource}
                          sources={sourcesForMessage(messages, messageIndex)}
                        />
                      )
                    )}
                    {message.patches?.map((patch) => (
                      <PatchPreview
                        key={patch.id}
                        onApply={applyPatch}
                        onReject={rejectPatch}
                        onUndo={undoPatch}
                        patch={patch}
                      />
                    ))}
                  </div>
                </div>
              ))}
              {showAgentSkeleton && <ChatLoadingSkeleton />}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="relative z-10 px-4 pb-4 bottom-1 backdrop-blur-[76px]">
        <form
          className={`${contentWidth} flex flex-col rounded-[20px] bg-white/[0.08] p-2 shadow-[0_4px_24px_rgba(0,0,0,0.28),inset_0_0_0_1px_rgba(255,255,255,0.12)] backdrop-blur-xl transition ${
            isDragOver ? "shadow-[0_0_0_1px_rgba(255,255,255,0.45),0_4px_24px_rgba(0,0,0,0.28)]" : ""
          }`}
          onDragLeave={(event) => {
            event.preventDefault();
            setIsDragOver(false);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragOver(true);
          }}
          onDrop={handleDrop}
          onSubmit={submitMessage}
        >
          <input
            accept={acceptedImageTypes.join(",")}
            className="hidden"
            multiple
            onChange={handleFileChange}
            ref={fileInputRef}
            type="file"
          />

          {images.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2 px-1">
              {images.map((image) => (
                <button
                  type="button"
                  className="relative h-16 w-16 overflow-hidden rounded-lg bg-black/35 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.16)] transition hover:scale-[1.02]"
                  key={image.id}
                  onClick={() => image.dataUrl && setPreviewImage(image.dataUrl)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img alt="" className="h-full w-full object-cover" src={image.previewUrl} />
                  {image.status !== "ready" && (
                    <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-[10px] text-white/75">
                      {image.status === "loading" ? "Loading" : "Error"}
                    </span>
                  )}
                  <span
                    className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/65 text-white"
                    onClick={(event) => {
                      event.stopPropagation();
                      removeImage(image.id);
                    }}
                  >
                    <XIcon size={11} />
                  </span>
                </button>
              ))}
            </div>
          )}

          {foregroundContext && foregroundContextEnabled && (
            <div className="mb-2 flex items-center px-1">
              <span className="inline-flex min-w-0 items-center gap-2 rounded-full bg-white/[0.07] py-1 pl-2.5 pr-1 text-[11px] text-white/62 ring-1 ring-white/[0.08]">
                <span className="shrink-0 font-medium text-white/42">Viewing</span>
                <span className="truncate">{foregroundContextDescription(foregroundContext)}</span>
                <button
                  aria-label="Remove viewing context"
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white/38 transition hover:bg-white/[0.08] hover:text-white/74"
                  onClick={() => setDismissedForegroundContextKey(foregroundContext.key)}
                  type="button"
                >
                  <XIcon size={11} />
                </button>
              </span>
            </div>
          )}

          <div className="flex items-end gap-1">
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  aria-label="Add attachment"
                  className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/55 transition-colors hover:bg-white/[0.08] hover:text-white/85 data-[state=open]:bg-white/[0.08] data-[state=open]:text-white/85"
                >
                  <PlusIcon size={19} />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="start"
                  className="app-no-drag z-[90] w-64 rounded-xl bg-[#242424] p-1.5 text-white shadow-2xl ring-1 ring-white/[0.12]"
                  side="top"
                  sideOffset={8}
                >
                  <DropdownMenu.Item
                    className="flex cursor-default select-none items-center gap-3 rounded-lg px-3 py-2 text-sm text-white/72 outline-none transition data-[highlighted]:bg-white/[0.07] data-[highlighted]:text-white/90"
                    onSelect={() => fileInputRef.current?.click()}
                  >
                    <ImageIcon size={17} />
                    Add images
                  </DropdownMenu.Item>
                  {foregroundContext && (
                    <DropdownMenu.CheckboxItem
                      checked={foregroundContextEnabled}
                      className="flex cursor-default select-none items-center justify-between gap-3 rounded-lg px-3 py-2 text-left outline-none transition data-[highlighted]:bg-white/[0.07]"
                      onCheckedChange={(checked) => {
                        setDismissedForegroundContextKey(checked ? null : foregroundContext.key);
                      }}
                      onSelect={(event) => event.preventDefault()}
                    >
                      <span className="min-w-0">
                        <span className="block text-sm text-white/72">Include viewing context</span>
                        <span className="block truncate text-[11px] text-white/36">
                          {foregroundContextDescription(foregroundContext)}
                        </span>
                      </span>
                      <span className={`flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition ${
                        foregroundContextEnabled ? "justify-end bg-white/22" : "justify-start bg-white/[0.08]"
                      }`}>
                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white text-black">
                          {foregroundContextEnabled && <CheckIcon size={10} weight="bold" />}
                        </span>
                      </span>
                    </DropdownMenu.CheckboxItem>
                  )}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>

            <textarea
              aria-label="Message"
              className="max-h-[132px] min-h-8 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm leading-6 text-white outline-none placeholder:text-white/38"
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={images.length > 0 ? "Add a message about the image..." : "Ask anything..."}
              ref={textareaRef}
              rows={1}
              value={input}
            />

            <button
              type={isAgentRunning ? "button" : "submit"}
              aria-label={isAgentRunning ? "Stop response" : "Send message"}
              className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/55 transition-colors hover:bg-white/[0.08] hover:text-white/85 disabled:cursor-default disabled:text-white/25 disabled:hover:bg-transparent"
              disabled={isAgentRunning ? false : !canSend || isUploading}
              onClick={isAgentRunning ? stopAgent : undefined}
            >
              {isAgentRunning ? <StopIcon size={18} weight="fill" /> : <PaperPlaneRightIcon size={20} weight="fill" />}
            </button>
          </div>
        </form>
      </div>

      <aside
        className={`absolute inset-y-0 left-0 z-30 w-[300px] bg-[#1e1e24]/95 shadow-[18px_0_60px_rgba(0,0,0,0.35)] ring-1 ring-white/[0.08] backdrop-blur-[20px] transition-transform duration-200 ${
          historyOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-14 items-center justify-between px-4">
          <p className="text-sm font-semibold">Chat History</p>
          <button
            type="button"
            aria-label="Close history"
            className="flex h-8 w-8 items-center justify-center rounded-full text-white/50 transition-colors hover:bg-white/[0.08] hover:text-white/85"
            onClick={() => setHistoryOpen(false)}
          >
            <XIcon size={16} />
          </button>
        </div>

        <div className="px-4 pb-3">
          <button
            type="button"
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-white/[0.06] py-2 text-sm font-medium text-white/82 transition-colors hover:bg-white/[0.1]"
            onClick={startNewChat}
          >
            <PlusIcon size={16} weight="bold" />
            New Chat
          </button>
        </div>

        <div className="h-[calc(100%-7rem)] overflow-y-auto px-2 pb-3">
          {sessions.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-white/45">No chat history yet</p>
          ) : (
            sessions.map((session) => (
              <button
                type="button"
                className={`group flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors ${
                  session.id === currentSessionId ? "bg-white/[0.09]" : "hover:bg-white/[0.06]"
                }`}
                key={session.id}
                onClick={() => loadSession(session)}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-white/86">{session.title}</span>
                  <span className="block text-xs text-white/42">{formatSessionDate(session.updatedAt)}</span>
                </span>
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-white/35 opacity-0 transition group-hover:opacity-100 hover:bg-white/[0.08] hover:text-white/75"
                  onClick={(event) => {
                    event.stopPropagation();
                    deleteSession(session.id);
                  }}
                >
                  <TrashIcon size={15} />
                </span>
              </button>
            ))
          )}
        </div>
      </aside>

      {historyOpen && (
        <button
          type="button"
          aria-label="Close history overlay"
          className="absolute inset-0 z-20 bg-black/20"
          onClick={() => setHistoryOpen(false)}
        />
      )}

      {previewImage && (
        <button
          type="button"
          className="absolute inset-0 z-50 flex items-center justify-center bg-black/72 p-5 backdrop-blur-sm"
          onClick={() => setPreviewImage(null)}
          aria-label="Close image preview"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt="" className="max-h-full max-w-full rounded-xl object-contain shadow-2xl" src={previewImage} />
        </button>
      )}
    </section>
  );
}
