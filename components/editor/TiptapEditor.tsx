"use client";

import type { JSONContent } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { KeyboardEvent, useEffect, useRef, useState } from "react";
import { documentTitle } from "../documentPaths";

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
  const [title, setTitle] = useState(documentTitle(documentPath));
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorScrollRef = useRef<HTMLDivElement | null>(null);
  const initialStateRef = useRef(initialState);
  const loadedRef = useRef(false);

  const editor = useEditor({
    extensions: [StarterKit],
    content: emptyDocument,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "min-h-[calc(100vh-12rem)] px-6 pb-10 outline-none",
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
    </section>
  );
}
