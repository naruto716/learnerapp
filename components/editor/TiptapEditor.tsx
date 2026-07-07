"use client";

import { Extension, mergeAttributes, Node, type Editor, type JSONContent } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { Mathematics } from "@tiptap/extension-mathematics";
import { Markdown } from "@tiptap/markdown";
import { DOMSerializer } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  applyDocumentPatchText,
  hashDocumentPatchBase,
  previewDocumentPatchText,
  type DocumentPatchApplyResult,
  type DocumentPatchPreviewHunk,
  type DocumentPatchPreviewResult,
  type ProposedDocumentPatch,
} from "@/components/ai/documentPatch";
import { documentTitle } from "../documentPaths";
import { LearnerCodeBlock } from "./CodeBlock";
import EditMathDialog, { type EditableMath } from "./EditMathDialog";
import { LatexDelimiters } from "./LatexDelimiters";

export type PersistedEditorState = {
  selection?: {
    from: number;
    to: number;
  };
  scrollTop?: number;
};

export type CurrentDocumentAgentTools = {
  path: string;
  title: string;
  read: () => {
    path: string;
    title: string;
    selectedText: string;
    text: string;
    markdown: string;
    html: string;
    patchableMarkdown: string;
    patchBaseHash: string;
  };
  previewPatch: (
    patch: ProposedDocumentPatch,
    actions?: {
      onApply: (patchId: string) => void;
      onReject: (patchId: string) => void;
    },
  ) => DocumentPatchPreviewResult;
  clearPatchPreview: (patchId?: string) => void;
  applyPatch: (patch: ProposedDocumentPatch) => DocumentPatchApplyResult;
  undoPatch: (patchId: string) => DocumentPatchApplyResult;
};

type PendingPatchPreview = {
  actions?: PatchPreviewActions;
  failures: string[];
  hunks: DocumentPatchPreviewHunk[];
  patch: ProposedDocumentPatch;
};

type PatchPreviewActions = {
  onApply: (patchId: string) => void;
  onReject: (patchId: string) => void;
};

type AiPatchDecorationState = {
  actions?: PatchPreviewActions;
  insertions: Array<{
    html: string;
    index: number;
    pos: number;
  }>;
  patchId: string;
  ranges: Array<{
    from: number;
    to: number;
  }>;
} | null;

type ActivePatchPreview = {
  patchId: string;
  source: string;
  wasEditable: boolean;
  json: JSONContent;
};

type PatchReplacementBlock = {
  addedHtml: string;
  from: number;
  index: number;
  patchId: string;
  removedHtml: string;
  to: number;
};

const autosaveDelayMs = 800;
const aiPatchPreviewPluginKey = new PluginKey<AiPatchDecorationState>("aiPatchPreview");
const aiPatchPreviewActionEvent = "learner-ai-patch-preview-action";

const emptyDocument: JSONContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
    },
  ],
};

function resolveDocumentImageSrc(src: unknown) {
  if (typeof src !== "string") return "";

  if (/^(https?:|data:|blob:|learner:)/i.test(src)) {
    return src;
  }

  return `learner://documents/${src
    .replace(/^\/+/g, "")
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")}`;
}

const LearnerImage = Image.extend({
  renderHTML({ HTMLAttributes }) {
    return [
      "img",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        src: resolveDocumentImageSrc(HTMLAttributes.src),
      }),
    ];
  },
});

function pastedImageName(file: File, index: number) {
  if (file.name) return file.name;

  const extension = file.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
  return `pasted-image-${Date.now()}-${index}.${extension}`;
}

function appendInlineLatexContent(content: JSONContent[], text: string) {
  const inlineMathRegex = /\\\(([\s\S]+?)\\\)/g;
  let lastIndex = 0;

  for (const match of text.matchAll(inlineMathRegex)) {
    const index = match.index ?? 0;
    const before = text.slice(lastIndex, index);
    const latex = match[1]?.trim();

    if (before) {
      content.push({ type: "text", text: before });
    }

    if (latex) {
      content.push({ type: "inlineMath", attrs: { latex } });
    } else {
      content.push({ type: "text", text: match[0] });
    }

    lastIndex = index + match[0].length;
  }

  const after = text.slice(lastIndex);
  if (after) {
    content.push({ type: "text", text: after });
  }
}

function paragraphFromText(text: string): JSONContent | null {
  const lines = text.split("\n");
  const content: JSONContent[] = [];

  lines.forEach((line, index) => {
    if (index > 0) {
      content.push({ type: "hardBreak" });
    }

    appendInlineLatexContent(content, line);
  });

  return content.length > 0 ? { type: "paragraph", content } : null;
}

function appendTextContent(nodes: JSONContent[], text: string) {
  const paragraphs = text.split(/\n{2,}/);

  for (const paragraph of paragraphs) {
    const node = paragraphFromText(paragraph);
    if (node) {
      nodes.push(node);
    }
  }
}

