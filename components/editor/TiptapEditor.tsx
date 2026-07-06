"use client";

import { mergeAttributes, type JSONContent } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { Mathematics } from "@tiptap/extension-mathematics";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { KeyboardEvent, useEffect, useRef, useState } from "react";
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

const autosaveDelayMs = 800;

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

export default function TiptapEditor({
  active,
  documentPath,
  initialState,
  onPersistedStateChange,
  onRename,
}: {
  active: boolean;
  documentPath: string;
  initialState?: PersistedEditorState;
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

  async function renameDocument() {
    const nextTitle = title.trim();
    if (!nextTitle || nextTitle === documentTitle(documentPath)) {
      setTitle(documentTitle(documentPath));
      return;
    }

    try {
      const result = await window.learner?.renameDocumentFile(documentPath, nextTitle);
      if (!result) return;
      setError("");
      onRename(documentPath, result.newPath);
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : "Failed to rename document.");
      setTitle(documentTitle(documentPath));
    }
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
