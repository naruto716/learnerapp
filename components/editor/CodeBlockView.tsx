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

function cleanMermaidError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "Invalid Mermaid diagram.");
  return message
    .replace(/\s*mermaid version .*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isMermaidErrorSvg(svg: string) {
  return /Syntax error in text|(?:class|id)=["'][^"']*error-icon/i.test(svg);
}

function logMermaidFailure(stage: string, sourceCode: string, normalizedCode: string, error: unknown) {
  console.error("[Learner Mermaid]", stage, {
    error,
    sourceCode,
    normalizedCode,
  });
}

async function getMermaidParseError(
  mermaid: { parse: (code: string, options?: { suppressErrors?: boolean }) => Promise<unknown> },
  code: string,
) {
  try {
    await mermaid.parse(code, { suppressErrors: false });
    return "";
  } catch (error) {
    return cleanMermaidError(error) || "Mermaid parse failed.";
  }
}

function quoteFlowchartLabels(line: string) {
  return line.replace(/(\b[A-Za-z][\w-]*)\[([^\]\n"]+)\]/g, (_, id: string, label: string) => {
    const escapedLabel = label.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `${id}["${escapedLabel}"]`;
  });
}

function normalizeFlowchartEdgeLabels(line: string) {
  return line.replace(/\|(["'])(.*?)\1\|/g, (_match, _quote: string, label: string) => `|${label}|`);
}

function lineStartsSequenceStatement(line: string) {
  return /^(sequenceDiagram|participant\b|actor\b|autonumber\b|activate\b|deactivate\b|destroy\b|box\b|end\b|loop\b|alt\b|else\b|opt\b|par\b|and\b|rect\b|critical\b|break\b|Note\b|%%|[A-Za-z_][\w-]*\s*(?:-+>|-+>>|--x|--\)|-\)|->>|->|-->>|-->|x-|\)-))/.test(
    line.trim(),
  );
}

function normalizeSequenceDiagram(code: string) {
  const lines = code.split("\n");
  const normalizedLines: string[] = [];

  for (const line of lines) {
    const trimmedLine = line.trim();
    const previousLine = normalizedLines.at(-1);

    if (
      trimmedLine &&
      previousLine &&
      previousLine.includes(":") &&
      !lineStartsSequenceStatement(trimmedLine)
    ) {
      normalizedLines[normalizedLines.length - 1] = `${previousLine} ${trimmedLine}`;
      continue;
    }

    normalizedLines.push(line);
  }

  return normalizedLines.join("\n");
}

function normalizeMermaidCode(code: string) {
  const normalizedCode = code.replace(/\r\n/g, "\n").trim();
  const firstLine = normalizedCode.split("\n").find((line) => line.trim())?.trim() ?? "";

  if (/^(flowchart|graph)\b/.test(firstLine)) {
    return normalizedCode
      .split("\n")
      .map((line, index) =>
        index === 0 ? line : normalizeFlowchartEdgeLabels(quoteFlowchartLabels(line)),
      )
      .join("\n");
  }

  if (firstLine === "sequenceDiagram") {
    return normalizeSequenceDiagram(normalizedCode);
  }

  return normalizedCode;
}

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
        const normalizedCode = normalizeMermaidCode(code);
        const mermaid = (await import("mermaid")).default;

        mermaid.initialize({
          logLevel: "fatal",
          securityLevel: "strict",
          startOnLoad: false,
          suppressErrorRendering: true,
          theme: "dark",
        });

        const result = await mermaid.render(renderId, normalizedCode);

        if (!ignore) {
          if (isMermaidErrorSvg(result.svg)) {
            const parseError = await getMermaidParseError(mermaid, normalizedCode);
            logMermaidFailure("render returned Mermaid error SVG", code, normalizedCode, parseError);
            setSvg("");
            setError(parseError || "Mermaid render returned an error SVG after parsing.");
            return;
          }

          setSvg(result.svg);
          setError("");
        }
      } catch (renderError) {
        if (!ignore) {
          logMermaidFailure("render threw", code, normalizeMermaidCode(code), renderError);
          setSvg("");
          setError(cleanMermaidError(renderError) || "Mermaid syntax error.");
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
