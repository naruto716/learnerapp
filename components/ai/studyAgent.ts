"use client";

import { ChatOpenAI } from "@langchain/openai";
import { getEncoding } from "js-tiktoken";
import { createAgent, tool } from "langchain";
import { z } from "zod";
import { readAiSettings } from "./aiSettings";
import type { AgentForegroundContext } from "./agentForegroundContext";
import type { ProposedDocumentPatch } from "./documentPatch";
import type { CurrentDocumentAgentTools } from "@/components/editor/TiptapEditor";
import { readMasterySettings } from "@/components/mastery/masterySettings";

const maxHistoryInputTokens = 200_000;
const summarizeWhenHistoryExceedsTokens = 140_000;
const recentHistoryTargetTokens = 60_000;
const estimatedTokensPerImage = 1_000;
const tokenEncoding = getEncoding("o200k_base");

export type AgentChatMessage = {
  role: "user" | "assistant";
  content: string;
  images?: string[];
};

export type AgentContextState = {
  summary?: string;
  summarizedThroughMessageIndex?: number;
};

export type AgentSource = {
  chunkIndex: number;
  excerpt: string;
  id: number;
  path: string;
  score: number;
  title: string;
};

type RunStudyAgentRequest = {
  messages: AgentChatMessage[];
  contextState?: AgentContextState;
  closeDocumentTab?: (documentPath: string, documentType?: DocumentNode["type"]) => void;
  ensureDocumentTools?: (documentPath: string) => Promise<CurrentDocumentAgentTools | null>;
  foregroundContext?: AgentForegroundContext | null;
  getCurrentDocumentTools: () => CurrentDocumentAgentTools | null;
  getDocumentTools?: (documentPath: string) => CurrentDocumentAgentTools | null;
  getOpenDocumentPaths?: () => string[];
  onDocumentsChanged?: () => void;
  responseInstructions?: string;
  signal?: AbortSignal;
};

export type AgentToolCall = {
  id: string;
  name: string;
  args: unknown;
};

export type AgentLoopChunk =
  | {
      type: "tool_call";
      toolCall: AgentToolCall;
    }
  | {
      type: "tool_result";
      toolCallId: string;
      toolName: string;
      result: unknown;
    }
  | {
      type: "text_delta";
      content: string;
    }
  | {
      type: "text_done";
    }
  | {
      type: "done";
      contextState: AgentContextState;
    };

type ModelMessage = {
  role: "system" | "user" | "assistant";
  content:
    | string
    | Array<
        | {
            type: "text";
            text: string;
          }
        | {
            type: "image_url";
            image_url: {
              url: string;
            };
          }
      >;
};

function createLearnerModel() {
  const settings = readAiSettings();

  return new ChatOpenAI({
    model: settings.chatModel,
    apiKey: settings.apiKey,
    reasoning: {
      effort: "xhigh",
    },
    temperature: 0.25,
    streamUsage: false,
    configuration: {
      baseURL: settings.baseUrl,
      dangerouslyAllowBrowser: true,
    },
  });
}

function messageContentToText(content: unknown): string {
  if (typeof content === "string") return content;

  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === "string") return block;
        if (!block || typeof block !== "object") return "";

        const candidate = block as { text?: unknown; type?: unknown };
        if (typeof candidate.text === "string") return candidate.text;
        return "";
      })
      .join("");
  }

  return "";
}

function countTokens(text: string) {
  return tokenEncoding.encode(text).length;
}

function estimateChatMessageTokens(message: AgentChatMessage) {
  return countTokens(message.content) + (message.images?.length ?? 0) * estimatedTokensPerImage + 8;
}

function estimateModelMessageTokens(message: ModelMessage) {
  if (typeof message.content === "string") {
    return countTokens(message.content) + 8;
  }

  return (
    message.content.reduce((total, block) => {
      if (block.type === "text") return total + countTokens(block.text);
      return total + estimatedTokensPerImage;
    }, 0) + 8
  );
}

function toModelMessage(message: AgentChatMessage): ModelMessage {
  if (message.role === "assistant" || !message.images?.length) {
    return {
      role: message.role,
      content: message.content,
    };
  }

  return {
    role: "user",
    content: [
      {
        type: "text",
        text: message.content || "Please inspect the attached image.",
      },
      ...message.images.map((image) => ({
        type: "image_url" as const,
        image_url: {
          url: image,
        },
      })),
    ],
  };
}

function chatHistoryTokenEstimate(messages: AgentChatMessage[]) {
  return messages.reduce((total, message) => total + estimateChatMessageTokens(message), 0);
}

function findRecentHistoryStartIndex(messages: AgentChatMessage[], targetTokens: number) {
  let tokens = 0;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const nextTokens = estimateChatMessageTokens(messages[index]);

    if (tokens > 0 && tokens + nextTokens > targetTokens) {
      return index + 1;
    }

    tokens += nextTokens;
  }

  return 0;
}

function formatMessagesForSummary(messages: AgentChatMessage[]) {
  return messages
    .map((message) => {
      const imageNote = message.images?.length ? `\n[attached images: ${message.images.length}]` : "";
      return `${message.role.toUpperCase()}:\n${message.content}${imageNote}`;
    })
    .join("\n\n---\n\n");
}

async function summarizeChatHistory({
  existingSummary,
  messages,
}: {
  existingSummary: string;
  messages: AgentChatMessage[];
}) {
  const model = createLearnerModel();
  const response = await model.invoke([
    {
      role: "system",
      content: [
        "You compact chat history for an AI note-taking assistant.",
        "Preserve user goals, decisions, document-editing instructions, unresolved tasks, preferred style, and important facts.",
        "Do not include fluff. Keep the summary dense and useful for future model calls.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        existingSummary ? `Existing summary:\n${existingSummary}` : "Existing summary: none",
        `New messages to merge:\n${formatMessagesForSummary(messages)}`,
        "Return the updated compact summary.",
      ].join("\n\n"),
    },
  ]);

  return messageContentToText(response.content).trim();
}

async function compactContextIfNeeded(messages: AgentChatMessage[], contextState: AgentContextState) {
  const normalizedContextState = {
    summary: contextState.summary,
    summarizedThroughMessageIndex: Math.min(contextState.summarizedThroughMessageIndex ?? 0, messages.length),
  };

  if (chatHistoryTokenEstimate(messages) < summarizeWhenHistoryExceedsTokens) {
    return normalizedContextState;
  }

  const recentStartIndex = findRecentHistoryStartIndex(messages, recentHistoryTargetTokens);
  const summarizeFromIndex = normalizedContextState.summarizedThroughMessageIndex ?? 0;
  const summarizeUntilIndex = Math.max(summarizeFromIndex, recentStartIndex);

  if (summarizeUntilIndex <= summarizeFromIndex) {
    return normalizedContextState;
  }

  try {
    const summary = await summarizeChatHistory({
      existingSummary: normalizedContextState.summary ?? "",
      messages: messages.slice(summarizeFromIndex, summarizeUntilIndex),
    });

    return {
      summary,
      summarizedThroughMessageIndex: summarizeUntilIndex,
    };
  } catch {
    return normalizedContextState;
  }
}

