"use client";

import {
  ArrowsClockwiseIcon,
  CaretLeftIcon,
  CaretRightIcon,
  EyeIcon,
  EyeSlashIcon,
  ImageIcon,
  SparkleIcon,
  TrashIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from "react";
import type { EmblaCarouselType, EmblaOptionsType } from "embla-carousel";
import useEmblaCarousel from "embla-carousel-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type MasteryPanelProps = {
  error: string | null;
  isLoading: boolean;
  isMetaphorLoading: boolean;
  isSidebarOpen: boolean;
  mastery: DocumentMastery | null;
  metaphorProgress: MasteryMetaphorProgress | null;
  onClear: () => boolean | Promise<boolean>;
  onClose: () => void;
  onGenerate: (force?: boolean) => void;
  onGenerateMetaphor: () => boolean | Promise<boolean>;
  onMasteryLevelChange: (conceptId: number, masteryLevel: MasteryLevel) => void | Promise<void>;
  open: boolean;
};

type MasteryViewMode = "overview" | "focus";

const markdownClassName =
  "prose prose-invert max-w-none prose-p:my-2 prose-p:leading-7 prose-li:my-1 prose-ul:my-2 prose-ol:my-2 prose-strong:text-white/94 prose-table:text-sm prose-th:border-white/[0.12] prose-td:border-white/[0.1]";

const conceptViewContainerClassName = "mx-auto flex w-full max-w-[760px] items-center justify-end";

const masteryLevels: MasteryLevel[] = ["new", "familiar", "developing", "proficient", "advanced", "mastered"];

const masteryLevelMeta: Record<MasteryLevel, { description: string }> = {
  new: {
    description: "Captured from the note; no practice evidence yet.",
  },
  familiar: {
    description: "Recognizable after review, but recall is not reliable yet.",
  },
  developing: {
    description: "Some recall exists, with likely gaps or unstable timing.",
  },
  proficient: {
    description: "Solid enough for normal explanation and use.",
  },
  advanced: {
    description: "Strong enough for tradeoffs, edge cases, and connected ideas.",
  },
  mastered: {
    description: "Stable under delayed review and hard application.",
  },
};

const bottomFadeStyle: CSSProperties = {
  WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, black 18px, black calc(100% - 18px), transparent 100%)",
  maskImage: "linear-gradient(to bottom, transparent 0%, black 18px, black calc(100% - 18px), transparent 100%)",
};

function isCarouselInteractiveTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest("button, input, textarea, select, a, [data-carousel-ignore]"));
}

function documentImageSrc(imagePath: string | null | undefined) {
  if (!imagePath) return "";
  if (/^(https?:|data:|blob:|learner:)/i.test(imagePath)) return imagePath;
  return `learner://documents/${imagePath
    .replace(/^\/+/g, "")
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")}`;
}

