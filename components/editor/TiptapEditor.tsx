"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { JSONContent } from "@tiptap/core";
import { useEffect, useState } from "react";

const emptyDocument: JSONContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
    },
  ],
};

export default function TiptapEditor({ documentPath }: { documentPath: string | null }) {
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const editor = useEditor({
    extensions: [StarterKit],
    content: emptyDocument,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "min-h-[calc(100vh-8rem)] rounded-md border border-white/10 bg-black/10 p-4 outline-none",
      },
    },
  });

  useEffect(() => {
    let ignore = false;

    async function loadDocument() {
      if (!editor || !documentPath) return;

      try {
        if (!window.learner) {
          setError("Documents are available in Electron.");
          return;
        }

        setStatus("Loading...");
        const document = await window.learner.readDocument(documentPath);

        if (!ignore) {
          editor.commands.setContent(document as JSONContent);
          setError("");
          setStatus("");
        }
      } catch (loadError) {
        if (!ignore) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load document.");
          setStatus("");
        }
      }
    }

    loadDocument();

    return () => {
      ignore = true;
    };
  }, [documentPath, editor]);

  async function saveDocument() {
    if (!editor || !documentPath) return;

    try {
      setStatus("Saving...");
      await window.learner?.saveDocument(documentPath, editor.getJSON() as TiptapDocument);
      setError("");
      setStatus("Saved");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save document.");
      setStatus("");
    }
  }

  if (!documentPath) {
    return <p className="text-sm text-white/50">Select or create a document.</p>;
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-medium">{documentPath}</h1>
          {(status || error) && (
            <p className={`text-xs ${error ? "text-red-300" : "text-white/50"}`}>{error || status}</p>
          )}
        </div>

        <button
          type="button"
          onClick={saveDocument}
          className="rounded-md bg-white px-3 py-1.5 text-sm text-black hover:bg-white/90"
        >
          Save
        </button>
      </div>

      <EditorContent editor={editor} />
    </section>
  );
}