function parseLatexDelimitedText(text: string) {
  if (!text.includes("\\(") && !text.includes("\\[")) return null;

  const nodes: JSONContent[] = [];
  const blockMathRegex = /\\\[([\s\S]+?)\\\]/g;
  let lastIndex = 0;

  for (const match of text.matchAll(blockMathRegex)) {
    const index = match.index ?? 0;
    const before = text.slice(lastIndex, index);
    const latex = match[1]?.trim();

    appendTextContent(nodes, before);

    if (latex) {
      nodes.push({ type: "blockMath", attrs: { latex } });
    } else {
      appendTextContent(nodes, match[0]);
    }

    lastIndex = index + match[0].length;
  }

  appendTextContent(nodes, text.slice(lastIndex));

  return nodes.length > 0 ? nodes : null;
}

function sanitizePreviewHtml(html: string) {
  if (typeof window === "undefined") return html;

  const document = new DOMParser().parseFromString(html, "text/html");
  document.querySelectorAll("script, style, iframe, object, embed").forEach((node) => node.remove());

  document.body.querySelectorAll("*").forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();

      if (name.startsWith("on") || value.startsWith("javascript:")) {
        element.removeAttribute(attribute.name);
      }
    }
  });

  return document.body.innerHTML;
}

function proposedChangeType(patch: ProposedDocumentPatch) {
  return patch.changeType ?? "patch";
}

