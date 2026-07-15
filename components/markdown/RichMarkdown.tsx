"use client";

import { Children, isValidElement, memo, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

function cleanMermaidError(error: unknown) {
  return (error instanceof Error ? error.message : String(error || "Invalid Mermaid diagram."))
    .replace(/\s*mermaid version .*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function MermaidDiagram({ code }: { code: string }) {
  const [error, setError] = useState("");
  const [svg, setSvg] = useState("");
  const reactId = useId();
  const renderId = useMemo(() => `rich-mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`, [reactId]);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          logLevel: "fatal",
          securityLevel: "strict",
          startOnLoad: false,
          suppressErrorRendering: true,
          theme: "dark",
        });
        await mermaid.parse(code, { suppressErrors: false });
        const result = await mermaid.render(renderId, code.trim());
        if (!cancelled) {
          setSvg(result.svg);
          setError("");
        }
      } catch (renderError) {
        if (!cancelled) {
          setSvg("");
          setError(cleanMermaidError(renderError) || "Mermaid syntax error.");
        }
      }
    }

    void render();
    return () => {
      cancelled = true;
    };
  }, [code, renderId]);

  if (error) {
    return <pre className="overflow-x-auto rounded-md bg-red-300/[0.08] p-3 text-xs text-red-100/72">{error}</pre>;
  }

  if (!svg) {
    return <div className="h-28 animate-pulse rounded-md bg-white/[0.04]" aria-label="Rendering diagram" />;
  }

  return (
    <div
      className="my-4 overflow-x-auto rounded-md bg-black/20 p-3 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

function MarkdownPre({ children }: { children?: ReactNode }) {
  const child = Children.count(children) === 1 ? Children.only(children) : null;
  if (isValidElement<{ children?: ReactNode; className?: string }>(child)) {
    const language = child.props.className?.match(/language-([^\s]+)/)?.[1];
    if (language === "mermaid") {
      return <MermaidDiagram code={String(child.props.children || "")} />;
    }
  }

  return <pre>{children}</pre>;
}

const RichMarkdown = memo(function RichMarkdown({
  children,
  className = "",
  components,
}: {
  children: string;
  className?: string;
  components?: Components;
}) {
  if (!children.trim()) return null;

  return (
    <div className={`learner-ai-markdown ${className}`.trim()}>
      <ReactMarkdown
        components={{
          ...components,
          pre: MarkdownPre,
        }}
        rehypePlugins={[rehypeKatex, rehypeHighlight]}
        remarkPlugins={[remarkGfm, remarkMath]}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
});

export default RichMarkdown;
