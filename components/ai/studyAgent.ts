"use client";

import { ChatOpenAI } from "@langchain/openai";
import { getEncoding } from "js-tiktoken";
import { createAgent, tool } from "langchain";
import { z } from "zod";
import type { ProposedDocumentPatch } from "./documentPatch";
import type { CurrentDocumentAgentTools } from "@/components/editor/TiptapEditor";

const proxyApiKeyStorageKey = "learner.ai.proxyKey.v1";
const proxyBaseUrlStorageKey = "learner.ai.proxyBaseUrl.v1";
const modelStorageKey = "learner.ai.model.v1";

const defaultProxyApiKey = "sk-cliproxy-michael-2026";
const defaultProxyBaseUrl = "http://127.0.0.1:8317/v1";
const defaultModel = "gpt-5.5";
const maxHistoryInputTokens = 80_000;
const summarizeWhenHistoryExceedsTokens = 48_000;
const recentHistoryTargetTokens = 20_000;
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
  getCurrentDocumentTools: () => CurrentDocumentAgentTools | null;
  onPatchProposed: (patch: ProposedDocumentPatch) => void;
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

function readLocalSetting(storageKey: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  return localStorage.getItem(storageKey)?.trim() || fallback;
}

function createLearnerModel() {
  return new ChatOpenAI({
    model: readLocalSetting(modelStorageKey, defaultModel),
    apiKey: readLocalSetting(proxyApiKeyStorageKey, defaultProxyApiKey),
    temperature: 0.25,
    streamUsage: false,
    configuration: {
      baseURL: readLocalSetting(proxyBaseUrlStorageKey, defaultProxyBaseUrl),
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

function createStudyTools({
  getCurrentDocumentTools,
  onPatchProposed,
  registerSources,
}: {
  getCurrentDocumentTools: () => CurrentDocumentAgentTools | null;
  onPatchProposed: (patch: ProposedDocumentPatch) => void;
  registerSources: (results: DocumentSemanticSearchResult[]) => AgentSource[];
}) {
  function getTools() {
    return getCurrentDocumentTools();
  }

  return [
    tool(
      async ({ limit = 6, query }) => {
        if (!window.learner?.semanticSearchDocuments) {
          return "Semantic note search is not available in this environment.";
        }

        try {
          const results = await window.learner.semanticSearchDocuments(query, Math.min(Math.max(limit, 1), 8));
          const sources = registerSources(results);

          if (sources.length === 0) {
            const status = await window.learner.getDocumentEmbeddingStatus?.();
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
              instructions:
                "Use these note sources when answering. Cite claims from these sources with inline markers like <source 1>.",
              sources: sources.map((source) => ({
                id: `source ${source.id}`,
                title: source.title,
                path: source.path,
                excerpt: source.excerpt,
                score: Number(source.score.toFixed(4)),
              })),
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
      async ({ patchText, summary }) => {
        const documentTools = getTools();
        if (!documentTools) return "No document is currently open.";
        const currentDocument = documentTools.read();

        onPatchProposed({
          id: `patch_${Date.now()}_${crypto.randomUUID()}`,
          documentPath: documentTools.path,
          baseHash: currentDocument.patchBaseHash,
          summary,
          changeType: "patch",
          patchText,
          status: "pending",
          createdAt: Date.now(),
        });

        return "Patch proposed. The user must review and apply it before the note changes.";
      },
      {
        name: "propose_current_document_patch",
        description:
          "Propose an apply_patch-style Markdown patch for the currently open note's patchableMarkdown. This does not mutate the document. The user must review and apply the patch.",
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

        onPatchProposed({
          id: `replace_${Date.now()}_${crypto.randomUUID()}`,
          documentPath: documentTools.path,
          baseHash: currentDocument.patchBaseHash,
          summary,
          changeType: "replace",
          replacementMarkdown: markdown,
          status: "pending",
          createdAt: Date.now(),
        });

        return "Full-document replacement proposed. The user must review and apply it before the note changes.";
      },
      {
        name: "propose_current_document_replacement",
        description:
          "Propose a full replacement for the currently open note using Markdown. Use this for writing a note from scratch, large rewrites, outlines, study guides, and long generated documents. This does not mutate the document.",
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

export async function runStudyAgent({
  messages,
  contextState: currentContextState = {},
  getCurrentDocumentTools,
  onPatchProposed,
}: RunStudyAgentRequest) {
  const nextContextState = await compactContextIfNeeded(messages, currentContextState);
  const retrievedSources: AgentSource[] = [];

  function registerSources(results: DocumentSemanticSearchResult[]) {
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

  const agent = createAgent({
    model: createLearnerModel(),
    tools: createStudyTools({
      getCurrentDocumentTools,
      onPatchProposed,
      registerSources,
    }),
    systemPrompt: [
      "You are the built-in AI study assistant for Learner, a local note-taking app.",
      "Help the user write, improve, summarize, and study their notes.",
      "When the user asks about saved notes, study material, related concepts, or asks a question that should be grounded in their note library, use search_notes before answering.",
      "When you use search_notes, cite sourced claims inline with the exact marker format <source N>, where N is the source number returned by the tool.",
      "If note search returns no useful source, say that the answer is not grounded in saved notes before giving a general answer.",
      "When editing the open note, propose a patch or replacement instead of directly changing content.",
      "Before modifying existing note content, read the current document unless the user only asks to insert new content.",
      "For writing a note from scratch, replacing the whole note, broad rewrites, long outlines, study guides, math-heavy content, Mermaid diagrams, or code-heavy generated content, use propose_current_document_replacement and write the replacement body in Markdown.",
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
      "After proposing a patch, tell the user what the patch does and that it is waiting for approval.",
    ].join("\n"),
  });

  const result = await agent.invoke({
    messages: buildModelMessages(messages, nextContextState),
  });

  const finalMessage = [...result.messages]
    .reverse()
    .find((message) => message._getType?.() === "ai" && messageContentToText(message.content).trim());

  return {
    content: finalMessage ? messageContentToText(finalMessage.content).trim() : "Done.",
    contextState: nextContextState,
    sources: retrievedSources,
  };
}