function buildModelMessages(messages: AgentChatMessage[], contextState: AgentContextState): ModelMessage[] {
  const summarizedThroughMessageIndex = Math.min(contextState.summarizedThroughMessageIndex ?? 0, messages.length);
  const modelMessages: ModelMessage[] = [];
  let remainingTokens = maxHistoryInputTokens;

  if (contextState.summary) {
    const summaryMessage: ModelMessage = {
      role: "system",
      content: `Summary of earlier chat history:\n${contextState.summary}`,
    };

    modelMessages.push(summaryMessage);
    remainingTokens -= estimateModelMessageTokens(summaryMessage);
  } else if (summarizedThroughMessageIndex > 0) {
    const noticeMessage: ModelMessage = {
      role: "system",
      content: "Some earlier chat history was omitted because it exceeded the context budget.",
    };

    modelMessages.push(noticeMessage);
    remainingTokens -= estimateModelMessageTokens(noticeMessage);
  }

  const recentMessages = messages.slice(summarizedThroughMessageIndex);
  const selectedRecentMessages: AgentChatMessage[] = [];

  for (let index = recentMessages.length - 1; index >= 0; index -= 1) {
    const message = recentMessages[index];
    const messageTokens = estimateChatMessageTokens(message);

    if (selectedRecentMessages.length > 0 && remainingTokens - messageTokens < 0) {
      break;
    }

    selectedRecentMessages.unshift(message);
    remainingTokens -= messageTokens;
  }

  return [...modelMessages, ...selectedRecentMessages.map(toModelMessage)];
}

function compactSourceText(text: string, maxLength = 1200) {
  const normalizedText = text.replace(/\s+/g, " ").trim();
  if (normalizedText.length <= maxLength) return normalizedText;

  return `${normalizedText.slice(0, maxLength).trim()}...`;
}

function normalizeDocumentPath(documentPath: string) {
  return documentPath.trim().replace(/^\/+/, "").replace(/\.json$/i, "");
}

function documentFilePath(documentPath: string) {
  const normalizedPath = normalizeDocumentPath(documentPath);
  return normalizedPath ? `${normalizedPath}.json` : "";
}

function documentTitleFromPath(documentPath: string) {
  return normalizeDocumentPath(documentPath).split("/").at(-1) || "Untitled";
}

function documentNodeTitle(node: DocumentNode) {
  return node.type === "file" ? documentTitleFromPath(node.path) : node.name;
}

function findDocumentNode(nodes: DocumentNode[], documentPath: string): DocumentNode | null {
  const normalizedPath = normalizeDocumentPath(documentPath);

  for (const node of nodes) {
    if (normalizeDocumentPath(node.path) === normalizedPath) return node;
    if (node.children?.length) {
      const child = findDocumentNode(node.children, normalizedPath);
      if (child) return child;
    }
  }

  return null;
}

function flattenDocumentTree(nodes: DocumentNode[], folderPath = "") {
  const normalizedFolderPath = normalizeDocumentPath(folderPath);
  const rootNodes = normalizedFolderPath ? findDocumentNode(nodes, normalizedFolderPath)?.children ?? [] : nodes;
  const entries: Array<{ path: string; title: string; type: "file" | "folder" }> = [];

  function visit(node: DocumentNode) {
    entries.push({
      path: normalizeDocumentPath(node.path),
      title: documentNodeTitle(node),
      type: node.type,
    });

    node.children?.forEach(visit);
  }

  rootNodes.forEach(visit);
  return entries;
}

function extractTiptapText(node: unknown): string {
  if (!node || typeof node !== "object") return "";

  const candidate = node as {
    content?: unknown[];
    text?: unknown;
    type?: unknown;
  };

  if (typeof candidate.text === "string") return candidate.text;
  if (!Array.isArray(candidate.content)) return "";

  const childText = candidate.content.map(extractTiptapText).filter(Boolean).join(candidate.type === "paragraph" ? " " : "\n");
  return candidate.type === "doc" ? childText : childText.trim();
}

function summarizeGraph(graph: KnowledgeDocumentGraph) {
  return {
    documentPath: normalizeDocumentPath(graph.documentPath),
    conceptCount: graph.nodes.length,
    relationCount: graph.edges.length,
    concepts: graph.nodes.map((node) => ({
      id: node.id,
      inCurrentDocument: node.inCurrentDocument,
      name: node.name,
      noteCount: node.mentions.length,
      summary: node.summary,
      type: node.type,
    })),
    relations: graph.edges.map((edge) => ({
      id: edge.id,
      fromConceptId: edge.source,
      relation: edge.relation,
      toConceptId: edge.target,
      explanation: edge.explanation,
    })),
  };
}

function foregroundContextModelMessage(context: AgentForegroundContext): ModelMessage {
  return {
    role: "system",
    content: [
      "Foreground study context attached for this request only. Do not assume it remains visible in later turns.",
      `Context kind: ${context.kind}`,
      `Document: ${context.documentPath}`,
      JSON.stringify(context, null, 2),
    ].join("\n\n"),
  };
}

function noForegroundContextModelMessage(): ModelMessage {
  return {
    role: "system",
    content: "No foreground study context is attached for this request. Do not infer a visible concept, flashcard, or answer sheet from earlier turns.",
  };
}

function responseInstructionsModelMessage(instructions: string): ModelMessage {
  return {
    role: "system",
    content: [
      "User-defined response and note-writing instructions. Follow these unless they conflict with higher-priority instructions:",
      instructions,
    ].join("\n\n"),
  };
}

