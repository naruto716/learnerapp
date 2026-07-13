"use client";

import {
  ArrowsClockwiseIcon,
  CheckIcon,
  ClockCounterClockwiseIcon,
  CrosshairIcon,
  EyeIcon,
  EyeSlashIcon,
  ImageIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  SparkleIcon,
  SquaresFourIcon,
  TrashIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { AgentForegroundContext } from "@/components/ai/agentForegroundContext";
import MasteryCardCarousel from "./MasteryCardCarousel";
import MasteryCardGenerationDialog from "./MasteryCardGenerationDialog";
import { MasteryCardFrame, MasteryCardNavigation, masteryBottomFadeStyle } from "./MasteryCardLayout";
import { MasteryConceptContent, MasteryMetaphorContent } from "./MasteryConceptContent";
import PracticeHistoryDialog from "./PracticeHistoryDialog";
import MasteryPracticeWorkspace, {
  type FlashcardView,
  type MasteryPracticeWorkspaceHandle,
} from "./MasteryPracticeWorkspace";
import { readMasterySettings, type MasteryScoringSettings } from "./masterySettings";

type MasteryPanelProps = {
  activeDocumentPath: string | null;
  cardError: string | null;
  cardProgress: MasteryCardProgress | null;
  cardState: DocumentMasteryCards | null;
  error: string | null;
  isCardGenerating: boolean;
  isLoading: boolean;
  isMetaphorLoading: boolean;
  isSidebarOpen: boolean;
  mastery: DocumentMastery | null;
  metaphorProgress: MasteryMetaphorProgress | null;
  onClear: () => boolean | Promise<boolean>;
  onClearCards: () => boolean | Promise<boolean>;
  onClose: () => void;
  onGenerate: (force?: boolean) => boolean | Promise<boolean>;
  onGenerateCards: (preferences: MasteryCardPreferences) => boolean | Promise<boolean>;
  onGenerateMetaphor: () => boolean | Promise<boolean>;
  onForegroundContextChange?: (context: AgentForegroundContext | null) => void;
  onPracticeChanged: () => Promise<unknown>;
  onMasteryScoreChange: (conceptId: number, score: number) => void | Promise<void>;
  readCurrentDocumentMarkdown: () => string;
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

function formatPracticeDate(value: number) {
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
  onOpenHistory,
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
  onOpenHistory: (concept: MasteryConcept) => void;
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
          <button
            aria-label={`Show practice history for ${concept.name}`}
            className="flex h-6 w-6 items-center justify-center rounded-md text-white/34 transition hover:bg-white/[0.07] hover:text-white/72"
            onClick={() => onOpenHistory(concept)}
            title="Practice history"
            type="button"
          >
            <ClockCounterClockwiseIcon size={14} />
          </button>
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
  onOpenHistory,
  showMetaphor,
  thresholds,
}: {
  activeIndex: number;
  concepts: MasteryConcept[];
  metaphor: MasteryMetaphor | null;
  onActiveIndexChange: (index: number) => void;
  onMasteryScoreChange: (conceptId: number, score: number) => void | Promise<void>;
  onOpenHistory: (concept: MasteryConcept) => void;
  showMetaphor: boolean;
  thresholds: MasteryScoringSettings["thresholds"];
}) {
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
          onOpenHistory={onOpenHistory}
          onPrevious={previous}
          showMetaphor={showMetaphor}
          thresholds={thresholds}
          totalConcepts={total}
        />
      )}
    />
  );
}

