"use client";

import {
  ArrowsClockwiseIcon,
  CardsThreeIcon,
  CrosshairIcon,
  EyeIcon,
  EyeSlashIcon,
  GridFourIcon,
  ImageIcon,
  SparkleIcon,
  SquaresFourIcon,
  TrashIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useCallback, useState, type ReactNode } from "react";
import MasteryCardCarousel from "./MasteryCardCarousel";
import MasteryCardGenerationDialog from "./MasteryCardGenerationDialog";
import { MasteryCardFrame, MasteryCardNavigation, masteryBottomFadeStyle } from "./MasteryCardLayout";
import { MasteryConceptContent, MasteryMetaphorContent } from "./MasteryConceptContent";
import MasteryFlashcards, { type FlashcardView } from "./MasteryFlashcards";
import { readMasterySettings, type MasteryScoringSettings } from "./masterySettings";

type MasteryPanelProps = {
  cardError: string | null;
  cardProgress: MasteryCardProgress | null;
  cardState: DocumentMasteryCards | null;
  error: string | null;
  isCardDiscussing: boolean;
  isCardEvaluating: boolean;
  isCardGenerating: boolean;
  isLoading: boolean;
  isMetaphorLoading: boolean;
  isSidebarOpen: boolean;
  mastery: DocumentMastery | null;
  metaphorProgress: MasteryMetaphorProgress | null;
  onClear: () => boolean | Promise<boolean>;
  onClearCards: () => boolean | Promise<boolean>;
  onClose: () => void;
  onContinueCardDiscussion: (cardId: number, message: string) => boolean | Promise<boolean>;
  onEvaluateCard: (cardId: number, answerMarkdown?: string) => boolean | Promise<boolean>;
  onGenerate: (force?: boolean) => boolean | Promise<boolean>;
  onGenerateCards: (preferences: MasteryCardPreferences) => boolean | Promise<boolean>;
  onGenerateMetaphor: () => boolean | Promise<boolean>;
  onMasteryScoreChange: (conceptId: number, score: number) => void | Promise<void>;
  open: boolean;
};

type MasteryViewMode = "overview" | "focus";
type MasterySection = "concepts" | "flashcards";

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

function SegmentedControl<T extends string>({
  disabled = false,
  options,
  onChange,
  value,
}: {
  disabled?: boolean;
  options: readonly { icon?: ReactNode; label: string; value: T }[];
  onChange: (value: T) => void;
  value: T;
}) {
  return (
    <div className="flex h-8 overflow-hidden rounded-md border border-white/[0.08] bg-white/[0.025]">
      {options.map((option) => (
        <button
          aria-label={option.label}
          aria-pressed={value === option.value}
          className={`flex h-8 items-center justify-center gap-1.5 text-xs transition first:border-r first:border-white/[0.08] [&>svg]:shrink-0 ${
            option.icon ? "w-8 px-0" : "px-3"
          } ${
            value === option.value
              ? "bg-white/[0.12] text-white/82"
              : "text-white/42 hover:bg-white/[0.055] hover:text-white/68"
          } disabled:pointer-events-none disabled:opacity-35`}
          disabled={disabled}
          key={option.value}
          onClick={() => onChange(option.value)}
          title={option.label}
          type="button"
        >
          {option.icon}
          {!option.icon && option.label}
        </button>
      ))}
    </div>
  );
}

function scoreLabel(score: number, thresholds: MasteryScoringSettings["thresholds"], hasEvidence = true) {
  if (!hasEvidence && score === 0) return "New";
  if (score >= thresholds.mastered) return "Mastered";
  if (score >= thresholds.advanced) return "Advanced";
  if (score >= thresholds.proficient) return "Proficient";
  if (score >= thresholds.developing) return "Developing";
  if (score >= thresholds.familiar) return "Familiar";
  return "New";
}