function createStudyTools({
  closeDocumentTab,
  ensureDocumentTools,
  getCurrentDocumentTools,
  getDocumentTools,
  getOpenDocumentPaths,
  onDocumentsChanged,
  registerSources,
}: {
  closeDocumentTab?: (documentPath: string, documentType?: DocumentNode["type"]) => void;
  ensureDocumentTools?: (documentPath: string) => Promise<CurrentDocumentAgentTools | null>;
  getCurrentDocumentTools: () => CurrentDocumentAgentTools | null;
  getDocumentTools?: (documentPath: string) => CurrentDocumentAgentTools | null;
  getOpenDocumentPaths?: () => string[];
  onDocumentsChanged?: () => void;
  registerSources: (results: DocumentSemanticSearchResult[]) => AgentSource[];
}) {
  function getTools() {
    return getCurrentDocumentTools();
  }

  function getToolsForPath(documentPath?: string) {
    if (!documentPath) return getTools();
    const normalizedPath = normalizeDocumentPath(documentPath);
    const currentTools = getTools();
    return (
      getDocumentTools?.(normalizedPath) ??
      (normalizeDocumentPath(currentTools?.path ?? "") === normalizedPath ? currentTools : null)
    );
  }

  function getMarkdownConverter() {
    const currentTools = getTools();
    if (currentTools) return currentTools;

    for (const documentPath of getOpenDocumentPaths?.() ?? []) {
      const tools = getDocumentTools?.(documentPath);
      if (tools) return tools;
    }

    return null;
  }

  async function getToolsForMutation(documentPath?: string) {
    const existingTools = getToolsForPath(documentPath);
    if (existingTools) return existingTools;
    if (!documentPath) return null;
    return ensureDocumentTools?.(normalizeDocumentPath(documentPath)) ?? null;
  }

  return [
    tool(
      async ({ limit = 6, query }) => {
        if (!window.learner?.semanticSearchDocuments) {
          return "Semantic note search is not available in this environment.";
        }

        try {
          const results = await window.learner.semanticSearchDocuments(
            query,
            Math.min(Math.max(limit, 1), 8),
            readAiSettings(),
          );
          const sources = registerSources(results);

          if (sources.length === 0) {
            const status = await window.learner.getDocumentEmbeddingStatus?.(readAiSettings());
            return [
              "No matching note sources were found.",
              status
                ? `Embedding status: ${status.embeddedChunks}/${status.chunks} chunks embedded. ${
                    status.lastError ? `Last error: ${status.lastError}` : ""
                  }`
                : "",
            ]
              .filter(Boolean)
              .join("\n");
          }

          return JSON.stringify(
            {
              type: "search_notes",
              query,
              instructions:
                "Use these note sources when answering. Cite claims from these sources with inline markers like <source 1>.",
              sources,
            },
            null,
            2,
          );
        } catch (error) {
          return error instanceof Error ? `Semantic note search failed: ${error.message}` : "Semantic note search failed.";
        }
      },
      {
        name: "search_notes",
        description:
          "Search the user's saved notes semantically. Use this when answering questions about study material, past notes, related concepts, or anything that should be grounded in the user's note library. Cite retrieved sources with <source N> markers.",
        schema: z.object({
          query: z.string().min(1).describe("Search query for the user's notes."),
          limit: z.number().min(1).max(8).optional().describe("Maximum number of source chunks to retrieve."),
        }),
      },
    ),
    tool(
      async ({ folderPath = "" }) => {
        if (!window.learner?.listDocuments) {
          return "Document listing is not available in this environment.";
        }

        const documents = await window.learner.listDocuments();
        const entries = flattenDocumentTree(documents.tree, folderPath);
        return JSON.stringify(
          {
            type: "list_notes",
            folderPath: normalizeDocumentPath(folderPath),
            openDocuments: getOpenDocumentPaths?.() ?? [],
            entries,
          },
          null,
          2,
        );
      },
      {
        name: "list_notes",
        description:
          "List notes and folders from the library root or a folder. Use this before reading or editing notes when the user refers to files broadly.",
        schema: z.object({
          folderPath: z.string().optional().describe("Folder path to list. Omit or use empty string for the root."),
        }),
      },
    ),
    tool(
      async ({ documentPath }) => {
        const normalizedPath = normalizeDocumentPath(documentPath);
        const tools = await ensureDocumentTools?.(normalizedPath);

        return JSON.stringify(
          {
            type: "open_note_tab",
            path: normalizedPath,
            opened: Boolean(tools),
            editableAsMarkdown: Boolean(tools),
            message: tools
              ? "Opened the note in a background tab."
              : "The note was added to open tabs, but the editor did not become ready before the timeout.",
          },
          null,
          2,
        );
      },
      {
        name: "open_note_tab",
        description:
          "Open a note in a background tab without switching the active tab when the user explicitly asks to open it. Do not use this to prepare create, patch, or replacement operations; those tools open their own target tabs.",
        schema: z.object({
          documentPath: z.string().min(1).describe("Note path, without needing the .json extension."),
        }),
      },
    ),
    tool(
      async ({ documentPath }) => {
        const normalizedPath = normalizeDocumentPath(documentPath);
        const openTools = getToolsForPath(normalizedPath);

        if (openTools) {
          return JSON.stringify(
            {
              type: "read_note",
              editableAsMarkdown: true,
              note: openTools.read(),
            },
            null,
            2,
          );
        }

        if (!window.learner?.readDocument) {
          return "Document reading is not available in this environment.";
        }

        let filePath = documentFilePath(normalizedPath);
        if (window.learner.listDocuments) {
          const documents = await window.learner.listDocuments();
          const node = findDocumentNode(documents.tree, normalizedPath);

          if (!node) {
            return JSON.stringify(
              {
                type: "read_note",
                path: normalizedPath,
                error: "No note exists at this path. Use list_notes to find the exact note path.",
              },
              null,
              2,
            );
          }

          if (node.type !== "file") {
            return JSON.stringify(
              {
                type: "read_note",
                path: normalizedPath,
                error: "This path is a folder, not a note. Use list_notes with this folder path to inspect its contents.",
                entries: flattenDocumentTree(documents.tree, normalizedPath),
              },
              null,
              2,
            );
          }

          filePath = node.path;
        }

        const document = await window.learner.readDocument(filePath);
        return JSON.stringify(
          {
            type: "read_note",
            editableAsMarkdown: false,
            message:
              "This note is not open in an editor tab, so only extracted plain text is available. Open it before applying Markdown patches.",
            path: normalizedPath,
            title: documentTitleFromPath(normalizedPath),
            text: extractTiptapText(document),
          },
          null,
          2,
        );
      },
      {
        name: "read_note",
        description:
          "Read any saved note. Open notes return Markdown and are editable by patch tools; closed notes return extracted plain text only.",
        schema: z.object({
          documentPath: z.string().min(1).describe("Note path, without needing the .json extension."),
        }),
      },
    ),
    tool(
      async ({ documentPath, markdown }) => {
        if (!window.learner?.createDocumentFile) {
          return "Document creation is not available in this environment.";
        }

        const normalizedPath = normalizeDocumentPath(documentPath);
        await window.learner.createDocumentFile(normalizedPath);
        onDocumentsChanged?.();
        const createdTools = await ensureDocumentTools?.(normalizedPath);

        let wroteMarkdown = false;
        if (markdown?.trim()) {
          if (!createdTools) {
            const converter = getMarkdownConverter();
            if (converter && window.learner.saveDocument) {
              await window.learner.saveDocument(documentFilePath(normalizedPath), converter.markdownToDocument(markdown));
              wroteMarkdown = true;
            }

            return JSON.stringify(
              {
                type: "create_note",
                path: normalizedPath,
                message: wroteMarkdown
                  ? "Created the note and wrote the Markdown body."
                  : "Created the note, but its background editor did not become ready before the timeout.",
                wroteMarkdown,
              },
              null,
              2,
            );
          }

          const currentDocument = createdTools.read();
          const patch: ProposedDocumentPatch = {
            id: `replace_${Date.now()}_${crypto.randomUUID()}`,
            documentPath: createdTools.path,
            baseHash: currentDocument.patchBaseHash,
            summary: `Write ${documentTitleFromPath(normalizedPath)}`,
            changeType: "replace",
            replacementMarkdown: markdown,
            status: "pending",
            createdAt: Date.now(),
          };

          return JSON.stringify(
            {
              type: "create_note",
              path: normalizedPath,
              wroteMarkdown: false,
              message:
                "Created the note and prepared its Markdown body. The app will apply it automatically; undo remains available.",
              patch,
            },
            null,
            2,
          );
        }

        return JSON.stringify(
          {
            type: "create_note",
            path: normalizedPath,
            wroteMarkdown,
            message: wroteMarkdown ? "Created the note and wrote the Markdown body." : "Created the note.",
          },
          null,
          2,
        );
      },
      {
        name: "create_note",
        description:
          "Create a new note. When the user requests content, include the complete Markdown body in this same call. The tool opens the new note in a background tab and applies the body automatically; do not call open_note_tab or a replacement tool afterward.",
        schema: z.object({
          documentPath: z.string().min(1).describe("New note path without .json, such as Folder/New Note."),
          markdown: z.string().optional().describe("Optional complete Markdown body for the new note."),
        }),
      },
    ),
    tool(
      async ({ documentPath }) => {
        if (!window.learner?.deleteDocumentEntry) {
          return "Document deletion is not available in this environment.";
        }

        const normalizedPath = normalizeDocumentPath(documentPath);
        let deletePath = documentFilePath(normalizedPath);
        let documentType: DocumentNode["type"] = "file";
        if (window.learner.listDocuments) {
          const documents = await window.learner.listDocuments();
          const node = findDocumentNode(documents.tree, normalizedPath);

          if (!node) {
            return JSON.stringify(
              {
                type: "delete_note",
                path: normalizedPath,
                error: "No note or folder exists at this path. Use list_notes to find the exact path before deleting.",
              },
              null,
              2,
            );
          }

          documentType = node?.type ?? "file";
          deletePath = node?.path ?? deletePath;
        }

        await window.learner.deleteDocumentEntry(deletePath);
        closeDocumentTab?.(normalizedPath, documentType);
        if (!closeDocumentTab) onDocumentsChanged?.();

        return JSON.stringify(
          {
            type: "delete_note",
            path: normalizedPath,
            documentType,
            message: "Deleted the note and closed its tab if it was open.",
          },
          null,
          2,
        );
      },
      {
        name: "delete_note",
        description:
          "Delete a note or folder. This does not open the note first; if the note is open, its tab is closed after deletion.",
        schema: z.object({
          documentPath: z.string().min(1).describe("Note or folder path, without needing the .json extension."),
        }),
      },
    ),
    tool(
      async ({ documentPath, patchText, summary }) => {
        const documentTools = await getToolsForMutation(documentPath);
        if (!documentTools) return `Could not open ${documentPath} in a background tab before applying a Markdown patch.`;
        const currentDocument = documentTools.read();

        const patch: ProposedDocumentPatch = {
          id: `patch_${Date.now()}_${crypto.randomUUID()}`,
          documentPath: documentTools.path,
          baseHash: currentDocument.patchBaseHash,
          summary,
          changeType: "patch",
          patchText,
          status: "pending",
          createdAt: Date.now(),
        };

        return JSON.stringify(
          {
            type: "proposed_document_patch",
            message: "Patch proposed. The app will apply it automatically when the tool returns; undo remains available.",
            patch,
          },
          null,
          2,
        );
      },
      {
        name: "propose_note_patch",
        description:
          "Propose an apply_patch-style Markdown patch for a note. If the note is not open, it is opened in a background tab first. The UI auto-applies it and keeps undo. Use read_note first and patch the note's patchableMarkdown exactly when available.",
        schema: z.object({
          documentPath: z.string().min(1).describe("Note path to patch."),
          summary: z.string().min(1).describe("Short human-readable summary of the proposed edit."),
          patchText: z.string().min(1).describe("Patch text using the Learner document patch format."),
        }),
      },
    ),
    tool(
      async ({ documentPath, markdown, summary }) => {
        const documentTools = await getToolsForMutation(documentPath);
        if (!documentTools) return `Could not open ${documentPath} in a background tab before replacing its body.`;
        const currentDocument = documentTools.read();

        const patch: ProposedDocumentPatch = {
          id: `replace_${Date.now()}_${crypto.randomUUID()}`,
          documentPath: documentTools.path,
          baseHash: currentDocument.patchBaseHash,
          summary,
          changeType: "replace",
          replacementMarkdown: markdown,
          status: "pending",
          createdAt: Date.now(),
        };

        return JSON.stringify(
          {
            type: "proposed_document_replacement",
            message: "Replacement proposed. The app will apply it automatically when the tool returns; undo remains available.",
            patch,
          },
          null,
          2,
        );
      },
      {
        name: "propose_note_replacement",
        description:
          "Propose a full Markdown replacement for a note. If the note is not open, it is opened in a background tab first. Use this for large rewrites or generated study notes. The UI auto-applies it and keeps undo.",
        schema: z.object({
          documentPath: z.string().min(1).describe("Note path to replace."),
          summary: z.string().min(1).describe("Short human-readable summary of the replacement."),
          markdown: z.string().min(1).describe("Complete Markdown body for the note."),
        }),
      },
    ),
    tool(
      async ({ documentPath }) => {
        const normalizedPath = normalizeDocumentPath(documentPath ?? getTools()?.path ?? "");
        if (!normalizedPath) return "No document path was provided and no document is currently open.";
        if (!window.learner?.getDocumentGraph) return "Knowledge graph APIs are not available.";

        const graph = await window.learner.getDocumentGraph(normalizedPath);
        return JSON.stringify(
          {
            type: "list_note_graph",
            graph: summarizeGraph(graph),
          },
          null,
          2,
        );
      },
      {
        name: "list_note_graph",
        description: "List concepts and connections associated with a note's knowledge graph.",
        schema: z.object({
          documentPath: z.string().optional().describe("Note path. Omit for the current open note."),
        }),
      },
    ),
    tool(
      async ({ documentPath }) => {
        const documentTools = await getToolsForMutation(documentPath);
        if (!documentTools) {
          return `Could not open ${documentPath ?? "the target note"} in a background tab before extracting its graph.`;
        }
        if (!window.learner?.extractDocumentGraph) return "Knowledge graph extraction is not available.";

        const snapshot = documentTools.read();
        if (!snapshot.markdown.trim()) return "The note is empty, so there is no graph to extract.";

        const result = await window.learner.extractDocumentGraph(snapshot.path, snapshot.markdown, readAiSettings());
        return JSON.stringify(
          {
            type: "extract_note_graph",
            extracted: result.extracted,
            graph: summarizeGraph(result.graph),
          },
          null,
          2,
        );
      },
      {
        name: "extract_note_graph",
        description:
          "Extract or refresh the knowledge graph for a note. If the note is not open, it is opened in a background tab first. Use this before graph CRUD if a note has no graph yet.",
        schema: z.object({
          documentPath: z.string().optional().describe("Note path. Omit for the current open note."),
        }),
      },
    ),
    tool(
      async ({ limit = 8, query }) => {
        if (!window.learner?.searchGraphConcepts) return "Knowledge graph concept search is not available.";
        const concepts = await window.learner.searchGraphConcepts(query, Math.min(Math.max(limit, 1), 20));
        return JSON.stringify(
          {
            type: "search_graph_concepts",
            concepts,
          },
          null,
          2,
        );
      },
      {
        name: "search_graph_concepts",
        description: "Search existing knowledge graph concepts by name, alias, type, summary, or explanation.",
        schema: z.object({
          query: z.string().min(1).describe("Concept search query."),
          limit: z.number().min(1).max(20).optional(),
        }),
      },
    ),
    tool(
      async ({ aliases = [], limit = 8, name, summary = "", type = "" }) => {
        if (!window.learner?.searchRelatedGraphConcepts) {
          return "Related concept vector search is not available.";
        }

        const concepts = await window.learner.searchRelatedGraphConcepts(
          { aliases, name, summary, type },
          Math.min(Math.max(limit, 1), 12),
          readAiSettings(),
        );
        return JSON.stringify(
          {
            type: "search_related_graph_concepts",
            concepts,
          },
          null,
          2,
        );
      },
      {
        name: "search_related_graph_concepts",
        description:
          "Find semantically similar existing graph concepts using the same concept-summary embedding search used during graph extraction. Use this before creating a possibly duplicate concept.",
        schema: z.object({
          name: z.string().min(1).describe("Proposed or target concept name."),
          summary: z.string().optional().describe("Optional concept summary for semantic matching."),
          type: z.string().optional().describe("Optional concept type/category."),
          aliases: z.array(z.string()).optional().describe("Optional aliases for exact/alias matching."),
          limit: z.number().min(1).max(12).optional(),
        }),
      },
    ),
    tool(
      async ({
        conceptId,
        conceptName,
        contribution,
        documentPath,
        excerptMarkdown,
        explanation,
        mentionType = "application",
        sectionTitle,
        summary,
        type,
      }) => {
        const normalizedPath = normalizeDocumentPath(documentPath ?? getTools()?.path ?? "");
        if (!normalizedPath) return "No document path was provided and no document is currently open.";
        if (!window.learner?.addGraphConceptMention) return "Knowledge graph concept editing is not available.";

        const graph = await window.learner.addGraphConceptMention(normalizedPath, {
          conceptId,
          concept: conceptName
            ? {
                name: conceptName,
                explanation,
                summary,
                type,
              }
            : undefined,
          contribution,
          excerptMarkdown,
          mentionType,
          sectionTitle,
        });

        return JSON.stringify(
          {
            type: "add_graph_concept_to_note",
            graph: summarizeGraph(graph),
          },
          null,
          2,
        );
      },
      {
        name: "add_graph_concept_to_note",
        description:
          "Attach a note to an existing graph concept or create a new concept attached to that note. Use this for manual graph updates.",
        schema: z.object({
          documentPath: z.string().optional().describe("Note path. Omit for the current open note."),
          conceptId: z.number().int().optional().describe("Existing concept id. Omit when creating a new concept."),
          conceptName: z.string().optional().describe("New concept name when conceptId is omitted."),
          type: z.string().optional(),
          summary: z.string().optional(),
          explanation: z.string().optional(),
          sectionTitle: z.string().optional(),
          mentionType: z.string().optional(),
          contribution: z.string().optional().describe("Study details explaining what this note teaches about the concept."),
          excerptMarkdown: z.string().min(1).describe("Relevant Markdown excerpt from the note."),
        }),
      },
    ),
    tool(
      async ({ conceptId, documentPath, explanation, name, summary, type }) => {
        const normalizedPath = normalizeDocumentPath(documentPath ?? getTools()?.path ?? "");
        if (!normalizedPath) return "No document path was provided and no document is currently open.";
        if (!window.learner?.updateGraphConcept) return "Knowledge graph concept editing is not available.";

        const graph = await window.learner.updateGraphConcept(normalizedPath, {
          conceptId,
          explanation,
          name,
          summary,
          type,
        });
        return JSON.stringify(
          {
            type: "update_graph_concept",
            graph: summarizeGraph(graph),
          },
          null,
          2,
        );
      },
      {
        name: "update_graph_concept",
        description: "Rename or edit a graph concept's type, summary, or explanation.",
        schema: z.object({
          documentPath: z.string().optional().describe("Note path used to refresh the displayed graph."),
          conceptId: z.number().int(),
          name: z.string().min(1),
          type: z.string().optional(),
          summary: z.string().optional(),
          explanation: z.string().optional(),
        }),
      },
    ),
    tool(
      async ({ conceptId, documentPath }) => {
        const normalizedPath = normalizeDocumentPath(documentPath ?? getTools()?.path ?? "");
        if (!normalizedPath) return "No document path was provided and no document is currently open.";
        if (!window.learner?.deleteGraphConceptFromDocument) return "Knowledge graph concept deletion is not available.";

        const graph = await window.learner.deleteGraphConceptFromDocument(normalizedPath, conceptId);
        return JSON.stringify(
          {
            type: "remove_graph_concept_from_note",
            graph: summarizeGraph(graph),
          },
          null,
          2,
        );
      },
      {
        name: "remove_graph_concept_from_note",
        description:
          "Remove a concept mention from a specific note and remove relation evidence introduced by that note for relations touching the concept.",
        schema: z.object({
          documentPath: z.string().optional().describe("Note path. Omit for the current open note."),
          conceptId: z.number().int(),
        }),
      },
    ),
    tool(
      async ({ documentPath, evidenceMarkdown, explanation, fromConceptId, relation, targetConceptName, targetExplanation, targetSummary, targetType, toConceptId }) => {
        const normalizedPath = normalizeDocumentPath(documentPath ?? getTools()?.path ?? "");
        if (!normalizedPath) return "No document path was provided and no document is currently open.";
        if (!window.learner?.addGraphRelation) return "Knowledge graph relation editing is not available.";

        const graph = await window.learner.addGraphRelation(normalizedPath, {
          evidenceMarkdown,
          explanation,
          fromConceptId,
          relation,
          targetConcept: targetConceptName
            ? {
                name: targetConceptName,
                explanation: targetExplanation,
                summary: targetSummary,
                type: targetType,
              }
            : undefined,
          toConceptId,
        });

        return JSON.stringify(
          {
            type: "add_graph_connection",
            graph: summarizeGraph(graph),
          },
          null,
          2,
        );
      },
      {
        name: "add_graph_connection",
        description:
          "Add a directed graph connection from one concept to an existing or new target concept for a note.",
        schema: z.object({
          documentPath: z.string().optional().describe("Note path. Omit for the current open note."),
          fromConceptId: z.number().int(),
          toConceptId: z.number().int().optional().describe("Existing target concept id."),
          targetConceptName: z.string().optional().describe("New target concept name when toConceptId is omitted."),
          targetType: z.string().optional(),
          targetSummary: z.string().optional(),
          targetExplanation: z.string().optional(),
          relation: z.string().min(1).describe("Human-readable predicate such as uses, enables, contrasts with."),
          explanation: z.string().optional().describe("Why this connection matters for study."),
          evidenceMarkdown: z.string().optional().describe("Relevant Markdown evidence from the note."),
        }),
      },
    ),
    tool(
      async ({ documentPath, explanation, relation, relationId }) => {
        const normalizedPath = normalizeDocumentPath(documentPath ?? getTools()?.path ?? "");
        if (!normalizedPath) return "No document path was provided and no document is currently open.";
        if (!window.learner?.updateGraphRelation) return "Knowledge graph relation editing is not available.";

        const graph = await window.learner.updateGraphRelation(normalizedPath, {
          explanation,
          relation,
          relationId,
        });
        return JSON.stringify(
          {
            type: "update_graph_connection",
            graph: summarizeGraph(graph),
          },
          null,
          2,
        );
      },
      {
        name: "update_graph_connection",
        description: "Edit a graph connection label or explanation.",
        schema: z.object({
          documentPath: z.string().optional().describe("Note path used to refresh the displayed graph."),
          relationId: z.number().int(),
          relation: z.string().min(1),
          explanation: z.string().optional(),
        }),
      },
    ),
    tool(
      async () => {
        const documentTools = getTools();
        if (!documentTools) return "No document is currently open.";

        return JSON.stringify(documentTools.read(), null, 2);
      },
      {
        name: "read_current_document",
        description:
          "Read the currently open note, including Markdown, HTML, and plain text forms. Use this before editing if the user asks you to improve, continue, summarize, or modify the note.",
        schema: z.object({}),
      },
    ),
    tool(
      async ({ documentPath }) => {
        const normalizedPath = normalizeDocumentPath(documentPath ?? getTools()?.path ?? "");
        if (!normalizedPath) return "No document path was provided and no document is currently open.";
        if (!window.learner?.getDocumentMastery || !window.learner?.getDocumentMasteryCards) {
          return "Mastery reading is not available in this environment.";
        }
        const openTools = getToolsForPath(normalizedPath);
        const markdown = openTools?.read().markdown ?? "";
        const [mastery, cards] = await Promise.all([
          window.learner.getDocumentMastery(normalizedPath, markdown),
                    window.learner.getDocumentMastery(
                      normalizedPath,
                      markdown,
                      { checkFreshness: Boolean(openTools) },
                    ),
          window.learner.getDocumentMasteryCards(normalizedPath),
        ]);
        return JSON.stringify({ type: "mastery_state", mastery, cards }, null, 2);
      },
      {
        name: "read_mastery_state",
        description:
          "Read a note's mastery concepts, metaphor, stage schedule, flashcards, weaknesses, attempts, and card status. This tool is read-only.",
        schema: z.object({
          documentPath: z.string().optional().describe("Note path. Omit for the current open note."),
        }),
      },
    ),
    tool(
      async ({ cardId, conceptId, documentPath }) => {
        const normalizedPath = normalizeDocumentPath(documentPath ?? getTools()?.path ?? "");
        if (!normalizedPath) return "No document path was provided and no document is currently open.";
        if (!window.learner?.listMasteryPracticeSessions || !window.learner?.listMasteryPracticeEvidence) {
          return "Mastery history reading is not available in this environment.";
        }
        const sessions = await window.learner.listMasteryPracticeSessions(normalizedPath);
        const evidence = cardId || conceptId
          ? await window.learner.listMasteryPracticeEvidence({
              cardId,
              conceptId,
              documentPath: normalizedPath,
            })
          : [];
        return JSON.stringify({ type: "mastery_history", documentPath: normalizedPath, sessions, evidence }, null, 2);
      },
      {
        name: "read_mastery_history",
        description:
          "Read saved flashcard completion history and session summaries. When conceptId or cardId is provided, also return matching answers, feedback, scores, and outcomes. Use read_mastery_answer_sheet for every answer in a session. This tool is read-only.",
        schema: z.object({
          documentPath: z.string().optional().describe("Note path. Omit for the current open note."),
          conceptId: z.number().int().optional().describe("Optional mastery concept id."),
          cardId: z.number().int().optional().describe("Optional flashcard id."),
        }),
      },
    ),
    tool(
      async ({ sessionId }) => {
        if (!window.learner?.getMasteryPracticeSession) {
          return "Mastery answer-sheet reading is not available in this environment.";
        }
        const session = await window.learner.getMasteryPracticeSession(
          sessionId,
          readAiSettings(),
          { runGrading: false },
        );
        return JSON.stringify({ type: "mastery_answer_sheet", session }, null, 2);
      },
      {
        name: "read_mastery_answer_sheet",
        description:
          "Read an entire practice or revision answer sheet by session id, including every prompt, learner answer, grading feedback, score, linked concepts, and weaknesses. This tool is read-only.",
        schema: z.object({
          sessionId: z.number().int().positive().describe("Practice or revision session id from read_mastery_history."),
        }),
      },
    ),
    tool(
      async ({ days = 35 }) => {
        if (!window.learner?.getMasteryRevisionOverview) {
          return "Revision schedule reading is not available in this environment.";
        }
        const overview = await window.learner.getMasteryRevisionOverview({
          days: Math.min(Math.max(days, 7), 90),
          masterySettings: readMasterySettings(),
          prepare: false,
          settings: readAiSettings(),
        });
        return JSON.stringify({ type: "revision_schedule", overview }, null, 2);
      },
      {
        name: "read_revision_schedule",
        description:
          "Read the learner's revision schedule, due concepts grouped by note, overdue counts, future calendar, and card preparation status. This tool is read-only.",
        schema: z.object({
          days: z.number().int().min(7).max(90).optional().describe("Calendar days to include. Defaults to 35."),
        }),
      },
    ),
    tool(
      async ({ documentPath, prompt, targetProficiency }) => {
        const normalizedPath = normalizeDocumentPath(documentPath ?? getTools()?.path ?? "");
        if (!normalizedPath) return "No document path was provided and no document is currently open.";
        if (!window.learner?.generateDocumentMasteryCards || !window.learner?.getDocumentMasteryCards) {
          return "Mastery card generation is not available in this environment.";
        }
        const openTools = await getToolsForMutation(normalizedPath);
        if (!openTools) return `Open ${normalizedPath} before generating mastery cards.`;
        const markdown = openTools.read().markdown;
        const current = await window.learner.getDocumentMasteryCards(normalizedPath);
        const currentCardIds = new Set(current.cards.map((card) => card.id));
        const state = await window.learner.generateDocumentMasteryCards({
          documentPath: normalizedPath,
          generationPrompt: prompt,
          markdown,
          masterySettings: readMasterySettings(),
          settings: readAiSettings(),
          targetProficiency: targetProficiency ?? current.preferences.targetProficiency,
        });
        window.dispatchEvent(new CustomEvent("learner:mastery-cards-changed", {
          detail: { documentPath: normalizedPath },
        }));
        return JSON.stringify({
          type: "generated_mastery_cards",
          documentPath: normalizedPath,
          message: `Generated ${state.cards.filter((card) => !currentCardIds.has(card.id)).length} new mastery cards using the dedicated card generator.`,
          cards: state.cards.filter((card) => !currentCardIds.has(card.id)),
        }, null, 2);
      },
      {
        name: "generate_mastery_cards",
        description:
          "Generate additional mastery flashcards for a note with a custom user-requested prompt. This is the only mastery write tool. It reuses Learner's dedicated graph-aware card generator and validation framework.",
        schema: z.object({
          documentPath: z.string().optional().describe("Note path. Omit for the current open note."),
          prompt: z.string().min(1).describe("Specific custom request, such as a card about a particular problem or misconception."),
          targetProficiency: z.enum(["familiar", "developing", "proficient", "advanced", "mastered"]).optional(),
        }),
      },
    ),
    tool(
      async ({ patchText, summary }) => {
        const documentTools = getTools();
        if (!documentTools) return "No document is currently open.";
        const currentDocument = documentTools.read();

        const patch: ProposedDocumentPatch = {
          id: `patch_${Date.now()}_${crypto.randomUUID()}`,
          documentPath: documentTools.path,
          baseHash: currentDocument.patchBaseHash,
          summary,
          changeType: "patch",
          patchText,
          status: "pending",
          createdAt: Date.now(),
        };

        return JSON.stringify(
          {
            type: "proposed_document_patch",
            message: "Patch proposed. The app will apply it automatically when the tool returns; undo remains available.",
            patch,
          },
          null,
          2,
        );
      },
      {
        name: "propose_current_document_patch",
        description:
          "Propose an apply_patch-style Markdown patch for the currently open note's patchableMarkdown. The UI auto-applies it and keeps undo.",
        schema: z.object({
          summary: z.string().min(1).describe("Short human-readable summary of the proposed edit."),
          patchText: z.string().min(1).describe("Patch text using the Learner document patch format."),
        }),
      },
    ),
    tool(
      async ({ markdown, summary }) => {
        const documentTools = getTools();
        if (!documentTools) return "No document is currently open.";
        const currentDocument = documentTools.read();

        const patch: ProposedDocumentPatch = {
          id: `replace_${Date.now()}_${crypto.randomUUID()}`,
          documentPath: documentTools.path,
          baseHash: currentDocument.patchBaseHash,
          summary,
          changeType: "replace",
          replacementMarkdown: markdown,
          status: "pending",
          createdAt: Date.now(),
        };

        return JSON.stringify(
          {
            type: "proposed_document_replacement",
            message: "Full-document replacement proposed. The app will apply it automatically when the tool returns; undo remains available.",
            patch,
          },
          null,
          2,
        );
      },
      {
        name: "propose_current_document_replacement",
        description:
          "Propose a full Markdown replacement for the currently active note. Use this only when the intended target is already the active document. The UI auto-applies it and keeps undo.",
        schema: z.object({
          summary: z.string().min(1).describe("Short human-readable summary of the replacement."),
          markdown: z
            .string()
            .min(1)
            .describe("Complete Markdown body that should replace the current note after user approval."),
        }),
      },
    ),
  ];
}