function formatGeneratedAt(value: number | null) {
  if (!value) return "Not generated yet";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function PanelIconButton({
  ariaLabel,
  disabled = false,
  icon,
  onClick,
  tooltip = ariaLabel,
}: {
  ariaLabel: string;
  disabled?: boolean;
  icon: ReactNode;
  onClick: () => void;
  tooltip?: string;
}) {
  return (
    <div className="group relative">
      <button
        aria-label={ariaLabel}
        className="flex h-8 w-8 items-center justify-center rounded-full text-white/54 transition hover:bg-white/[0.08] hover:text-white/86 disabled:pointer-events-none disabled:text-white/22"
        disabled={disabled}
        onClick={onClick}
        title={tooltip}
        type="button"
      >
        {icon}
      </button>
      <div className="pointer-events-none absolute right-0 top-full z-40 mt-2 whitespace-nowrap rounded-md bg-black/80 px-2 py-1 text-xs font-medium text-white/72 opacity-0 shadow-lg ring-1 ring-white/[0.08] backdrop-blur-md transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        {tooltip}
      </div>
    </div>
  );
}

function ViewSwitcher({
  disabled = false,
  onChange,
  value,
}: {
  disabled?: boolean;
  onChange: (viewMode: MasteryViewMode) => void;
  value: MasteryViewMode;
}) {
  return (
    <div className="flex rounded-full bg-white/[0.055] p-0.5 text-xs">
      {(["overview", "focus"] as const).map((viewMode) => (
        <button
          className={`rounded-full px-3 py-1.5 ${value === viewMode ? "bg-white/[0.12] text-white/82" : "text-white/42 hover:text-white/68"
            } disabled:pointer-events-none disabled:opacity-35`}
          disabled={disabled}
          key={viewMode}
          onClick={() => onChange(viewMode)}
          type="button"
        >
          {viewMode === "overview" ? "Overview" : "Focus"}
        </button>
      ))}
    </div>
  );
}

function levelLabel(level: MasteryLevel) {
  return level.replace(/_/g, " ");
}

function levelIndex(level: MasteryLevel) {
  return Math.max(0, masteryLevels.indexOf(level));
}

function levelProgress(level: MasteryLevel) {
  return Math.round((levelIndex(level) / (masteryLevels.length - 1)) * 100);
}

function MasteryMarkdown({ children }: { children: string }) {
  if (!children.trim()) return null;

  return (
    <div className={markdownClassName}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}

function MasteryLevelControl({
  concept,
  onChange,
}: {
  concept: MasteryConcept;
  onChange: (conceptId: number, masteryLevel: MasteryLevel) => void | Promise<void>;
}) {
  const masteryMeta = masteryLevelMeta[concept.masteryLevel];
  const masteryLabel = levelLabel(concept.masteryLevel);
  const progress = levelProgress(concept.masteryLevel);
  const rangeBackground = `linear-gradient(to right, rgba(255,255,255,0.72) 0%, rgba(255,255,255,0.72) ${progress}%, rgba(255,255,255,0.12) ${progress}%, rgba(255,255,255,0.12) 100%)`;

  return (
    <div className="group relative w-full max-w-[310px] shrink-0">
      <div className="flex items-start justify-between gap-3 text-[11px] font-medium uppercase tracking-wide">
        <span className="shrink-0 whitespace-nowrap text-white/34">Mastery Level</span>

        <div className="relative min-w-0 flex-1">
          <input
            aria-label={`Set mastery level for ${concept.name}`}
            className="h-2 min-w-0 w-full cursor-pointer appearance-none rounded-full bg-white/[0.12] accent-white outline-none [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
            max={masteryLevels.length - 1}
            min={0}
            onChange={(event) => {
              const nextLevel = masteryLevels[Number(event.currentTarget.value)];
              if (nextLevel && nextLevel !== concept.masteryLevel) {
                void onChange(concept.id, nextLevel);
              }
            }}
            step={1}
            style={{ background: rangeBackground }}
            type="range"
            value={levelIndex(concept.masteryLevel)}
          />

          <span
            className="pointer-events-none absolute top-full mt-1.5 -translate-x-1/2 whitespace-nowrap text-[10px] font-medium uppercase tracking-wide text-white/40"
            style={{ left: `clamp(12px, ${progress}%, calc(100% - 12px))` }}
          >
            {masteryLabel}
          </span>
        </div>
      </div>
      <div className="pointer-events-none absolute right-0 top-full z-20 mt-2 hidden w-72 rounded-lg bg-[#101010] p-3 text-left text-xs leading-5 text-white/66 shadow-2xl ring-1 ring-white/[0.12] group-focus-within:block group-hover:block">
        <p className="font-medium text-white/82">{masteryMeta.description}</p>
        {concept.masteryRationale && <p className="mt-2 text-white/58">{concept.masteryRationale}</p>}
      </div>
    </div>
  );
}

function ConceptOverviewView({
  activeIndex,
  concepts,
  onSelect,
}: {
  activeIndex: number;
  concepts: MasteryConcept[];
  onSelect: (index: number) => void;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {concepts.map((concept, index) => {
        const active = index === activeIndex;

        return (
          <button
            aria-current={active ? "true" : undefined}
            className={`min-h-36 rounded-xl p-4 text-left transition ${active ? "bg-white/[0.075] text-white/86" : "bg-white/[0.035] text-white/58 hover:bg-white/[0.06] hover:text-white/76"
              }`}
            key={concept.id}
            onClick={() => onSelect(index)}
            type="button"
          >
            <div className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-wide text-white/38">
              <span>Concept {index + 1}</span>
              <span className="capitalize">{levelLabel(concept.masteryLevel)}</span>
            </div>
            <p className="mt-3 line-clamp-2 text-base font-semibold leading-6 text-white/88">{concept.name}</p>
            <p className="mt-3 line-clamp-2 text-sm leading-5 text-white/46">{concept.type || "Concept"}</p>
            <div className="mt-4 h-1 overflow-hidden rounded-full bg-white/[0.08]">
              <div className="h-full rounded-full bg-white/45" style={{ width: `${levelProgress(concept.masteryLevel)}%` }} />
            </div>
          </button>
        );
      })}
    </div>
  );
}

function MasteryProgressStatus({ progress }: { progress: MasteryMetaphorProgress }) {
  const total = Math.max(1, progress.total);
  const completed = Math.max(0, Math.min(total, progress.completed));
  const percentage = Math.round((completed / total) * 100);
  const countLabel =
    progress.phase === "planning" || progress.phase === "saving" || progress.phase === "done"
      ? progress.phase
      : `${completed}/${total}`;

  return (
    <div className="mb-4 text-xs text-white/48">
      <div className="flex items-center justify-between gap-4">
        <span className="min-w-0 truncate">{progress.label}</span>
        <span className="shrink-0 uppercase tracking-wide">
          {progress.failed > 0 ? `${countLabel} · ${progress.failed} failed` : countLabel}
        </span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.08]">
        <div className="h-full rounded-full bg-white/58 transition-[width] duration-200" style={{ width: `${percentage}%` }} />
      </div>
    </div>
  );
}

function conceptMetaphorScene(metaphor: MasteryMetaphor | null, conceptId: number) {
  return metaphor?.conceptScenes.find((scene) => scene.conceptId === conceptId) ?? null;
}

function MetaphorPanel({
  concept,
  metaphor,
}: {
  concept: MasteryConcept;
  metaphor: MasteryMetaphor;
}) {
  const scene = conceptMetaphorScene(metaphor, concept.id);
  const imageSrc = documentImageSrc(scene?.imagePath || metaphor.imagePath);

  return (
    <aside className="h-full min-h-0 overflow-y-auto rounded-xl bg-black/18 p-3 pr-2" style={bottomFadeStyle}>
      <div className="py-3">
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

        <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-white/34">Metaphor</p>
        <h3 className="mt-1 text-base font-semibold leading-6 text-white/88">{metaphor.title}</h3>

        {metaphor.stale && (
          <p className="mt-2 rounded-md bg-amber-200/[0.08] px-2 py-1 text-xs text-amber-50/66">
            This metaphor was generated before the latest note or concept changes.
          </p>
        )}

        {scene ? (
          <>
            <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-white/34">{scene.roleName}</p>
            <div className="mt-1 text-sm leading-6 text-white/80">
              <MasteryMarkdown>{scene.sceneMarkdown}</MasteryMarkdown>
            </div>
            <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-white/34">Memory cue</p>
            <div className="mt-1 text-sm leading-6 text-white/74">
              <MasteryMarkdown>{scene.visceralCueMarkdown}</MasteryMarkdown>
            </div>
          </>
        ) : (
          <div className="mt-2 text-sm leading-6 text-white/78">
            <MasteryMarkdown>{metaphor.memorySceneMarkdown}</MasteryMarkdown>
          </div>
        )}
      </div>
    </aside>
  );
}

function ConceptDeckCard({
  canNext,
  canPrevious,
  concept,
  conceptIndex,
  metaphor,
  onMasteryLevelChange,
  onNext,
  onPrevious,
  showMetaphor,
  totalConcepts,
}: {
  canNext: boolean;
  canPrevious: boolean;
  concept: MasteryConcept;
  conceptIndex: number;
  metaphor: MasteryMetaphor | null;
  onMasteryLevelChange: (conceptId: number, masteryLevel: MasteryLevel) => void | Promise<void>;
  onNext: () => void;
  onPrevious: () => void;
  showMetaphor: boolean;
  totalConcepts: number;
}) {
  const shouldShowMetaphor = showMetaphor && metaphor !== null;
  const cardWidthClassName = shouldShowMetaphor ? "max-w-[1040px]" : "max-w-[760px]";
  const topMetaRow = (
    <div className="mb-3 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex h-6 flex-wrap items-center gap-2">
          <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-white/38">
            {concept.type || "Concept"}
          </span>
          <span className="text-xs text-white/34">
            {conceptIndex + 1} / {totalConcepts}
          </span>
        </div>
      </div>

      <MasteryLevelControl concept={concept} onChange={onMasteryLevelChange} />
    </div>
  );
  const headerBlock = (
    <header className="shrink-0">
      <h2 className="break-words text-[26px] font-semibold leading-8 text-white/94">{concept.name}</h2>
    </header>
  );
  const conceptContentBlock = (
    <section className="mt-5 min-h-0 flex-1 overflow-y-auto py-3 pr-2" style={bottomFadeStyle}>
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
  );

  return (
    <article
      className={`mx-auto flex h-[min(640px,calc(100vh-190px))] min-h-[460px] w-full ${cardWidthClassName} flex-col rounded-2xl bg-[#202020]/94 p-5 shadow-[0_18px_52px_rgba(0,0,0,0.22)] ring-1 ring-white/[0.08]`}
    >
      {topMetaRow}

      {shouldShowMetaphor ? (
        <div className="min-h-0 flex-1 overflow-hidden grid grid-cols-[minmax(0,1fr)_minmax(280px,340px)] gap-5">
          <div className="min-h-0 overflow-hidden flex flex-col">
            {headerBlock}
            {conceptContentBlock}
          </div>
          <div className="h-full min-h-0">
            <MetaphorPanel concept={concept} metaphor={metaphor} />
          </div>
        </div>
      ) : (
        <>
          {headerBlock}
          {conceptContentBlock}
        </>
      )}

      <footer className="mt-4 shrink-0">
        <div className="flex items-center justify-between gap-4">
          <button
            className="inline-flex h-9 items-center gap-2 rounded-full px-3 text-sm font-medium text-white/68 hover:bg-white/[0.07] hover:text-white/90 disabled:pointer-events-none disabled:opacity-30"
            disabled={!canPrevious}
            onClick={onPrevious}
            type="button"
          >
            <CaretLeftIcon size={16} />
            Back
          </button>
          <button
            className="inline-flex h-9 items-center gap-2 rounded-full px-3 text-sm font-medium text-white/68 hover:bg-white/[0.07] hover:text-white/90 disabled:pointer-events-none disabled:opacity-30"
            disabled={!canNext}
            onClick={onNext}
            type="button"
          >
            Next
            <CaretRightIcon size={16} />
          </button>
        </div>
      </footer>
    </article>
  );
}

function ConceptDeckCarousel({
  activeIndex,
  concepts,
  metaphor,
  onActiveIndexChange,
  onMasteryLevelChange,
  showMetaphor,
}: {
  activeIndex: number;
  concepts: MasteryConcept[];
  metaphor: MasteryMetaphor | null;
  onActiveIndexChange: (index: number) => void;
  onMasteryLevelChange: (conceptId: number, masteryLevel: MasteryLevel) => void | Promise<void>;
  showMetaphor: boolean;
}) {
  const wheelLockRef = useRef(0);
  const emblaOptions = useMemo<EmblaOptionsType>(
    () => ({
      align: "center",
      containScroll: "trimSnaps",
      dragFree: false,
      dragThreshold: 18,
      duration: 28,
      loop: false,
      skipSnaps: false,
      watchDrag: (_emblaApi, event) => !isCarouselInteractiveTarget(event.target),
    }),
    [],
  );
  const [emblaRef, emblaApi] = useEmblaCarousel(emblaOptions);
  const conceptCount = concepts.length;
  const safeActiveIndex = conceptCount > 0 ? Math.min(activeIndex, conceptCount - 1) : 0;
  const shouldShowMetaphor = showMetaphor && metaphor !== null;
  const slideBasis = shouldShowMetaphor ? "min(100%, 1100px)" : "min(100%, 820px)";

  useEffect(() => {
    if (!emblaApi) return;

    const syncSelectedIndex = (api: EmblaCarouselType) => {
      const selectedIndex = api.selectedScrollSnap();
      const delta = selectedIndex - safeActiveIndex;

      if (Math.abs(delta) > 1) {
        api.scrollTo(safeActiveIndex + Math.sign(delta));
        return;
      }

      onActiveIndexChange(selectedIndex);
    };

    const handleSelect = () => syncSelectedIndex(emblaApi);

    emblaApi.on("select", handleSelect);
    emblaApi.on("reInit", handleSelect);

    return () => {
      emblaApi.off("select", handleSelect);
      emblaApi.off("reInit", handleSelect);
    };
  }, [emblaApi, onActiveIndexChange, safeActiveIndex]);

  useEffect(() => {
    if (!emblaApi || conceptCount === 0) return;
    if (emblaApi.selectedScrollSnap() !== safeActiveIndex) {
      emblaApi.scrollTo(safeActiveIndex);
    }
  }, [conceptCount, emblaApi, safeActiveIndex]);

  const showPrevious = () => {
    emblaApi?.scrollPrev();
  };

  const showNext = () => {
    emblaApi?.scrollNext();
  };

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!emblaApi || isCarouselInteractiveTarget(event.target)) return;

    const horizontalSwipe = Math.abs(event.deltaX) > 24 && Math.abs(event.deltaX) > Math.abs(event.deltaY) * 1.2;
    if (!horizontalSwipe) return;

    event.preventDefault();

    const now = Date.now();
    if (now - wheelLockRef.current < 520) return;
    wheelLockRef.current = now;

    if (event.deltaX > 0) {
      emblaApi.scrollNext();
    } else {
      emblaApi.scrollPrev();
    }
  };

  return (
    <div className="min-h-0 w-full overflow-hidden" onWheel={handleWheel} ref={emblaRef}>
      <div className="flex min-h-0 touch-pan-y gap-4">
        {concepts.map((concept, index) => {
          const active = index === safeActiveIndex;

          return (
            <div
              aria-hidden={!active}
              className={`min-w-0 shrink-0 grow-0 transition-[opacity,transform] duration-200 ${
                active ? "scale-100 opacity-100" : "pointer-events-none scale-[0.96] opacity-45"
              }`}
              key={concept.id}
              style={{ flexBasis: slideBasis }}
            >
              <ConceptDeckCard
                canNext={index < conceptCount - 1}
                canPrevious={index > 0}
                concept={concept}
                conceptIndex={index}
                metaphor={metaphor}
                onMasteryLevelChange={onMasteryLevelChange}
                onNext={showNext}
                onPrevious={showPrevious}
                showMetaphor={showMetaphor}
                totalConcepts={conceptCount}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function MasteryPanel({
  error,
  isLoading,
  isMetaphorLoading,
  isSidebarOpen,
  mastery,
  metaphorProgress,
  onClear,
  onClose,
  onGenerate,
  onGenerateMetaphor,
  onMasteryLevelChange,
  open,
}: MasteryPanelProps) {
  const concepts = mastery?.concepts ?? [];
  const conceptCount = concepts.length;
  const hasConcepts = conceptCount > 0;
  const hasMetaphor = mastery?.metaphor !== null && mastery?.metaphor !== undefined;
  const metaphorIsStale = Boolean(mastery?.metaphor?.stale);
  const [activeIndex, setActiveIndex] = useState(0);
  const [showMetaphor, setShowMetaphor] = useState(false);
  const [viewMode, setViewMode] = useState<MasteryViewMode>("focus");
  const safeActiveIndex = hasConcepts ? Math.min(activeIndex, conceptCount - 1) : 0;
  const conceptToolbarClassName =
    viewMode === "overview"
      ? "mx-auto flex w-full max-w-5xl items-center justify-end"
      : showMetaphor && hasMetaphor
        ? "mx-auto flex w-full max-w-[1040px] items-center justify-end"
        : conceptViewContainerClassName;

  const setFocusedConceptIndex = useCallback((index: number) => {
    if (!hasConcepts) return;
    setActiveIndex(Math.max(0, Math.min(conceptCount - 1, index)));
  }, [conceptCount, hasConcepts]);

  const handleGenerateMetaphor = async () => {
    const generated = await onGenerateMetaphor();
    if (generated) {
      setShowMetaphor(true);
    }
  };

  const handleClear = async () => {
    if (!hasConcepts || isLoading || isMetaphorLoading) return;
    const confirmed = window.confirm(
      "Delete generated mastery concepts for this note? This also deletes metaphor data and generated mastery images.",
    );
    if (!confirmed) return;

    const cleared = await onClear();
    if (cleared) {
      setActiveIndex(0);
      setShowMetaphor(false);
      setViewMode("focus");
    }
  };

  const selectOverviewConcept = (index: number) => {
    setFocusedConceptIndex(index);
    setViewMode("focus");
  };

  return (
    <section
      aria-hidden={!open}
      className={`app-no-drag fixed bottom-0 right-0 top-10 z-30 flex flex-col bg-[#171717]/90 text-white shadow-[0_30px_90px_rgba(0,0,0,0.5)] ring-1 ring-white/[0.08] backdrop-blur-[24px] transition-all duration-200 ${open ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0"
        } ${isSidebarOpen ? "left-64" : "left-0"}`}
    >
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/[0.08] text-white/80">
            <SparkleIcon size={18} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">Mastery</p>
            <p className="truncate text-xs text-white/42">
              {hasConcepts
                ? `${conceptCount} concept${conceptCount === 1 ? "" : "s"} - ${formatGeneratedAt(mastery?.generatedAt ?? null)}`
                : "Extract detailed mastery concepts"}
            </p>
          </div>
          {mastery?.stale && (
            <span className="rounded-full bg-amber-200/10 px-2 py-1 text-[11px] font-medium text-amber-100/72">
              note changed
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <PanelIconButton
            ariaLabel={hasConcepts ? "Regenerate concepts" : "Generate concepts"}
            disabled={isLoading || isMetaphorLoading}
            icon={<ArrowsClockwiseIcon size={16} className={isLoading ? "animate-spin" : ""} />}
            onClick={() => onGenerate(hasConcepts)}
          />
          <PanelIconButton
            ariaLabel={hasMetaphor ? "Regenerate metaphor images" : "Generate metaphor images"}
            disabled={!hasConcepts || isLoading || isMetaphorLoading}
            icon={<ImageIcon size={16} className={isMetaphorLoading ? "animate-pulse" : ""} />}
            onClick={() => {
              void handleGenerateMetaphor();
            }}
            tooltip={
              !hasConcepts
                ? "Extract concepts first"
                : hasMetaphor
                  ? "Regenerate metaphor images"
                  : "Generate metaphor images"
            }
          />
          {hasMetaphor && (
            <PanelIconButton
              ariaLabel={showMetaphor ? "Hide metaphor" : "Show metaphor"}
              disabled={isMetaphorLoading}
              icon={showMetaphor ? <EyeSlashIcon size={16} /> : <EyeIcon size={16} />}
              onClick={() => setShowMetaphor((visible) => !visible)}
            />
          )}
          <PanelIconButton
            ariaLabel="Delete generated concepts"
            disabled={!hasConcepts || isLoading || isMetaphorLoading}
            icon={<TrashIcon size={16} />}
            onClick={() => {
              void handleClear();
            }}
          />
          <PanelIconButton ariaLabel="Close mastery" icon={<XIcon size={16} />} onClick={onClose} tooltip="Close" />
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-5 pb-5">
        {error && <div className="mb-4 rounded-xl bg-red-300/10 px-4 py-3 text-sm text-red-200">{error}</div>}

        {isMetaphorLoading && metaphorProgress && <MasteryProgressStatus progress={metaphorProgress} />}

        {mastery?.stale && hasConcepts && (
          <div className="mb-4 flex items-start gap-3 rounded-xl bg-amber-200/[0.08] px-4 py-3 text-sm text-amber-50/74 ring-1 ring-amber-100/[0.12]">
            <WarningCircleIcon className="mt-0.5 shrink-0" size={18} />
            <div className="min-w-0">
              <p className="font-medium text-amber-50/88">This note changed since the last mastery generation.</p>
              <p className="mt-1 text-amber-50/58">Regenerate when you want the concepts to reflect the current note.</p>
            </div>
          </div>
        )}

        {metaphorIsStale && hasMetaphor && (
          <div className="mb-4 flex items-start gap-3 rounded-xl bg-amber-200/[0.07] px-4 py-3 text-sm text-amber-50/70 ring-1 ring-amber-100/[0.1]">
            <WarningCircleIcon className="mt-0.5 shrink-0" size={18} />
            <div className="min-w-0">
              <p className="font-medium text-amber-50/86">The metaphor is stale.</p>
              <p className="mt-1 text-amber-50/56">Regenerate metaphor images when you want them to match the current concepts.</p>
            </div>
          </div>
        )}

        {hasConcepts && (
          <div className="mb-3 shrink-0">
            <div className={conceptToolbarClassName}>
              <ViewSwitcher disabled={isLoading || isMetaphorLoading} onChange={setViewMode} value={viewMode} />
            </div>
          </div>
        )}

        {isLoading && !hasConcepts ? (
          <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-white/45">
            Extracting mastery concepts...
          </div>
        ) : !hasConcepts ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-center">
            <p className="text-sm text-white/52">No mastery concepts extracted yet.</p>
            <button
              className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-black transition hover:bg-white/88 disabled:opacity-45"
              disabled={isLoading}
              onClick={() => onGenerate(false)}
              type="button"
            >
              Generate mastery concepts
            </button>
          </div>
        ) : viewMode === "overview" ? (
          <div className="mx-auto min-h-0 w-full max-w-5xl flex-1 overflow-y-auto pb-1">
            <ConceptOverviewView activeIndex={safeActiveIndex} concepts={concepts} onSelect={selectOverviewConcept} />
          </div>
        ) : hasConcepts ? (
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
            <ConceptDeckCarousel
              activeIndex={safeActiveIndex}
              concepts={concepts}
              metaphor={mastery?.metaphor ?? null}
              onActiveIndexChange={setFocusedConceptIndex}
              onMasteryLevelChange={onMasteryLevelChange}
              showMetaphor={showMetaphor}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}
