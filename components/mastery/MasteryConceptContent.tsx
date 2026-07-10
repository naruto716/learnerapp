"use client";

import RichMarkdown from "@/components/markdown/RichMarkdown";

const markdownClassName =
  "prose prose-invert max-w-none prose-p:my-2 prose-p:leading-7 prose-li:my-1 prose-ul:my-2 prose-ol:my-2 prose-strong:text-white/94 prose-table:text-sm prose-th:border-white/[0.12] prose-td:border-white/[0.1]";

function documentImageSrc(imagePath: string | null | undefined) {
  if (!imagePath) return "";
  if (/^(https?:|data:|blob:|learner:)/i.test(imagePath)) return imagePath;
  return `learner://documents/${imagePath
    .replace(/^\/+/, "")
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")}`;
}

export function MasteryMarkdown({ children, className = "" }: { children: string; className?: string }) {
  return <RichMarkdown className={`${markdownClassName} ${className}`.trim()}>{children}</RichMarkdown>;
}

export function MasteryConceptContent({ concept }: { concept: MasteryConcept }) {
  return (
    <div>
      <header>
        <h2 className="break-words text-[26px] font-semibold leading-8 text-white/94">{concept.name}</h2>
      </header>
      <section className="mt-5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-white/34">Explanation</p>
        <div className="mt-2 text-[15px] leading-7 text-white/88">
          <MasteryMarkdown>{concept.explanationMarkdown}</MasteryMarkdown>
        </div>
        <section className="mt-6">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-white/34">Source excerpt</p>
          <div className="mt-2 text-sm leading-6 text-white/82">
            <MasteryMarkdown>{concept.sourceExcerptMarkdown}</MasteryMarkdown>
          </div>
        </section>
      </section>
    </div>
  );
}

export function MasteryMetaphorContent({
  concept,
  metaphor,
}: {
  concept: MasteryConcept;
  metaphor: MasteryMetaphor;
}) {
  const scene = metaphor.conceptScenes.find((candidate) => candidate.conceptId === concept.id) ?? null;
  const imageSrc = documentImageSrc(scene?.imagePath || metaphor.imagePath);

  return (
    <div>
      {imageSrc && (
        <div className="aspect-[4/3] overflow-hidden rounded-lg bg-white/[0.04]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt={scene ? `${concept.name} metaphor scene` : `${metaphor.title} metaphor scene`}
            className="h-full w-full object-cover"
            src={imageSrc}
          />
        </div>
      )}
      <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-white/34">Metaphor</p>
      <h3 className="mt-1 text-base font-semibold leading-6 text-white/88">{metaphor.title}</h3>
      {metaphor.stale && (
        <p className="mt-2 rounded-md bg-amber-200/[0.08] px-2 py-1 text-xs text-amber-50/66">
          This metaphor predates the latest note or concept changes.
        </p>
      )}
      {scene ? (
        <>
          <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-white/34">{scene.roleName}</p>
          <MasteryMarkdown className="mt-1 text-sm leading-6 text-white/80">{scene.sceneMarkdown}</MasteryMarkdown>
          <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-white/34">Memory cue</p>
          <MasteryMarkdown className="mt-1 text-sm leading-6 text-white/74">{scene.visceralCueMarkdown}</MasteryMarkdown>
        </>
      ) : (
        <MasteryMarkdown className="mt-2 text-sm leading-6 text-white/78">{metaphor.memorySceneMarkdown}</MasteryMarkdown>
      )}
    </div>
  );
}