function MasteryLevelControl({
  concept,
  onChange,
  thresholds,
}: {
  concept: MasteryConcept;
  onChange: (conceptId: number, score: number) => void | Promise<void>;
  thresholds: MasteryScoringSettings["thresholds"];
}) {
  const [draftScore, setDraftScore] = useState(concept.overallScore);
  const hasEvidence = concept.stageStates.some((state) => state.attemptCount > 0);
  const masteryLabel = scoreLabel(draftScore, thresholds, hasEvidence);
  const rangeBackground = `linear-gradient(to right, rgba(255,255,255,0.72) 0%, rgba(255,255,255,0.72) ${draftScore}%, rgba(255,255,255,0.12) ${draftScore}%, rgba(255,255,255,0.12) 100%)`;

  const commitScore = (value: number) => {
    const nextScore = Math.max(0, Math.min(100, Math.round(value)));
    setDraftScore(nextScore);
    if (nextScore !== concept.overallScore) {
      void onChange(concept.id, nextScore);
    }
  };

  return (
    <div className="group relative w-full max-w-[310px] shrink-0">
      <div className="flex items-start justify-between gap-3 text-[11px] font-medium uppercase tracking-wide">
        <span className="shrink-0 whitespace-nowrap text-white/34">Mastery Level</span>

        <div className="relative min-w-0 flex-1">
          <input
            aria-label={`Set mastery level for ${concept.name}`}
            className="h-2 min-w-0 w-full cursor-pointer appearance-none rounded-full bg-white/[0.12] accent-white outline-none [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
            max={100}
            min={0}
            onBlur={(event) => commitScore(Number(event.currentTarget.value))}
            onChange={(event) => setDraftScore(Number(event.currentTarget.value))}
            onPointerUp={(event) => commitScore(Number(event.currentTarget.value))}
            step={1}
            style={{ background: rangeBackground }}
            type="range"
            value={draftScore}
          />

          <span
            className="pointer-events-none absolute top-full mt-1.5 -translate-x-1/2 whitespace-nowrap text-[10px] font-medium uppercase tracking-wide text-white/40"
            style={{ left: `clamp(12px, ${draftScore}%, calc(100% - 12px))` }}
          >
            {masteryLabel} · {draftScore}
          </span>
        </div>
      </div>
      <div className="pointer-events-none absolute right-0 top-full z-20 mt-2 hidden w-72 rounded-lg bg-[#101010] p-3 text-left text-xs leading-5 text-white/66 shadow-2xl ring-1 ring-white/[0.12] group-focus-within:block group-hover:block">
        <p className="font-medium text-white/82">Stage evidence</p>
        <p className="mt-1 text-white/58">
          {concept.stageStates.map((state) => `${state.stage}: ${Math.round(state.score)}`).join(" · ")}
        </p>
        {concept.masteryRationale && <p className="mt-2 text-white/58">{concept.masteryRationale}</p>}
      </div>
    </div>
  );
}

