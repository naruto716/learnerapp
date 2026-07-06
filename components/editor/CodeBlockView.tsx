"use client";

import type { ReactNodeViewProps } from "@tiptap/react";
import { NodeViewContent, NodeViewWrapper } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { useEffect, useId, useMemo, useState } from "react";

const languages = [
  { label: "Plain text", value: "" },
  { label: "JavaScript", value: "javascript" },
  { label: "TypeScript", value: "typescript" },
  { label: "JSX", value: "jsx" },
  { label: "TSX", value: "tsx" },
  { label: "JSON", value: "json" },
  { label: "HTML", value: "xml" },
  { label: "CSS", value: "css" },
  { label: "Bash", value: "bash" },
  { label: "Python", value: "python" },
  { label: "SQL", value: "sql" },
  { label: "Markdown", value: "markdown" },
  { label: "Mermaid", value: "mermaid" },
];

function MermaidPreview({ code }: { code: string }) {
  const [error, setError] = useState("");
  const [svg, setSvg] = useState("");
  const reactId = useId();
  const renderId = useMemo(() => `mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`, [reactId]);

  useEffect(() => {
    let ignore = false;

    async function renderDiagram() {
      if (!code.trim()) {
        setSvg("");
        setError("");
        return;
      }

      try {
        const mermaid = (await import("mermaid")).default;

        mermaid.initialize({
          securityLevel: "strict",
          startOnLoad: false,
          theme: "dark",
        });

        const result = await mermaid.render(renderId, code);

        if (!ignore) {
          setSvg(result.svg);
          setError("");
        }
      } catch (renderError) {
        if (!ignore) {
          setSvg("");
          setError(renderError instanceof Error ? renderError.message : "Failed to render Mermaid diagram.");
        }
      }
    }

    renderDiagram();

    return () => {
      ignore = true;
    };
  }, [code, renderId]);

  if (!code.trim()) return null;

  return (
    <div contentEditable={false} className="code-block-preview">
      {error ? (
        <pre className="code-block-preview-error">{error}</pre>
      ) : (
        <div className="mermaid-preview" dangerouslySetInnerHTML={{ __html: svg }} />
      )}
    </div>
  );
}

export default function CodeBlockView({ getPos, node, view }: ReactNodeViewProps) {
  const language = String(node.attrs.language ?? "");
  const code = node.textContent;
  const isMermaid = language === "mermaid";

  function updateLanguage(nextLanguage: string) {
    if (typeof getPos !== "function") return;

    const pos = getPos();
    if (typeof pos !== "number") return;

    const { state } = view;
    const tr = state.tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      language: nextLanguage || null,
    });

    tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1)));
    view.dispatch(tr);
    view.focus();
  }

  return (
    <NodeViewWrapper className="code-block-node">
      <div contentEditable={false} className="code-block-header">
        <select
          aria-label="Code language"
          className="code-block-language"
          value={language}
          onChange={(event) => {
            updateLanguage(event.target.value);
          }}
        >
          {languages.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {isMermaid && <MermaidPreview code={code} />}

      <pre>
        <NodeViewContent<"code"> as="code" className={language ? `language-${language}` : ""} />
      </pre>
    </NodeViewWrapper>
  );
}
