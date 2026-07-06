"use client";

import {
  ClockCounterClockwiseIcon,
  CornersInIcon,
  CornersOutIcon,
  ImageIcon,
  PaperPlaneRightIcon,
  PlusIcon,
  SparkleIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChangeEvent, DragEvent, FormEvent, KeyboardEvent, ClipboardEvent } from "react";

const sessionsStorageKey = "learner.ai.sessions.v1";
const currentSessionStorageKey = "learner.ai.currentSession.v1";
const legacyChatStorageKey = "learner.ai.chat.v1";

const maxImages = 5;
const maxImageSize = 4 * 1024 * 1024;
const acceptedImageTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  images?: string[];
};

type ChatSession = {
  id: string;
  title: string;
  messages: ChatMessage[];
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

function validMessage(message: unknown): message is ChatMessage {
  if (!message || typeof message !== "object") return false;

  const candidate = message as Partial<ChatMessage>;
  return (
    typeof candidate.id === "string" &&
    (candidate.role === "user" || candidate.role === "assistant") &&
    typeof candidate.content === "string" &&
    typeof candidate.createdAt === "number"
  );
}

function titleFromMessages(messages: ChatMessage[]) {
  const firstUserMessage = messages.find((message) => message.role === "user" && message.content.trim());
  if (!firstUserMessage) return "New Chat";

  const title = firstUserMessage.content.trim();
  return title.length > 40 ? `${title.slice(0, 40)}...` : title;
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

function MessageContent({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return <p className="whitespace-pre-wrap">{message.content}</p>;
  }

  return (
    <div className="learner-ai-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
    </div>
  );
}

export default function ChatPanel({
  isSidebarOpen,
  isOpen,
  onClose,
}: {
  isSidebarOpen: boolean;
  isOpen: boolean;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [input, setInput] = useState("");
  const [images, setImages] = useState<PendingImage[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [storageLoaded, setStorageLoaded] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imagesRef = useRef<PendingImage[]>([]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const loadedSessions = readSessions();
      const savedSessionId = localStorage.getItem(currentSessionStorageKey);
      const activeSession =
        loadedSessions.find((session) => session.id === savedSessionId) ?? loadedSessions[0] ?? null;
      const nextSessionId = activeSession?.id ?? generateId("session");

      setSessions(loadedSessions);
      setCurrentSessionId(nextSessionId);
      setMessages(activeSession?.messages ?? []);
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

  function saveMessagesToSession(nextMessages: ChatMessage[]) {
    if (!currentSessionId || nextMessages.length === 0) return;

    setSessions((current) => {
      const existingSession = current.find((session) => session.id === currentSessionId);
      const nextSession: ChatSession = {
        id: currentSessionId,
        title: titleFromMessages(nextMessages),
        messages: nextMessages,
        createdAt: existingSession?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
      };

      return [nextSession, ...current.filter((session) => session.id !== currentSessionId)];
    });
  }

  function startNewChat() {
    setCurrentSessionId(generateId("session"));
    setMessages([]);
    setInput("");
    setImages((current) => {
      current.forEach((image) => URL.revokeObjectURL(image.previewUrl));
      return [];
    });
    setHistoryOpen(false);
  }

  function loadSession(session: ChatSession) {
    setCurrentSessionId(session.id);
    setMessages(session.messages);
    setHistoryOpen(false);
  }

  function deleteSession(sessionId: string) {
    setSessions((current) => current.filter((session) => session.id !== sessionId));

    if (sessionId === currentSessionId) {
      setCurrentSessionId(generateId("session"));
      setMessages([]);
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

  function submitMessage(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();

    const content = input.trim();
    const readyImages = images.filter((image) => image.status === "ready" && image.dataUrl);
    if (!content && readyImages.length === 0) return;

    const nextMessages = [
      ...messages,
      {
        id: generateId("message"),
        role: "user" as const,
        content,
        createdAt: Date.now(),
        images: readyImages.map((image) => image.dataUrl as string),
      },
    ];

    setMessages(nextMessages);
    saveMessagesToSession(nextMessages);

    setInput("");
    setImages((current) => {
      current.forEach((image) => URL.revokeObjectURL(image.previewUrl));
      return [];
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitMessage();
    }
  }

  const canSend = Boolean(input.trim()) || images.some((image) => image.status === "ready");
  const isUploading = images.some((image) => image.status === "loading");
  const panelBounds = isFullscreen
    ? `${isSidebarOpen ? "left-64" : "left-0"} right-0 top-10 bottom-0 h-auto w-auto rounded-none`
    : "bottom-16 right-4 h-[min(620px,calc(100vh-6rem))] w-[min(520px,calc(100vw-2rem))] rounded-[22px]";
  const contentWidth = isFullscreen ? "mx-auto w-full max-w-4xl" : "";

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
              {messages.map((message) => (
                <div
                  className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                  key={message.id}
                >
                  <div
                    className={`max-w-[78%] rounded-2xl p-3 text-sm leading-relaxed backdrop-blur-[76px] ${
                      message.role === "user"
                        ? "rounded-br-md bg-[#6495ed]/20 text-white shadow-[inset_0_0_0_1px_rgba(100,149,237,0.3)]"
                        : "rounded-bl-md bg-white/[0.08] text-white/88 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)]"
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
                    {(message.content || message.role === "assistant") && <MessageContent message={message} />}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="relative z-10 px-4 pb-4">
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

          <div className="flex items-end gap-1">
            <button
              type="button"
              aria-label="Attach image"
              className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/55 transition-colors hover:bg-white/[0.08] hover:text-white/85"
              onClick={() => fileInputRef.current?.click()}
            >
              <ImageIcon size={19} />
            </button>

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
              type="submit"
              aria-label="Send message"
              className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/55 transition-colors hover:bg-white/[0.08] hover:text-white/85 disabled:cursor-default disabled:text-white/25 disabled:hover:bg-transparent"
              disabled={!canSend || isUploading}
            >
              <PaperPlaneRightIcon size={20} weight="fill" />
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