function registerRetrievedSources(retrievedSources: AgentSource[], results: DocumentSemanticSearchResult[]) {
  return results.map((result) => {
    const existingSource = retrievedSources.find(
      (source) => source.path === result.path && source.chunkIndex === result.chunkIndex,
    );

    if (existingSource) return existingSource;

    const source = {
      chunkIndex: result.chunkIndex,
      excerpt: compactSourceText(result.text),
      id: retrievedSources.length + 1,
      path: result.path,
      score: result.score,
      title: result.title,
    };

    retrievedSources.push(source);
    return source;
  });
}

function createStudyAgent({
  closeDocumentTab,
  ensureDocumentTools,
  getCurrentDocumentTools,
  getDocumentTools,
  getOpenDocumentPaths,
  onDocumentsChanged,
  registerSources,
}: {
  closeDocumentTab?: (documentPath: string, documentType?: DocumentNode["type"]) => void;
  ensureDocumentTools?: (documentPath: string) => Promise<CurrentDocumentAgentTools | null>;
  getCurrentDocumentTools: () => CurrentDocumentAgentTools | null;
  getDocumentTools?: (documentPath: string) => CurrentDocumentAgentTools | null;
  getOpenDocumentPaths?: () => string[];
  onDocumentsChanged?: () => void;
  registerSources: (results: DocumentSemanticSearchResult[]) => AgentSource[];
}) {
  return createAgent({
    model: createLearnerModel(),
    tools: createStudyTools({
      closeDocumentTab,
      ensureDocumentTools,
      getCurrentDocumentTools,
      getDocumentTools,
      getOpenDocumentPaths,
      onDocumentsChanged,
      registerSources,
    }),
    systemPrompt: [
      "You are the built-in AI study assistant for Learner, a local note-taking app.",
      "Help the user write, improve, summarize, and study their notes.",
      "When the user asks about saved notes, study material, related concepts, or asks a question that should be grounded in their note library, use search_notes before answering.",
      "When you use search_notes, cite sourced claims inline with the exact marker format <source N>, where N is the source number returned by the tool.",
      "If note search returns no useful source, say that the answer is not grounded in saved notes before giving a general answer.",
      "When editing notes, use patch/replacement tools. The app auto-applies accepted tool patches and keeps undo available.",
      "Reading closed notes does not open them; read_note returns extracted plain text for closed notes.",
      "Create, update, replacement, and graph extraction tools may open the target note in a background tab so editor-backed Markdown tools are available.",
      "Deletion does not need to open a note. If a deleted note is already open, its tab is closed.",
      "Use list_notes and read_note when the user asks you to inspect or edit multiple notes.",
      "Use open_note_tab only when the user explicitly asks to open a note. Do not use it to prepare create, patch, replacement, or graph operations; those tools open their own target tabs.",
      "When creating a new note with content, call create_note once with both documentPath and the complete markdown body. Do not follow it with open_note_tab or a replacement tool.",
      "For an existing note identified by path, use propose_note_patch or propose_note_replacement; these tools automatically open a closed target in a background tab. Use propose_current_document_patch or propose_current_document_replacement only when the intended target is already active.",
      "Use graph tools to inspect and modify knowledge graph concepts and connections. Search existing graph concepts before creating likely duplicates.",
      "Use read_mastery_state to inspect concepts, flashcards, weaknesses, attempts, and stage scheduling. Use read_mastery_history for completion history and read_mastery_answer_sheet for a complete saved answer/feedback session. These mastery tools are read-only.",
      "Use read_revision_schedule when the user asks what is due, overdue, planned, or scheduled for future review.",
      "Foreground study context, when present, is attached as a system message for the current request only. Treat it as what the user is currently viewing, and do not assume it remains visible in later turns unless it is attached again.",
      "Only use generate_mastery_cards when the user explicitly asks to create flashcards. It is the only mastery write tool and routes through Learner's dedicated card-generation framework.",
      "Before modifying existing note content, read the current document unless the user only asks to insert new content.",
      "For replacing the whole active note, broad rewrites, long outlines, study guides, math-heavy content, Mermaid diagrams, or code-heavy generated content, use propose_current_document_replacement and write the replacement body in Markdown.",
      "Replacement Markdown should be the complete final document body, not a diff. Do not wrap it in a markdown code fence.",
      "For math in replacement Markdown, prefer inline $...$ and display $$...$$ delimiters. ChatGPT-style \\(...\\) and \\[...\\] are also accepted.",
      "When writing Mermaid diagrams in Markdown, use fenced code blocks like ```mermaid and keep syntax simple and valid. For flowchart node labels, quote labels with brackets like A[\"Type https://example.com\"]. For flowchart edge labels, use -->|Yes| without quotes inside the pipes. For sequenceDiagram, keep each arrow message on one line; do not put message continuations on the next line.",
      "For small targeted edits, use propose_current_document_patch.",
      "Patch the current document's patchableMarkdown exactly, not the plain text or HTML fields.",
      "Patch text must be Markdown lines. Do not output HTML tags in patchText.",
      "Use this exact patch format:",
      "*** Begin Patch",
      "*** Update Document: <current document path>",
      "@@",
      " context line copied exactly from patchableMarkdown",
      "-old Markdown line copied exactly from patchableMarkdown",
      "+new Markdown line",
      "*** End Patch",
      "Patch hunks must include enough exact context lines from patchableMarkdown to match one location.",
      "Do not invent line numbers. Do not use markdown fences around patchText.",
      "Prefer small targeted patches over broad rewrites.",
      "Do not mention implementation details like Tiptap JSON unless the user asks.",
      "After proposing a patch, tell the user what changed and mention that undo is available.",
    ].join("\n"),
  });
}