function transformMarkdownOutsideCodeFences(markdown: string, transform: (segment: string) => string) {
  const lines = markdown.replace(/\r\n/g, "\n").match(/[^\n]*\n|[^\n]+$/g) ?? [];
  let result = "";
  let buffer = "";
  let inFence = false;
  let fenceCharacter = "";
  let fenceLength = 0;

  function flushBuffer() {
    if (!buffer) return;
    result += transform(buffer);
    buffer = "";
  }

  for (const line of lines) {
    const fenceMatch = line.trimStart().match(/^(`{3,}|~{3,})/);

    if (fenceMatch) {
      const marker = fenceMatch[1];

      if (!inFence) {
        flushBuffer();
        inFence = true;
        fenceCharacter = marker[0];
        fenceLength = marker.length;
        result += line;
        continue;
      }

      if (marker[0] === fenceCharacter && marker.length >= fenceLength) {
        inFence = false;
        result += line;
        continue;
      }
    }

    if (inFence) {
      result += line;
    } else {
      buffer += line;
    }
  }

  flushBuffer();
  return result;
}

function normalizeMarkdownForTiptap(markdown: string) {
  return transformMarkdownOutsideCodeFences(markdown, (segment) =>
    segment
      .replace(/\\\[([\s\S]+?)\\\]/g, (_match, latex: string) => `\n\n$$\n${latex.trim()}\n$$\n\n`)
      .replace(/\\\(([\s\S]+?)\\\)/g, (_match, latex: string) => `$${latex.trim()}$`),
  );
}

function markdownToTiptapJson(editor: Editor, markdown: string) {
  if (!editor.markdown) {
    throw new Error("Markdown support is not available in the editor.");
  }

  return editor.markdown.parse(normalizeMarkdownForTiptap(markdown));
}

function getPatchableMarkdown(editor: Editor) {
  return (editor.getMarkdown?.() ?? "").replace(/\r\n/g, "\n").trim();
}

function tiptapJsonToHtml(editor: Editor, content: JSONContent) {
  const node = editor.schema.nodeFromJSON(content);
  const serializer = DOMSerializer.fromSchema(editor.schema);
  const container = window.document.createElement("div");

  container.appendChild(serializer.serializeFragment(node.content));
  return sanitizePreviewHtml(container.innerHTML || "<p></p>");
}

function createPatchInsertionWidget(html: string, index: number) {
  const wrapper = window.document.createElement("div");
  wrapper.className = "ai-diff-insert-widget";
  wrapper.contentEditable = "false";

  const label = window.document.createElement("div");
  label.className = "ai-diff-widget-label";
  label.textContent = `+ proposed change ${index}`;

  const body = window.document.createElement("div");
  body.className = "ai-diff-insert-body";
  body.innerHTML = sanitizePreviewHtml(html);

  wrapper.append(label, body);
  return wrapper;
}

function createPatchControlsWidget(preview: NonNullable<AiPatchDecorationState>) {
  const wrapper = window.document.createElement("div");
  wrapper.className = "ai-diff-controls-widget";
  wrapper.contentEditable = "false";

  const label = window.document.createElement("span");
  label.className = "ai-diff-controls-label";
  label.textContent = "AI changes";

  const rejectButton = window.document.createElement("button");
  rejectButton.type = "button";
  rejectButton.textContent = "Reject";

  const applyButton = window.document.createElement("button");
  applyButton.type = "button";
  applyButton.className = "ai-diff-apply-button";
  applyButton.textContent = "Apply";

  for (const button of [rejectButton, applyButton]) {
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
  }

  rejectButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    preview.actions?.onReject(preview.patchId);
  });

  applyButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    preview.actions?.onApply(preview.patchId);
  });

  wrapper.append(label, rejectButton, applyButton);
  return wrapper;
}

function dispatchPatchPreviewAction(action: "apply" | "reject", patchId: string) {
  window.dispatchEvent(
    new CustomEvent(aiPatchPreviewActionEvent, {
      detail: {
        action,
        patchId,
      },
    }),
  );
}

function setStyle(element: HTMLElement, cssText: string) {
  element.style.cssText = cssText;
}

function createPreviewSection({ html, kind }: { html: string; kind: "add" | "remove" }) {
  const section = window.document.createElement("div");
  setStyle(
    section,
    [
      "display:grid",
      "grid-template-columns:1.5rem minmax(0, 1fr)",
      "gap:0.25rem",
      "padding:0.7rem 0.85rem",
      kind === "add" ? "background:rgba(20,83,45,0.16)" : "background:rgba(127,29,29,0.16)",
      kind === "add"
        ? "box-shadow:inset 2px 0 0 rgba(74,222,128,0.52)"
        : "box-shadow:inset 2px 0 0 rgba(248,113,113,0.48)",
    ].join(";"),
  );

  const sign = window.document.createElement("span");
  sign.textContent = kind === "add" ? "+" : "-";
  setStyle(
    sign,
    [
      'font-family:"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
      "font-size:1rem",
      "font-weight:800",
      "line-height:1.55",
      kind === "add" ? "color:rgba(134,239,172,0.82)" : "color:rgba(252,165,165,0.78)",
    ].join(";"),
  );

  const content = window.document.createElement("div");
  content.innerHTML = sanitizePreviewHtml(html);
  setStyle(
    content,
    [
      "min-width:0",
      "font-size:0.96rem",
      "line-height:1.55",
      kind === "add" ? "color:rgba(220,252,231,0.9)" : "color:rgba(254,226,226,0.76)",
      kind === "remove" ? "text-decoration:line-through" : "",
      kind === "remove" ? "text-decoration-color:rgba(248,113,113,0.55)" : "",
    ]
      .filter(Boolean)
      .join(";"),
  );

  section.append(sign, content);
  return section;
}

function createPreviewButton({
  label,
  onClick,
  primary,
}: {
  label: string;
  onClick: () => void;
  primary?: boolean;
}) {
  const button = window.document.createElement("button");
  button.type = "button";
  button.textContent = label;
  setStyle(
    button,
    [
      "border:0",
      "border-radius:999px",
      primary ? "background:rgba(255,255,255,0.92)" : "background:transparent",
      "padding:0.45rem 0.75rem",
      primary ? "color:rgba(0,0,0,0.92)" : "color:rgba(255,255,255,0.68)",
      "font-size:0.78rem",
      primary ? "font-weight:650" : "font-weight:500",
      "cursor:pointer",
    ].join(";"),
  );
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  return button;
}

function createAiDiffPreviewBlockElement({
  addedHtml,
  index,
  patchId,
  removedHtml,
}: {
  addedHtml: string;
  index: number;
  patchId: string;
  removedHtml: string;
}) {
  const wrapper = window.document.createElement("div");
  wrapper.className = "ai-diff-replacement-widget";
  wrapper.contentEditable = "false";
  wrapper.dataset.aiDiffPreviewBlock = "true";
  setStyle(
    wrapper,
    [
      "margin:0.75rem 0 1rem",
      "overflow:hidden",
      "border-radius:8px",
      "background:rgba(255,255,255,0.035)",
      "color:rgba(255,255,255,0.88)",
      "border:1px solid rgba(255,255,255,0.09)",
      "box-shadow:0 12px 28px rgba(0,0,0,0.18)",
    ].join(";"),
  );

  const header = window.document.createElement("div");
  setStyle(
    header,
    [
      "display:flex",
      "align-items:center",
      "justify-content:space-between",
      "gap:1rem",
      "padding:0.5rem 0.75rem",
      "color:rgba(255,255,255,0.48)",
      "font-size:0.68rem",
      "font-weight:700",
      "letter-spacing:0.04em",
      "text-transform:uppercase",
      "background:rgba(255,255,255,0.025)",
    ].join(";"),
  );

  const title = window.document.createElement("span");
  title.textContent = "AI preview";
  const change = window.document.createElement("span");
  change.textContent = `Change ${index}`;
  header.append(title, change);
  wrapper.append(header);

  if (removedHtml) {
    wrapper.append(createPreviewSection({ html: removedHtml, kind: "remove" }));
  }

  if (addedHtml) {
    wrapper.append(createPreviewSection({ html: addedHtml, kind: "add" }));
  }

  const actions = window.document.createElement("div");
  setStyle(
    actions,
    [
      "display:flex",
      "justify-content:flex-end",
      "gap:0.5rem",
      "padding:0.55rem 0.75rem 0.65rem",
      "background:rgba(255,255,255,0.025)",
    ].join(";"),
  );
  actions.append(
    createPreviewButton({
      label: "Reject",
      onClick: () => dispatchPatchPreviewAction("reject", patchId),
    }),
    createPreviewButton({
      label: "Apply",
      onClick: () => dispatchPatchPreviewAction("apply", patchId),
      primary: true,
    }),
  );
  wrapper.append(actions);

  return wrapper;
}

const AiDiffPreviewBlock = Node.create({
  name: "aiDiffPreviewBlock",

  atom: true,
  group: "block",
  selectable: false,

  addAttributes() {
    return {
      addedHtml: {
        default: "",
      },
      index: {
        default: 1,
      },
      patchId: {
        default: "",
      },
      removedHtml: {
        default: "",
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-ai-diff-preview-block]",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-ai-diff-preview-block": "",
      }),
    ];
  },

  addNodeView() {
    return ({ node }) => {
      return {
        dom: createAiDiffPreviewBlockElement({
          addedHtml: String(node.attrs.addedHtml ?? ""),
          index: Number(node.attrs.index ?? 1),
          patchId: String(node.attrs.patchId ?? ""),
          removedHtml: String(node.attrs.removedHtml ?? ""),
        }),
      };
    };
  },
});

const AiPatchPreviewExtension = Extension.create({
  name: "aiPatchPreview",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: aiPatchPreviewPluginKey,
        props: {
          decorations(state) {
            const preview = aiPatchPreviewPluginKey.getState(state);
            if (!preview) return null;

            const decorations = [
              ...preview.ranges.map((range, index) =>
                Decoration.node(
                  range.from,
                  range.to,
                  {
                    class: "ai-diff-remove",
                  },
                  {
                    key: `remove-${preview.patchId}-${index}`,
                  },
                ),
              ),
              ...preview.insertions.map((insertion) =>
                Decoration.widget(
                  insertion.pos,
                  () => createPatchInsertionWidget(insertion.html, insertion.index),
                  {
                    key: `insert-${preview.patchId}-${insertion.index}`,
                    side: 1,
                  },
                ),
              ),
            ];

            if (preview.actions) {
              const controlsPos = preview.ranges[0]?.from ?? preview.insertions[0]?.pos ?? 0;
              decorations.push(
                Decoration.widget(controlsPos, () => createPatchControlsWidget(preview), {
                  key: `controls-${preview.patchId}`,
                  side: -1,
                }),
              );
            }

            return DecorationSet.create(state.doc, decorations);
          },
        },
        state: {
          init() {
            return null;
          },
          apply(transaction, value) {
            const preview = transaction.getMeta(aiPatchPreviewPluginKey) as AiPatchDecorationState | undefined;
            return preview === undefined ? value : preview;
          },
        },
      }),
    ];
  },
});

export default function TiptapEditor({
  active,
  documentPath,
  initialState,
  onAgentToolsChange,
  onPersistedStateChange,
  onRename,
}: {
  active: boolean;
  documentPath: string;
  initialState?: PersistedEditorState;
  onAgentToolsChange?: (documentPath: string, tools: CurrentDocumentAgentTools | null) => void;
  onPersistedStateChange: (state: PersistedEditorState) => void;
  onRename: (oldPath: string, newPath: string) => void;
}) {
  const [error, setError] = useState("");
  const [editingMath, setEditingMath] = useState<EditableMath | null>(null);
  const [title, setTitle] = useState(documentTitle(documentPath));
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorScrollRef = useRef<HTMLDivElement | null>(null);
  const initialStateRef = useRef(initialState);
  const loadedRef = useRef(false);
  const activePatchPreviewRef = useRef<ActivePatchPreview | null>(null);
  const agentUndoSnapshotsRef = useRef<Record<string, JSONContent>>({});
  const pendingPatchPreviewRef = useRef<PendingPatchPreview | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
      }),
      LearnerCodeBlock,
      LearnerImage.configure({
        allowBase64: false,
      }),
      LatexDelimiters,
      Markdown.configure({
        markedOptions: {
          breaks: false,
          gfm: true,
        },
      }),
      AiDiffPreviewBlock,
      AiPatchPreviewExtension,
      Mathematics.configure({
        inlineOptions: {
          onClick: (node, pos) => {
            setEditingMath({
              kind: "inline",
              latex: String(node.attrs.latex ?? ""),
              pos,
            });
          },
        },
        blockOptions: {
          onClick: (node, pos) => {
            setEditingMath({
              kind: "block",
              latex: String(node.attrs.latex ?? ""),
              pos,
            });
          },
        },
        katexOptions: {
          throwOnError: false,
        },
      }),
    ],
    content: emptyDocument,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "min-h-[calc(100vh-12rem)] px-6 pb-10 outline-none",
      },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith("image/"));

        if (files.length > 0) {
          event.preventDefault();
          void insertPastedImages(files);
          return true;
        }

        const text = event.clipboardData?.getData("text/plain") ?? "";
        const content = parseLatexDelimitedText(text);

        if (!content) {
          return false;
        }

        event.preventDefault();
        editor?.chain().focus().insertContent(content).run();
        return true;
      },
    },
    onSelectionUpdate({ editor }) {
      const { from, to } = editor.state.selection;
      onPersistedStateChange({
        selection: { from, to },
        scrollTop: editorScrollRef.current?.scrollTop ?? 0,
      });
    },
    onUpdate({ editor }) {
      if (!loadedRef.current) return;

      const { from, to } = editor.state.selection;
      onPersistedStateChange({
        selection: { from, to },
        scrollTop: editorScrollRef.current?.scrollTop ?? 0,
      });

      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
      }

      autosaveTimerRef.current = setTimeout(async () => {
        try {
          await window.learner?.saveDocument(documentPath, editor.getJSON() as TiptapDocument);
          setError("");
        } catch (saveError) {
          setError(saveError instanceof Error ? saveError.message : "Failed to save document.");
        }
      }, autosaveDelayMs);
    },
  });

  useEffect(() => {
    let ignore = false;

    async function loadDocument() {
      if (!editor) return;

      try {
        if (!window.learner) {
          setError("Documents are available in Electron.");
          return;
        }

        loadedRef.current = false;
        const document = await window.learner.readDocument(documentPath);

        if (!ignore) {
          editor.commands.setContent(document as JSONContent, { emitUpdate: false });

          window.requestAnimationFrame(() => {
            if (ignore) return;

            if (initialStateRef.current?.selection) {
              try {
                editor.commands.setTextSelection(initialStateRef.current.selection);
              } catch {
                // Ignore stale selections from older document versions.
              }
            }

            if (editorScrollRef.current && typeof initialStateRef.current?.scrollTop === "number") {
              editorScrollRef.current.scrollTop = initialStateRef.current.scrollTop;
            }

            loadedRef.current = true;
          });

          setError("");
        }
      } catch (loadError) {
        if (!ignore) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load document.");
        }
      }
    }

    loadDocument();

    return () => {
      ignore = true;
      loadedRef.current = false;
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
      }
    };
  }, [documentPath, editor]);

  const renameDocumentTo = useCallback(async (nextTitleInput: string) => {
    const nextTitle = nextTitleInput.trim();
    if (!nextTitle || nextTitle === documentTitle(documentPath)) {
      setTitle(documentTitle(documentPath));
      return documentPath;
    }

    try {
      const result = await window.learner?.renameDocumentFile(documentPath, nextTitle);
      if (!result) return documentPath;
      setError("");
      setTitle(documentTitle(result.newPath));
      onRename(documentPath, result.newPath);
      return result.newPath;
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : "Failed to rename document.");
      setTitle(documentTitle(documentPath));
      throw renameError;
    }
  }, [documentPath, onRename]);

  async function renameDocument() {
    await renameDocumentTo(title);
  }

  function handleTitleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.currentTarget.blur();
    }

    if (event.key === "Escape") {
      setTitle(documentTitle(documentPath));
      event.currentTarget.blur();
    }
  }

  async function insertPastedImages(files: File[]) {
    if (!editor) return;

    try {
      for (const [index, file] of files.entries()) {
        const data = new Uint8Array(await file.arrayBuffer());
        const imagePath = await window.learner?.saveDocumentImage(pastedImageName(file, index), data);

        if (imagePath) {
          editor.chain().focus().setImage({ src: imagePath }).run();
        }
      }

      setError("");
    } catch (imageError) {
      setError(imageError instanceof Error ? imageError.message : "Failed to import image.");
    }
  }

  function updateEditingMathLatex(latex: string) {
    setEditingMath((current) => (current ? { ...current, latex } : current));
  }

  function closeMathEditor() {
    setEditingMath(null);
  }

  function saveMathEdit() {
    if (!editor || !editingMath) return;

    const latex = editingMath.latex.trim();

    if (!latex) {
      setEditingMath(null);
      return;
    }

    if (editingMath.kind === "inline") {
      editor.chain().focus().updateInlineMath({ latex, pos: editingMath.pos }).run();
    } else {
      editor.chain().focus().updateBlockMath({ latex, pos: editingMath.pos }).run();
    }

    setEditingMath(null);
  }

  const resolvePatchPreview = useCallback((patch: ProposedDocumentPatch): DocumentPatchPreviewResult => {
    if (!editor) {
      return {
        failures: ["Editor is not ready."],
        hunks: [],
      };
    }

    if (patch.documentPath !== documentPath) {
      return {
        failures: [`Patch targets ${patch.documentPath}, but ${documentPath} is currently open.`],
        hunks: [],
      };
    }

    if (proposedChangeType(patch) !== "patch") {
      return {
        failures: ["This change is not a line patch."],
        hunks: [],
      };
    }

    if (!patch.patchText?.trim()) {
      return {
        failures: ["Patch text is empty."],
        hunks: [],
      };
    }

    const currentSource = getPatchableMarkdown(editor);
    const currentHash = hashDocumentPatchBase(currentSource);

    if (patch.baseHash !== currentHash) {
      return {
        failures: [
          "The document changed after this patch was proposed. Ask the agent to regenerate the patch against the current document.",
        ],
        hunks: [],
      };
    }

    try {
      return previewDocumentPatchText({
        currentSource,
        expectedDocumentPath: documentPath,
        patchText: patch.patchText,
      });
    } catch (patchError) {
      return {
        failures: [patchError instanceof Error ? patchError.message : "Patch could not be parsed."],
        hunks: [],
      };
    }
  }, [documentPath, editor]);

  useEffect(() => {
    if (!editor || !onAgentToolsChange) return;

    const setEditorPatchPreview = (preview: AiPatchDecorationState) => {
      editor.view.dispatch(editor.state.tr.setMeta(aiPatchPreviewPluginKey, preview));
    };

    const clearEditorPatchPreview = (patchId?: string) => {
      const currentPreview = pendingPatchPreviewRef.current;
      if (currentPreview && patchId && currentPreview.patch.id !== patchId) return;

      pendingPatchPreviewRef.current = null;

      const pluginPreview = aiPatchPreviewPluginKey.getState(editor.state);
      if (!pluginPreview || (patchId && pluginPreview.patchId !== patchId)) return;

      setEditorPatchPreview(null);
    };

    const restoreActivePatchPreview = (patchId?: string) => {
      const activePreview = activePatchPreviewRef.current;
      if (!activePreview) return false;
      if (patchId && activePreview.patchId !== patchId) return false;

      loadedRef.current = false;
      editor.commands.setContent(activePreview.json, { emitUpdate: false });
      editor.setEditable(activePreview.wasEditable);
      activePatchPreviewRef.current = null;

      window.requestAnimationFrame(() => {
        loadedRef.current = true;
      });

      return true;
    };

    const setReplacementPatchPreview = ({
      blocks,
      patch,
      source,
    }: {
      blocks: PatchReplacementBlock[];
      patch: ProposedDocumentPatch;
      source: string;
    }) => {
      restoreActivePatchPreview();

      const previewNode = editor.schema.nodes.aiDiffPreviewBlock;
      if (!previewNode) return;

      activePatchPreviewRef.current = {
        json: editor.getJSON() as JSONContent,
        patchId: patch.id,
        source,
        wasEditable: editor.isEditable,
      };

      let transaction = editor.state.tr.setMeta("addToHistory", false);

      blocks
        .slice()
        .sort((firstBlock, secondBlock) => secondBlock.from - firstBlock.from)
        .forEach((block) => {
          const node = previewNode.create({
            addedHtml: block.addedHtml,
            index: block.index,
            patchId: block.patchId,
            removedHtml: block.removedHtml,
          });

          if (block.from === block.to) {
            transaction = transaction.insert(block.from, node);
          } else {
            transaction = transaction.replaceWith(block.from, block.to, node);
          }
        });

      loadedRef.current = false;
      editor.view.dispatch(transaction);
      editor.setEditable(false);

      window.requestAnimationFrame(() => {
        editorScrollRef.current?.querySelector(".ai-diff-replacement-widget")?.scrollIntoView({
          block: "center",
          behavior: "smooth",
        });
      });
    };

    const scrollToPatchPreview = () => {
      window.requestAnimationFrame(() => {
        editorScrollRef.current
          ?.querySelector(".ai-diff-controls-widget, .ai-diff-insert-widget, .ai-diff-remove")
          ?.scrollIntoView({
            block: "center",
            behavior: "smooth",
          });
      });
    };

    const readDocument = () => {
      const { from, to } = editor.state.selection;
      const html = editor.getHTML();
      const patchableMarkdown = getPatchableMarkdown(editor);

      return {
        path: documentPath,
        title: documentTitle(documentPath),
        selectedText: from === to ? "" : editor.state.doc.textBetween(from, to, "\n\n"),
        text: editor.state.doc.textBetween(0, editor.state.doc.content.size, "\n\n"),
        markdown: patchableMarkdown,
        html,
        patchableMarkdown,
        patchBaseHash: hashDocumentPatchBase(patchableMarkdown),
      };
    };

    const handlePatchPreviewAction = (event: Event) => {
      const actionEvent = event as CustomEvent<{
        action?: "apply" | "reject";
        patchId?: string;
      }>;
      const { action, patchId } = actionEvent.detail ?? {};
      const currentPreview = pendingPatchPreviewRef.current;

      if (!patchId || !currentPreview || currentPreview.patch.id !== patchId) return;

      if (action === "apply") {
        currentPreview.actions?.onApply(patchId);
      } else if (action === "reject") {
        currentPreview.actions?.onReject(patchId);
      }
    };

    window.addEventListener(aiPatchPreviewActionEvent, handlePatchPreviewAction);

    onAgentToolsChange(documentPath, {
      path: documentPath,
      title: documentTitle(documentPath),
      read: readDocument,
      previewPatch: (patch, actions) => {
        restoreActivePatchPreview();

        const currentSource = getPatchableMarkdown(editor);
        const currentHash = hashDocumentPatchBase(currentSource);
        const currentHtml = editor.getHTML();

        if (patch.baseHash !== currentHash) {
          const failures = [
            "The document changed after this change was proposed. Ask the agent to regenerate it against the current document.",
          ];

          pendingPatchPreviewRef.current = {
            actions,
            failures,
            hunks: [],
            patch,
          };

          return {
            failures,
            hunks: [],
          };
        }

        if (proposedChangeType(patch) === "replace") {
          const replacementMarkdown = patch.replacementMarkdown?.trim();

          if (!replacementMarkdown) {
            const failures = ["Replacement Markdown is empty."];

            pendingPatchPreviewRef.current = {
              actions,
              failures,
              hunks: [],
              patch,
            };

            return {
              failures,
              hunks: [],
            };
          }

          let replacementHtml;

          try {
            replacementHtml = tiptapJsonToHtml(editor, markdownToTiptapJson(editor, replacementMarkdown));
          } catch (replaceError) {
            const failures = [
              replaceError instanceof Error ? replaceError.message : "Replacement Markdown could not be converted.",
            ];

            pendingPatchPreviewRef.current = {
              actions,
              failures,
              hunks: [],
              patch,
            };

            return {
              failures,
              hunks: [],
            };
          }

          pendingPatchPreviewRef.current = {
            actions,
            failures: [],
            hunks: [],
            patch,
          };

          setEditorPatchPreview(null);
          setReplacementPatchPreview({
            blocks: [
              {
                addedHtml: replacementHtml,
                from: 0,
                index: 1,
                patchId: patch.id,
                removedHtml: currentHtml,
                to: editor.state.doc.content.size,
              },
            ],
            patch,
            source: currentSource,
          });

          return {
            failures: [],
            hunks: [],
          };
        }

        const preview = resolvePatchPreview(patch);
        let patchedHtml = "";
        let patchFailures = [...preview.failures];

        if (patchFailures.length === 0) {
          try {
            const patchResult = applyDocumentPatchText({
              currentSource,
              expectedDocumentPath: documentPath,
              patchText: patch.patchText ?? "",
            });

            patchFailures = patchResult.failures;

            if (patchFailures.length === 0) {
              patchedHtml = tiptapJsonToHtml(editor, markdownToTiptapJson(editor, patchResult.patchedSource));
            }
          } catch (patchError) {
            patchFailures = [patchError instanceof Error ? patchError.message : "Patch could not be previewed."];
          }
        }

        pendingPatchPreviewRef.current = {
          actions,
          failures: patchFailures,
          hunks: preview.hunks,
          patch,
        };

        setEditorPatchPreview(null);

        if (patchFailures.length === 0) {
          setReplacementPatchPreview({
            blocks: [
              {
                addedHtml: patchedHtml,
                from: 0,
                index: 1,
                patchId: patch.id,
                removedHtml: currentHtml,
                to: editor.state.doc.content.size,
              },
            ],
            patch,
            source: currentSource,
          });
        } else {
          scrollToPatchPreview();
        }

        return {
          failures: patchFailures,
          hunks: preview.hunks,
        };
      },
      clearPatchPreview: (patchId) => {
        restoreActivePatchPreview(patchId);
        clearEditorPatchPreview(patchId);
      },
      applyPatch: (patch) => {
        if (patch.documentPath !== documentPath) {
          return {
            appliedOperations: 0,
            failures: [`Patch targets ${patch.documentPath}, but ${documentPath} is currently open.`],
          };
        }

        const activePreview = activePatchPreviewRef.current;
        const currentSource =
          activePreview?.patchId === patch.id ? activePreview.source : getPatchableMarkdown(editor);
        const currentHash = hashDocumentPatchBase(currentSource);

        if (patch.baseHash !== currentHash) {
          return {
            appliedOperations: 0,
            failures: [
              "The document changed after this patch was proposed. Ask the agent to regenerate the patch against the current document.",
            ],
          };
        }

        if (proposedChangeType(patch) === "replace") {
          const replacementMarkdown = patch.replacementMarkdown?.trim();

          if (!replacementMarkdown) {
            return {
              appliedOperations: 0,
              failures: ["Replacement Markdown is empty."],
            };
          }

          let replacementContent;

          try {
            replacementContent = markdownToTiptapJson(editor, replacementMarkdown);
          } catch (replaceError) {
            return {
              appliedOperations: 0,
              failures: [
                replaceError instanceof Error ? replaceError.message : "Replacement Markdown could not be converted.",
              ],
            };
          }

          if (activePreview?.patchId === patch.id) {
            activePatchPreviewRef.current = null;
            editor.setEditable(activePreview.wasEditable);
            loadedRef.current = true;
          }

          clearEditorPatchPreview(patch.id);
          agentUndoSnapshotsRef.current[patch.id] =
            activePreview?.patchId === patch.id ? activePreview.json : (editor.getJSON() as JSONContent);
          editor.commands.setContent(replacementContent);

          return {
            appliedOperations: 1,
            failures: [],
          };
        }

        if (!patch.patchText?.trim()) {
          return {
            appliedOperations: 0,
            failures: ["Patch text is empty."],
          };
        }

        let result;

        try {
          result = applyDocumentPatchText({
            currentSource,
            expectedDocumentPath: documentPath,
            patchText: patch.patchText,
          });
        } catch (patchError) {
          return {
            appliedOperations: 0,
            failures: [patchError instanceof Error ? patchError.message : "Patch could not be parsed."],
          };
        }

        if (result.failures.length === 0) {
          let patchedContent;

          try {
            patchedContent = markdownToTiptapJson(editor, result.patchedSource);
          } catch (patchError) {
            return {
              appliedOperations: 0,
              failures: [patchError instanceof Error ? patchError.message : "Patched Markdown could not be converted."],
            };
          }

          if (activePreview?.patchId === patch.id) {
            activePatchPreviewRef.current = null;
            editor.setEditable(activePreview.wasEditable);
            loadedRef.current = true;
          }

          clearEditorPatchPreview(patch.id);
          agentUndoSnapshotsRef.current[patch.id] =
            activePreview?.patchId === patch.id ? activePreview.json : (editor.getJSON() as JSONContent);
          editor.commands.setContent(patchedContent);
        }

        return result;
      },
      undoPatch: (patchId) => {
        const snapshot = agentUndoSnapshotsRef.current[patchId];

        if (!snapshot) {
          return {
            appliedOperations: 0,
            failures: ["No undo snapshot is available for this change."],
          };
        }

        restoreActivePatchPreview();
        clearEditorPatchPreview(patchId);
        editor.commands.setContent(snapshot);
        delete agentUndoSnapshotsRef.current[patchId];

        return {
          appliedOperations: 1,
          failures: [],
        };
      },
    });

    return () => {
      window.removeEventListener(aiPatchPreviewActionEvent, handlePatchPreviewAction);
      restoreActivePatchPreview();
      pendingPatchPreviewRef.current = null;
      setEditorPatchPreview(null);
      onAgentToolsChange(documentPath, null);
    };
  }, [documentPath, editor, onAgentToolsChange, resolvePatchPreview]);

  return (
    <section className={`${active ? "block" : "hidden"} h-full min-h-0`}>
      <div
        ref={editorScrollRef}
        onScroll={() => {
          if (!editor) return;
          const { from, to } = editor.state.selection;
          onPersistedStateChange({
            selection: { from, to },
            scrollTop: editorScrollRef.current?.scrollTop ?? 0,
          });
        }}
        className="h-full overflow-auto"
      >
        <div className="px-6 pt-6">
          <input
            aria-label="Document title"
            className="mb-4 w-full bg-transparent text-3xl font-semibold outline-none"
            onBlur={renameDocument}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={handleTitleKeyDown}
            value={title}
          />
        </div>

        {error && <p className="mx-6 mb-4 rounded-md bg-red-300/10 px-3 py-2 text-xs text-red-300">{error}</p>}

        <EditorContent className="min-h-full" editor={editor} />
      </div>

      <EditMathDialog
        math={editingMath}
        onClose={closeMathEditor}
        onLatexChange={updateEditingMathLatex}
        onSubmit={saveMathEdit}
      />
    </section>
  );
}