function ConceptOverviewView({
  activeIndex,
  concepts,
  onSelect,
  thresholds,
}: {
  activeIndex: number;
  concepts: MasteryConcept[];
  onSelect: (index: number) => void;
  thresholds: MasteryScoringSettings["thresholds"];
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
              <span>{scoreLabel(concept.overallScore, thresholds, concept.stageStates.some((state) => state.attemptCount > 0))}</span>
            </div>
            <p className="mt-3 line-clamp-2 text-base font-semibold leading-6 text-white/88">{concept.name}</p>
            <p className="mt-3 line-clamp-2 text-sm leading-5 text-white/46">{concept.type || "Concept"}</p>
            <div className="mt-4 h-1 overflow-hidden rounded-full bg-white/[0.08]">
              <div className="h-full rounded-full bg-white/45" style={{ width: `${concept.overallScore}%` }} />
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

function ConceptDeckCard({
  canNext,
  canPrevious,
  concept,
  conceptIndex,
  metaphor,
  onMasteryScoreChange,
  onNext,
  onPrevious,
  showMetaphor,
  thresholds,
  totalConcepts,
}: {
  canNext: boolean;
  canPrevious: boolean;
  concept: MasteryConcept;
  conceptIndex: number;
  metaphor: MasteryMetaphor | null;
  onMasteryScoreChange: (conceptId: number, score: number) => void | Promise<void>;
  onNext: () => void;
  onPrevious: () => void;
  showMetaphor: boolean;
  thresholds: MasteryScoringSettings["thresholds"];
  totalConcepts: number;
}) {
  const shouldShowMetaphor = showMetaphor && metaphor !== null;
  const cardWidthClassName = shouldShowMetaphor ? "max-w-[1040px]" : "max-w-[760px]";

  return (
    <MasteryCardFrame maxWidthClassName={cardWidthClassName}>
      <div className="mb-3 flex items-start justify-between gap-4">
        <div className="flex h-6 min-w-0 flex-wrap items-center gap-2">
          <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-white/38">
            {concept.type || "Concept"}
          </span>
        </div>
        <MasteryLevelControl
          concept={concept}
          key={`${concept.id}-${concept.overallScore}`}
          onChange={onMasteryScoreChange}
          thresholds={thresholds}
        />
      </div>

      {shouldShowMetaphor ? (
        <div className="min-h-0 flex-1 overflow-hidden grid grid-cols-[minmax(0,1fr)_minmax(280px,340px)] gap-5">
          <div className="min-h-0 overflow-y-auto py-3 pr-2" style={masteryBottomFadeStyle}>
            <MasteryConceptContent concept={concept} />
          </div>
          <aside className="h-full min-h-0 overflow-y-auto rounded-xl bg-black/18 p-3 pr-2" style={masteryBottomFadeStyle}>
            <MasteryMetaphorContent concept={concept} metaphor={metaphor} />
          </aside>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto py-3 pr-2" style={masteryBottomFadeStyle}>
          <MasteryConceptContent concept={concept} />
        </div>
      )}

      <MasteryCardNavigation
        canNext={canNext}
        canPrevious={canPrevious}
        current={conceptIndex + 1}
        next={onNext}
        previous={onPrevious}
        total={totalConcepts}
      />
    </MasteryCardFrame>
  );
}

function ConceptDeckCarousel({
  activeIndex,
  concepts,
  metaphor,
  onActiveIndexChange,
  onMasteryScoreChange,
  showMetaphor,
  thresholds,
}: {
  activeIndex: number;
  concepts: MasteryConcept[];
  metaphor: MasteryMetaphor | null;
  onActiveIndexChange: (index: number) => void;
  onMasteryScoreChange: (conceptId: number, score: number) => void | Promise<void>;
  showMetaphor: boolean;
  thresholds: MasteryScoringSettings["thresholds"];
}) {
  const shouldShowMetaphor = showMetaphor && metaphor !== null;

  return (
    <MasteryCardCarousel
      activeIndex={activeIndex}
      getKey={(concept) => concept.id}
      items={concepts}
      onActiveIndexChange={onActiveIndexChange}
      renderSlide={({ canNext, canPrevious, index, item, next, previous, total }) => (
        <ConceptDeckCard
          canNext={canNext}
          canPrevious={canPrevious}
          concept={item}
          conceptIndex={index}
          metaphor={metaphor}
          onMasteryScoreChange={onMasteryScoreChange}
          onNext={next}
          onPrevious={previous}
          showMetaphor={showMetaphor}
          thresholds={thresholds}
          totalConcepts={total}
        />
      )}
      slideBasis={shouldShowMetaphor ? "min(100%, 1100px)" : "min(100%, 820px)"}
    />
  );
}

export default function MasteryPanel({
  cardError,
  cardProgress,
  cardState,
  error,
  isCardDiscussing,
  isCardEvaluating,
  isCardGenerating,
  isLoading,
  isMetaphorLoading,
  isSidebarOpen,
  mastery,
  metaphorProgress,
  onClear,
  onClearCards,
  onClose,
  onContinueCardDiscussion,
  onEvaluateCard,
  onGenerate,
  onGenerateCards,
  onGenerateMetaphor,
  onMasteryScoreChange,
  open,
}: MasteryPanelProps) {
  const concepts = mastery?.concepts ?? [];
  const conceptCount = concepts.length;
  const hasConcepts = conceptCount > 0;
  const hasMetaphor = mastery?.metaphor !== null && mastery?.metaphor !== undefined;
  const metaphorIsStale = Boolean(mastery?.metaphor?.stale);
  const [activeIndex, setActiveIndex] = useState(0);
  const [cardGenerationOpen, setCardGenerationOpen] = useState(false);
  const [flashcardView, setFlashcardView] = useState<FlashcardView>("practice");
  const [section, setSection] = useState<MasterySection>("concepts");
  const [showMetaphor, setShowMetaphor] = useState(false);
  const [viewMode, setViewMode] = useState<MasteryViewMode>("focus");
  const masteryThresholds = readMasterySettings().thresholds;
  const safeActiveIndex = hasConcepts ? Math.min(activeIndex, conceptCount - 1) : 0;
  const cards = cardState?.cards ?? [];
  const readyCardCount = cards.filter((card) => card.status === "active").length;
  const laterCardCount = cards.filter((card) => card.status === "delayed").length;
  const completedCardCount = cards.filter((card) => card.status === "done").length;

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
      "Delete generated mastery concepts for this note? This also deletes their flashcards, attempts, weaknesses, stage progress, metaphor data, and generated mastery images.",
    );
    if (!confirmed) return;

    const cleared = await onClear();
    if (cleared) {
      setActiveIndex(0);
      setSection("concepts");
      setShowMetaphor(false);
      setViewMode("focus");
    }
  };

  const handleClose = () => {
    setCardGenerationOpen(false);
    onClose();
  };

  const handleClearCards = async () => {
    if (cards.length === 0 || isCardGenerating || isCardEvaluating) return;
    const confirmed = window.confirm("Delete all flashcards, attempts, weaknesses, and stage progress for this note?");
    if (confirmed) await onClearCards();
  };

  const selectOverviewConcept = (index: number) => {
    setFocusedConceptIndex(index);
    setViewMode("focus");
  };

  if (!open) return null;

  return (
    <section
      className={`app-no-drag fixed bottom-0 right-0 top-10 z-30 flex flex-col bg-[#171717]/90 text-white shadow-[0_30px_90px_rgba(0,0,0,0.5)] ring-1 ring-white/[0.08] backdrop-blur-[24px] ${isSidebarOpen ? "left-64" : "left-0"}`}
    >
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/[0.08] text-white/80">
            <SparkleIcon size={18} />
          </span>
          <p className="shrink-0 text-sm font-semibold">Mastery</p>
          <div className="flex shrink-0 rounded-full bg-white/[0.045] p-0.5 text-xs">
            {(["concepts", "flashcards"] as const).map((nextSection) => (
              <button
                className={`rounded-full px-3 py-1.5 capitalize ${
                  section === nextSection ? "bg-white/[0.11] text-white/82" : "text-white/42 hover:text-white/70"
                }`}
                key={nextSection}
                onClick={() => setSection(nextSection)}
                type="button"
              >
                {nextSection}
              </button>
            ))}
          </div>
          <p className="truncate text-xs text-white/42">
            {section === "flashcards"
              ? `${readyCardCount} ready · ${laterCardCount} later · ${completedCardCount} completed`
              : hasConcepts
                ? `${conceptCount} concept${conceptCount === 1 ? "" : "s"} · ${formatGeneratedAt(mastery?.generatedAt ?? null)}`
                : "Extract detailed mastery concepts"}
          </p>
          {mastery?.stale && (
            <span className="rounded-full bg-amber-200/10 px-2 py-1 text-[11px] font-medium text-amber-100/72">
              note changed
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {section === "concepts" && hasConcepts && (
            <SegmentedControl
              disabled={isLoading || isMetaphorLoading}
              onChange={setViewMode}
              options={[
                { icon: <SquaresFourIcon size={18} />, label: "Overview", value: "overview" },
                { icon: <CrosshairIcon size={18} />, label: "Focus", value: "focus" },
              ]}
              value={viewMode}
            />
          )}
          {section === "flashcards" && (
            <SegmentedControl
              disabled={isCardGenerating}
              onChange={setFlashcardView}
              options={[
                { icon: <GridFourIcon size={18} />, label: "Deck view", value: "deck" },
                { icon: <CardsThreeIcon size={18} />, label: "Practice view", value: "practice" },
              ]}
              value={flashcardView}
            />
          )}
          <span className="mx-1 h-5 w-px bg-white/[0.08]" />
          {section === "concepts" && (
            <>
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
            </>
          )}
          {section === "flashcards" && (
            <>
              <PanelIconButton
                ariaLabel={cards.length > 0 ? "Generate more cards" : "Generate cards"}
                disabled={isCardGenerating || !hasConcepts}
                icon={<ArrowsClockwiseIcon size={16} className={isCardGenerating ? "animate-spin" : ""} />}
                onClick={() => setCardGenerationOpen(true)}
              />
              <PanelIconButton
                ariaLabel="Clear cards and practice progress"
                disabled={cards.length === 0 || isCardGenerating || isCardEvaluating}
                icon={<TrashIcon size={16} />}
                onClick={() => {
                  void handleClearCards();
                }}
              />
            </>
          )}
          {section === "concepts" && hasMetaphor && (
            <PanelIconButton
              ariaLabel={showMetaphor ? "Hide metaphor" : "Show metaphor"}
              disabled={isMetaphorLoading}
              icon={showMetaphor ? <EyeSlashIcon size={16} /> : <EyeIcon size={16} />}
              onClick={() => setShowMetaphor((visible) => !visible)}
            />
          )}
          {section === "concepts" && (
            <PanelIconButton
              ariaLabel="Delete generated concepts"
              disabled={!hasConcepts || isLoading || isMetaphorLoading}
              icon={<TrashIcon size={16} />}
              onClick={() => {
                void handleClear();
              }}
            />
          )}
          <PanelIconButton ariaLabel="Close mastery" icon={<XIcon size={16} />} onClick={handleClose} tooltip="Close" />
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-5 pb-5">
        {(error || cardError) && (
          <div className="mb-4 rounded-lg bg-red-300/10 px-4 py-3 text-sm text-red-200">{error || cardError}</div>
        )}

        {section === "concepts" && isMetaphorLoading && metaphorProgress && <MasteryProgressStatus progress={metaphorProgress} />}

        {section === "concepts" && mastery?.stale && hasConcepts && (
          <div className="mb-4 flex items-start gap-3 rounded-xl bg-amber-200/[0.08] px-4 py-3 text-sm text-amber-50/74 ring-1 ring-amber-100/[0.12]">
            <WarningCircleIcon className="mt-0.5 shrink-0" size={18} />
            <div className="min-w-0">
              <p className="font-medium text-amber-50/88">This note changed since the last mastery generation.</p>
              <p className="mt-1 text-amber-50/58">Regenerate when you want the concepts to reflect the current note.</p>
            </div>
          </div>
        )}

        {section === "concepts" && metaphorIsStale && hasMetaphor && (
          <div className="mb-4 flex items-start gap-3 rounded-xl bg-amber-200/[0.07] px-4 py-3 text-sm text-amber-50/70 ring-1 ring-amber-100/[0.1]">
            <WarningCircleIcon className="mt-0.5 shrink-0" size={18} />
            <div className="min-w-0">
              <p className="font-medium text-amber-50/86">The metaphor is stale.</p>
              <p className="mt-1 text-amber-50/56">Regenerate metaphor images when you want them to match the current concepts.</p>
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
        ) : section === "flashcards" ? (
          <MasteryFlashcards
            cardState={cardState}
            concepts={concepts}
            isDiscussing={isCardDiscussing}
            isEvaluating={isCardEvaluating}
            isGenerating={isCardGenerating}
            metaphor={mastery?.metaphor ?? null}
            onContinueDiscussion={onContinueCardDiscussion}
            onEvaluate={onEvaluateCard}
            onOpenGeneration={() => setCardGenerationOpen(true)}
            onViewChange={setFlashcardView}
            progress={cardProgress}
            view={flashcardView}
          />
        ) : viewMode === "overview" ? (
          <div className="mx-auto min-h-0 w-full max-w-5xl flex-1 overflow-y-auto pb-1">
            <ConceptOverviewView
              activeIndex={safeActiveIndex}
              concepts={concepts}
              onSelect={selectOverviewConcept}
              thresholds={masteryThresholds}
            />
          </div>
        ) : hasConcepts ? (
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
            <ConceptDeckCarousel
              activeIndex={safeActiveIndex}
              concepts={concepts}
              metaphor={mastery?.metaphor ?? null}
              onActiveIndexChange={setFocusedConceptIndex}
              onMasteryScoreChange={onMasteryScoreChange}
              showMetaphor={showMetaphor}
              thresholds={masteryThresholds}
            />
          </div>
        ) : null}
      </div>

      {cardGenerationOpen && (
        <MasteryCardGenerationDialog
          hasCards={(cardState?.cards.length ?? 0) > 0}
          onClose={() => setCardGenerationOpen(false)}
          onGenerate={onGenerateCards}
          overlayClassName={`fixed bottom-0 right-0 top-10 ${isSidebarOpen ? "left-64" : "left-0"}`}
          preferences={cardState?.preferences ?? { generationPrompt: "", targetProficiency: "proficient" }}
        />
      )}
    </section>
  );
}