export default function MasteryPanel({
  activeDocumentPath,
  cardError,
  cardProgress,
  cardState,
  error,
  isCardGenerating,
  isLoading,
  isMetaphorLoading,
  isSidebarOpen,
  mastery,
  metaphorProgress,
  onClear,
  onClearCards,
  onClose,
  onGenerate,
  onGenerateCards,
  onGenerateMetaphor,
  onForegroundContextChange,
  onPracticeChanged,
  onMasteryScoreChange,
  readCurrentDocumentMarkdown,
  open,
}: MasteryPanelProps) {
  const concepts = useMemo(() => mastery?.concepts ?? [], [mastery?.concepts]);
  const conceptCount = concepts.length;
  const hasConcepts = conceptCount > 0;
  const hasMetaphor = mastery?.metaphor !== null && mastery?.metaphor !== undefined;
  const metaphorIsStale = Boolean(mastery?.metaphor?.stale);
  const [activeIndex, setActiveIndex] = useState(0);
  const [cardGenerationOpen, setCardGenerationOpen] = useState(false);
  const [flashcardView, setFlashcardView] = useState<FlashcardView>("deck");
  const [historyError, setHistoryError] = useState("");
  const [historyDeletingId, setHistoryDeletingId] = useState<number | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyMenuOpen, setHistoryMenuOpen] = useState(false);
  const [practiceHistory, setPracticeHistory] = useState<MasteryPracticeSessionSummary[]>([]);
  const [historyConcept, setHistoryConcept] = useState<MasteryConcept | null>(null);
  const [hasResumablePractice, setHasResumablePractice] = useState(false);
  const [practiceResultsOpen, setPracticeResultsOpen] = useState(false);
  const [practiceStarting, setPracticeStarting] = useState(false);
  const [section, setSection] = useState<MasterySection>("concepts");
  const [showMetaphor, setShowMetaphor] = useState(hasMetaphor);
  const [viewMode, setViewMode] = useState<MasteryViewMode>("focus");
  const masteryThresholds = readMasterySettings().thresholds;
  const safeActiveIndex = hasConcepts ? Math.min(activeIndex, conceptCount - 1) : 0;
  const cards = cardState?.cards ?? [];
  const readyCardCount = cards.filter((card) => card.status === "active").length;
  const laterCardCount = cards.filter((card) => card.status === "delayed").length;
  const completedCardCount = cards.filter((card) => card.status === "done").length;
  const practiceWorkspaceRef = useRef<MasteryPracticeWorkspaceHandle>(null);
  const practiceOpen = flashcardView === "practice";

  useEffect(() => {
    if (error) toast.error(error, { id: "mastery-error" });
  }, [error]);

  useEffect(() => {
    if (cardError) toast.error(cardError, { id: "mastery-card-error" });
  }, [cardError]);

  useEffect(() => {
    if (!open || section !== "concepts" || viewMode !== "focus" || !activeDocumentPath) {
      return;
    }
    const concept = concepts[safeActiveIndex];
    if (!concept) return;
    onForegroundContextChange?.({
      concept,
      documentPath: activeDocumentPath,
      key: `concept:${activeDocumentPath}:${concept.id}`,
      kind: "concept",
      label: concept.name,
      metaphorScene: mastery?.metaphor?.conceptScenes.find((scene) => scene.conceptId === concept.id) ?? null,
    });
    return () => onForegroundContextChange?.(null);
  }, [activeDocumentPath, concepts, mastery?.metaphor, onForegroundContextChange, open, safeActiveIndex, section, viewMode]);

  const setFocusedConceptIndex = useCallback((index: number) => {
    if (!hasConcepts) return;
    setActiveIndex(Math.max(0, Math.min(conceptCount - 1, index)));
  }, [conceptCount, hasConcepts]);

  const selectSection = (nextSection: MasterySection) => {
    setSection(nextSection);
    if (nextSection === "flashcards") setFlashcardView("deck");
  };

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
    setHistoryMenuOpen(false);
    onClose();
  };

  const toggleHistoryMenu = async () => {
    if (historyMenuOpen) {
      setHistoryMenuOpen(false);
      return;
    }
    setHistoryMenuOpen(true);
    setHistoryError("");
    if (!activeDocumentPath) return;
    setHistoryLoading(true);
    try {
      const sessions = await window.learner?.listMasteryPracticeSessions(activeDocumentPath);
      setPracticeHistory(sessions ?? []);
    } catch (loadError) {
      setHistoryError(loadError instanceof Error ? loadError.message : "Could not load practice history.");
    } finally {
      setHistoryLoading(false);
    }
  };

  const deleteHistorySession = async (practice: MasteryPracticeSessionSummary) => {
    if (!activeDocumentPath || historyDeletingId !== null) return;
    const confirmed = window.confirm(
      `Delete the ${formatPracticeDate(practice.createdAt)} practice session and its saved answers and grading history?`,
    );
    if (!confirmed) return;
    setHistoryError("");
    setHistoryDeletingId(practice.id);
    try {
      const sessions = await window.learner?.deleteMasteryPracticeSession({
        documentPath: activeDocumentPath,
        sessionId: practice.id,
      });
      setPracticeHistory(sessions ?? []);
      practiceWorkspaceRef.current?.removePracticeSession(practice.id);
      setHasResumablePractice(Boolean(sessions?.some((candidate) => candidate.status === "active")));
    } catch (deleteError) {
      setHistoryError(deleteError instanceof Error ? deleteError.message : "Could not delete this practice session.");
    } finally {
      setHistoryDeletingId(null);
    }
  };

  const handleClearCards = async () => {
    if (cards.length === 0 || isCardGenerating) return;
    const confirmed = window.confirm(
      "Delete the shared flashcard deck, attempts, weaknesses, and stage progress for this note? Saved practice history will remain available.",
    );
    if (confirmed) await onClearCards();
  };

  const selectOverviewConcept = (index: number) => {
    setFocusedConceptIndex(index);
    setViewMode("focus");
  };

  if (!open) return null;

  return (
    <section
      className={`app-no-drag fixed bottom-0 right-0 top-10 z-30 flex flex-col bg-[#171717] text-white shadow-[0_30px_90px_rgba(0,0,0,0.5)] ring-1 ring-white/[0.08] [--results-sticky-bg:#171717] ${isSidebarOpen ? "left-64" : "left-0"}`}
    >
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/[0.08] text-white/80">
            <SparkleIcon size={18} />
          </span>
          <p className="hidden shrink-0 text-sm font-semibold md:block">Mastery</p>
          <div className="flex shrink-0 rounded-full bg-white/[0.045] p-0.5 text-xs">
            {(["concepts", "flashcards"] as const).map((nextSection) => (
              <button
                className={`rounded-full px-3 py-1.5 capitalize ${
                  section === nextSection ? "bg-white/[0.11] text-white/82" : "text-white/42 hover:text-white/70"
                }`}
                key={nextSection}
                onClick={() => selectSection(nextSection)}
                type="button"
              >
                {nextSection}
              </button>
            ))}
          </div>
          <p className="hidden truncate text-xs text-white/42 2xl:block">
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

        {section === "flashcards" ? (
          <div className="flex items-center gap-2">
            <button
              aria-label={practiceOpen
                ? practiceResultsOpen ? "Finish practice" : "Pause practice"
                : hasResumablePractice ? "Resume practice" : "Practice"}
              className={`flex h-8 w-8 items-center justify-center gap-2 rounded-md text-sm font-semibold transition disabled:opacity-35 md:w-auto md:px-3 ${
                practiceOpen
                  ? "bg-white/[0.07] text-white/68 hover:bg-white/[0.11] hover:text-white/86"
                  : "bg-white text-black hover:bg-white/88"
              }`}
              disabled={!practiceOpen && (isCardGenerating || practiceStarting)}
              onClick={() => {
                if (practiceOpen) {
                  setFlashcardView("deck");
                  return;
                }
                void practiceWorkspaceRef.current?.startPractice();
              }}
              title={practiceOpen
                ? practiceResultsOpen ? "Finish" : "Pause"
                : hasResumablePractice ? "Resume" : "Practice"}
              type="button"
            >
              {practiceOpen
                ? practiceResultsOpen
                  ? <CheckIcon size={15} weight="bold" />
                  : <PauseIcon size={15} weight="fill" />
                : practiceStarting
                  ? <ArrowsClockwiseIcon className="animate-spin" size={15} />
                  : <PlayIcon size={15} weight="fill" />}
              <span className="hidden md:inline">
                {practiceOpen
                  ? practiceResultsOpen ? "Finish" : "Pause"
                  : hasResumablePractice ? "Resume" : "Practice"}
              </span>
            </button>

            <div className="flex items-center gap-2">
              <PanelIconButton
                ariaLabel={cards.length > 0 ? "Generate more cards" : "Generate cards"}
                disabled={isCardGenerating || !hasConcepts}
                icon={<PlusIcon size={17} weight="bold" />}
                onClick={() => setCardGenerationOpen(true)}
              />
              <div className="relative">
                <button
                  aria-expanded={historyMenuOpen}
                  aria-haspopup="menu"
                  aria-label="Practice history"
                  className="flex h-8 w-8 items-center justify-center rounded-full text-white/54 transition hover:bg-white/[0.08] hover:text-white/86"
                  onClick={() => {
                    void toggleHistoryMenu();
                  }}
                  title="Practice history"
                  type="button"
                >
                  <ClockCounterClockwiseIcon size={17} />
                </button>
                {historyMenuOpen && (
                  <>
                    <button
                      aria-label="Close practice history"
                      className="fixed inset-0 z-40 cursor-default"
                      onClick={() => setHistoryMenuOpen(false)}
                      type="button"
                    />
                    <div
                      className="absolute right-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-lg bg-[#202020]/98 p-1.5 shadow-2xl ring-1 ring-white/[0.1] backdrop-blur-xl"
                      role="menu"
                    >
                      <p className="px-2.5 py-2 text-[10px] font-semibold uppercase tracking-wide text-white/34">
                        Recent practice
                      </p>
                      <div className="max-h-72 overflow-y-auto">
                        {historyLoading ? (
                          <p className="px-2.5 py-4 text-sm text-white/42">Loading...</p>
                        ) : historyError ? (
                          <p className="px-2.5 py-4 text-sm leading-5 text-red-100/68">{historyError}</p>
                        ) : practiceHistory.length === 0 ? (
                          <p className="px-2.5 py-4 text-sm text-white/42">No practice history.</p>
                        ) : (
                          practiceHistory.map((practice) => (
                            <div
                              className="grid grid-cols-[minmax(0,1fr)_32px] items-center rounded-md transition hover:bg-white/[0.07]"
                              key={practice.id}
                              role="none"
                            >
                              <button
                                className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-2.5 py-2.5 text-left"
                                onClick={() => {
                                  setHistoryMenuOpen(false);
                                  setFlashcardView("practice");
                                  void practiceWorkspaceRef.current?.openHistorySession(practice.id);
                                }}
                                role="menuitem"
                                type="button"
                              >
                                <span className="min-w-0">
                                  <span className="block truncate text-xs font-medium text-white/76">
                                    {formatPracticeDate(practice.createdAt)}
                                  </span>
                                  <span className="mt-0.5 block text-[11px] capitalize text-white/36">
                                    {practice.cardCount} cards · {practice.status.replace("_", " ")}
                                  </span>
                                </span>
                                <span className="text-xs font-semibold text-white/58">
                                  {practice.averageScore === null ? "—" : practice.averageScore}
                                </span>
                              </button>
                              <button
                                aria-label={`Delete practice from ${formatPracticeDate(practice.createdAt)}`}
                                className="flex h-8 w-8 items-center justify-center rounded-md text-white/30 transition hover:bg-red-300/10 hover:text-red-100/72 disabled:opacity-30"
                                disabled={historyDeletingId !== null}
                                onClick={() => void deleteHistorySession(practice)}
                                title="Delete practice"
                                type="button"
                              >
                                {historyDeletingId === practice.id
                                  ? <ArrowsClockwiseIcon className="animate-spin" size={14} />
                                  : <TrashIcon size={14} />}
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
              <PanelIconButton
                ariaLabel="Clear cards and practice progress"
                disabled={cards.length === 0 || isCardGenerating}
                icon={<TrashIcon size={16} />}
                onClick={() => {
                  void handleClearCards();
                }}
              />
              <PanelIconButton ariaLabel="Close mastery" icon={<XIcon size={16} />} onClick={handleClose} tooltip="Close" />
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            {hasConcepts && (
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
            <span className="mx-1 h-5 w-px bg-white/[0.08]" />
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
            <PanelIconButton ariaLabel="Close mastery" icon={<XIcon size={16} />} onClick={handleClose} tooltip="Close" />
          </div>
        )}
      </header>

      <div className={`flex min-h-0 flex-1 flex-col overflow-hidden px-5 ${section === "concepts" ? "pb-5" : ""}`}>
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
          <MasteryPracticeWorkspace
            cardState={cardState}
            documentPath={activeDocumentPath}
            getCurrentDocumentMarkdown={readCurrentDocumentMarkdown}
            isGenerating={isCardGenerating}
            key={activeDocumentPath}
            onOpenGeneration={() => setCardGenerationOpen(true)}
            onForegroundContextChange={onForegroundContextChange}
            onPracticeChanged={onPracticeChanged}
            onResultsChange={setPracticeResultsOpen}
            onResumableChange={setHasResumablePractice}
            onStartingChange={setPracticeStarting}
            onViewChange={setFlashcardView}
            progress={cardProgress}
            ref={practiceWorkspaceRef}
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
              onOpenHistory={setHistoryConcept}
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
      <PracticeHistoryDialog
        onClose={() => setHistoryConcept(null)}
        open={historyConcept !== null}
        request={historyConcept && activeDocumentPath
          ? { conceptId: historyConcept.id, documentPath: activeDocumentPath }
          : null}
        title={historyConcept ? `${historyConcept.name} practice history` : "Concept practice history"}
      />
    </section>
  );
}