export async function* runStudyAgentLoop({
  messages,
  contextState: currentContextState = {},
  closeDocumentTab,
  ensureDocumentTools,
  foregroundContext,
  getCurrentDocumentTools,
  getDocumentTools,
  getOpenDocumentPaths,
  onDocumentsChanged,
  responseInstructions,
  signal,
}: RunStudyAgentRequest): AsyncGenerator<AgentLoopChunk> {
  const nextContextState = await compactContextIfNeeded(messages, currentContextState);
  const retrievedSources: AgentSource[] = [];

  function registerSources(results: DocumentSemanticSearchResult[]) {
    return registerRetrievedSources(retrievedSources, results);
  }

  const agent = createStudyAgent({
    closeDocumentTab,
    ensureDocumentTools,
    getCurrentDocumentTools,
    getDocumentTools,
    getOpenDocumentPaths,
    onDocumentsChanged,
    registerSources,
  });

  const modelMessages = buildModelMessages(messages, nextContextState);
  modelMessages.splice(
    Math.max(0, modelMessages.length - 1),
    0,
    foregroundContext
      ? foregroundContextModelMessage(foregroundContext)
      : noForegroundContextModelMessage(),
  );
  const cleanResponseInstructions = String(responseInstructions || "").trim();
  if (cleanResponseInstructions) {
    modelMessages.splice(
      Math.max(0, modelMessages.length - 1),
      0,
      responseInstructionsModelMessage(cleanResponseInstructions),
    );
  }

  const run = await agent.streamEvents({
    messages: modelMessages,
  }, {
    recursionLimit: 125,
    signal,
    version: "v3",
  });

  const pendingChunks: AgentLoopChunk[] = [];
  let notifyChunkAvailable: (() => void) | null = null;
  let finished = false;
  let failure: unknown;

  function pushChunk(chunk: AgentLoopChunk) {
    pendingChunks.push(chunk);
    notifyChunkAvailable?.();
    notifyChunkAvailable = null;
  }

  async function consumeMessageStreams() {
    for await (const message of run.messages) {
      let emittedText = false;

      for await (const delta of message.text) {
        if (!delta) continue;
        emittedText = true;
        pushChunk({
          type: "text_delta",
          content: delta,
        });
      }

      if (emittedText) {
        pushChunk({
          type: "text_done",
        });
      }
    }
  }

  async function consumeToolStreams() {
    for await (const call of run.toolCalls) {
      pushChunk({
        type: "tool_call",
        toolCall: {
          id: call.callId,
          name: call.name,
          args: call.input,
        },
      });

      const result = await call.output;

      pushChunk({
        type: "tool_result",
        toolCallId: call.callId,
        toolName: call.name,
        result,
      });
    }
  }

  Promise.all([consumeMessageStreams(), consumeToolStreams(), run.output])
    .then(() => {
      pushChunk({
        type: "done",
        contextState: nextContextState,
      });
    })
    .catch((error) => {
      failure = error;
    })
    .finally(() => {
      finished = true;
      notifyChunkAvailable?.();
      notifyChunkAvailable = null;
    });

  while (!finished || pendingChunks.length > 0) {
    if (pendingChunks.length === 0) {
      await new Promise<void>((resolve) => {
        notifyChunkAvailable = resolve;
      });
      continue;
    }

    const nextChunk = pendingChunks.shift();
    if (nextChunk) {
      yield nextChunk;
    }
  }

  if (failure) {
    throw failure;
  }
}

export async function runStudyAgent(request: RunStudyAgentRequest) {
  let content = "";
  let contextState = request.contextState ?? {};

  for await (const chunk of runStudyAgentLoop(request)) {
    if (chunk.type === "text_delta") {
      content += chunk.content;
    } else if (chunk.type === "done") {
      contextState = chunk.contextState;
    }
  }

  return {
    content: content.trim() || "Done.",
    contextState,
    sources: [],
  };
}
