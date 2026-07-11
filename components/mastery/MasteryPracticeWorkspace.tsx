"use client";

import {
  ArrowsClockwiseIcon,
  CheckIcon,
  ClockCounterClockwiseIcon,
  EyeIcon,
  PaperPlaneRightIcon,
  PlusIcon,
  SpinnerGapIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { readAiSettings } from "@/components/ai/aiSettings";
import Dialog from "@/components/Dialog";
import RichMarkdown from "@/components/markdown/RichMarkdown";
import MasteryCardCarousel from "./MasteryCardCarousel";
import { MasteryCardFrame, MasteryCardNavigation, masteryBottomFadeStyle } from "./MasteryCardLayout";
import { MasteryConceptContent, MasteryMetaphorContent } from "./MasteryConceptContent";
import { readMasterySettings } from "./masterySettings";
import PracticeHistoryDialog from "./PracticeHistoryDialog";
import SpeechToTextButton from "./SpeechToTextButton";

export type FlashcardView = "deck" | "practice";

export type MasteryPracticeWorkspaceHandle = {
  removePracticeSession: (sessionId: number) => void;
  openHistorySession: (sessionId: number) => Promise<void>;
  startPractice: () => Promise<void>;
};

type MasteryPracticeWorkspaceProps = {
  cardState: DocumentMasteryCards | null;
  documentPath: string | null;
  getCurrentDocumentMarkdown: () => string;
  isGenerating: boolean;
  onEnsureReadyCards: (minimumReadyCards: number) => Promise<DocumentMasteryCards | null>;
  onOpenGeneration: () => void;
  onPracticeChanged: () => Promise<unknown>;
  onResultsChange: (showingResults: boolean) => void;
  onResumableChange: (hasResumablePractice: boolean) => void;
  onStartingChange: (isStarting: boolean) => void;
  onViewChange: (view: FlashcardView) => void;
  progress: MasteryCardProgress | null;
  view: FlashcardView;
};

type PracticeMode = "answering" | "results";
type ResultFilter = "all" | "pending" | "passed" | "review";

function isResumablePractice(session: MasteryPracticeSession) {
  return session.cards.some((entry) => !entry.submittedAt);
}

const kindLabels: Record<MasteryCardKind, string> = {
  debugging: "Fault diagnosis",
  diagnostic: "Diagnostic",
  drill: "Drill",
  feynman: "Feynman explanation",
  quiz: "Application",
  relationship: "Relationships",
  contrast: "Contrast",
  scenario: "Simulation",
};

const stageLabels: Record<MasteryStage, string> = {
  2: "Comprehension",
  3: "Connection",
  4: "Structure",
  5: "Debugging",
  6: "Application",
};

const contextLabels: Partial<Record<MasteryCardKind, string>> = {
  contrast: "Focus",
  debugging: "Inspect this",
  drill: "Exercise",
  quiz: "Problem context",
  relationship: "Given relationships",
  scenario: "Scenario",
};

function AutoGrowingTextarea({
  className,
  onChange,
  placeholder,
  value,
}: {
  className: string;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      className={className}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      ref={textareaRef}
      rows={4}
      style={{ overflowY: "hidden" }}
      value={value}
    />
  );
}

function appendTranscript(current: string, transcript: string) {
  const cleanTranscript = transcript.trim();
  if (!cleanTranscript) return current;
  return current.trim() ? `${current.trimEnd()} ${cleanTranscript}` : cleanTranscript;
}

function formatDate(value: number | null) {
  if (!value) return "Not finished";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(value);
}

function formatRetryAt(value: number | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(value);
}

function targetSummary(targets: MasteryCardTarget[]) {
  const names = [...new Set(targets.map((target) => target.conceptName))];
  if (names.length <= 2) return names.join(" · ");
  return `${names.slice(0, 2).join(" · ")} +${names.length - 2}`;
}

function cardStateLabel(card: MasteryCard) {
  if (card.status === "delayed") return `Returns ${formatRetryAt(card.retryAt)}`;
  if (card.status === "done") return card.latestAttempt ? `Completed · ${card.latestAttempt.score}/100` : "Completed";
  return "Ready";
}

function ProgressStatus({ progress }: { progress: MasteryCardProgress }) {
  const total = Math.max(1, progress.total);
  const percentage = Math.round((Math.min(total, progress.completed) / total) * 100);
  return (
    <div className="mx-auto mb-4 w-full max-w-5xl text-xs text-white/48">
      <div className="flex items-center justify-between gap-4">
        <span className="truncate">{progress.label}</span>
        <span className="uppercase tracking-wide">{progress.phase}</span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.08]">
        <div className="h-full bg-white/55 transition-[width]" style={{ width: `${percentage}%` }} />
      </div>
    </div>
  );
}

function DeckView({
  cards,
  detailCardId,
  documentPath,
  onDetailChange,
  onToggleSelection,
  selectedCardIds,
}: {
  cards: MasteryCard[];
  detailCardId: number | null;
  documentPath: string | null;
  onDetailChange: (cardId: number) => void;
  onToggleSelection: (cardId: number) => void;
  selectedCardIds: number[];
}) {
  const detailCard = cards.find((card) => card.id === detailCardId) ?? cards[0] ?? null;
  const [historyCard, setHistoryCard] = useState<MasteryCard | null>(null);
  const selectedIds = new Set(selectedCardIds);
  const readyCount = cards.filter((card) => card.status === "active").length;
  const laterCount = cards.filter((card) => card.status === "delayed").length;
  const completedCount = cards.filter((card) => card.status === "done").length;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="grid h-full min-h-0 flex-1 gap-8 py-3 lg:grid-cols-[minmax(300px,0.82fr)_minmax(0,1.18fr)]">
        <div className="relative min-h-0 overflow-hidden">
          <header className="pointer-events-none absolute inset-x-0 top-0 z-10 flex h-12 items-start justify-between gap-4 px-1 pt-0">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-white/34">Cards</p>
            <p className="text-[10px] font-medium uppercase tracking-wide text-white/30">
              {readyCount} ready · {laterCount} later · {completedCount} completed
            </p>
          </header>

          <div
            className="h-full min-h-0 space-y-2 overflow-y-auto pb-3 pt-10 pr-1"
            style={{
              WebkitMaskImage:
                "linear-gradient(to bottom, transparent 0, transparent 26px, black 48px, black calc(100% - 18px), transparent 100%)",
              maskImage:
                "linear-gradient(to bottom, transparent 0, transparent 26px, black 48px, black calc(100% - 18px), transparent 100%)",
            }}
          >
            {cards.map((card) => {
              const selected = selectedIds.has(card.id);
              const active = detailCard?.id === card.id;
              const selectable = card.status === "active";
              return (
                <div
                  className={`grid grid-cols-[minmax(0,1fr)_44px] overflow-hidden rounded-lg ring-1 ring-inset transition ${
                    active
                      ? "bg-white/[0.065] ring-white/[0.12]"
                      : "bg-white/[0.025] ring-white/[0.055] hover:bg-white/[0.045] hover:ring-white/[0.08]"
                  }`}
                  key={card.id}
                >
                  <button className="min-w-0 p-4 text-left" onClick={() => onDetailChange(card.id)} type="button">
                    <div className="flex items-center justify-between gap-3 text-[10px] font-medium uppercase tracking-wide text-white/36">
                      <span>{kindLabels[card.kind]}</span>
                      <span>{cardStateLabel(card)}</span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm font-semibold leading-5 text-white/86">{card.title}</p>
                    <p className="mt-2 truncate text-xs text-white/38">{targetSummary(card.targets)}</p>
                  </button>
                  <button
                    aria-label={selected ? `Remove ${card.title} from practice` : `Add ${card.title} to practice`}
                    aria-pressed={selected}
                    className={`m-auto flex h-8 w-8 items-center justify-center rounded-md transition ${
                      selected
                        ? "bg-white/[0.12] text-white/86"
                        : selectable
                          ? "text-white/34 hover:bg-white/[0.07] hover:text-white/72"
                          : "cursor-not-allowed text-white/16"
                    }`}
                    disabled={!selectable}
                    onClick={() => onToggleSelection(card.id)}
                    title={selected ? "Remove from practice" : selectable ? "Add to practice" : cardStateLabel(card)}
                    type="button"
                  >
                    {selected ? <CheckIcon size={15} weight="bold" /> : <PlusIcon size={16} />}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {detailCard && (
          <aside className="flex min-h-0 flex-col overflow-hidden rounded-lg bg-white/[0.028] ring-1 ring-inset ring-white/[0.055]">
            <header className="flex shrink-0 items-center justify-between gap-4 px-5 pb-2 pt-4">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-white/30">Preview</p>
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex min-w-0 items-center gap-2 text-[10px] font-medium uppercase tracking-wide text-white/34">
                  <span className="truncate">{kindLabels[detailCard.kind]}</span>
                  <span>· {detailCard.difficulty}</span>
                  <span>· {cardStateLabel(detailCard)}</span>
                </div>
                <button
                  aria-label={`Show practice history for ${detailCard.title}`}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-white/38 transition hover:bg-white/[0.07] hover:text-white/76"
                  disabled={!documentPath}
                  onClick={() => setHistoryCard(detailCard)}
                  title="Practice history"
                  type="button"
                >
                  <ClockCounterClockwiseIcon size={15} />
                </button>
              </div>
            </header>

            <div
              className="min-h-0 flex-1 overflow-y-auto px-5 pb-10 pt-4"
              style={masteryBottomFadeStyle}
            >
              <h2 className="mt-4 break-words text-2xl font-semibold leading-8 text-white/92">{detailCard.title}</h2>
              <p className="mt-2 text-sm text-white/42">{targetSummary(detailCard.targets)}</p>

              {detailCard.contextMarkdown && (
                <section className="mt-8">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-white/34">
                    {contextLabels[detailCard.kind] || "Context"}
                  </p>
                  <RichMarkdown className="mt-2 text-[15px] leading-7 text-white/82">
                    {detailCard.contextMarkdown}
                  </RichMarkdown>
                </section>
              )}

              <section className="mt-8">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-white/34">Task</p>
                <RichMarkdown className="mt-2 text-base leading-7 text-white/90">{detailCard.promptMarkdown}</RichMarkdown>
              </section>

              <section className="mt-8">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-white/34">Evaluation focus</p>
                <RichMarkdown className="mt-2 text-sm leading-6 text-white/62">{detailCard.rubricMarkdown}</RichMarkdown>
              </section>
            </div>
          </aside>
        )}
      </div>
      <PracticeHistoryDialog
        onClose={() => setHistoryCard(null)}
        open={historyCard !== null}
        request={historyCard && documentPath ? { cardId: historyCard.id, documentPath } : null}
        title={historyCard ? `${historyCard.title} history` : "Flashcard history"}
      />
    </div>
  );
}

function ConceptPeek({ concepts }: { concepts: MasteryConcept[] }) {
  return (
    <div className="space-y-10">
      {concepts.map((concept) => <MasteryConceptContent concept={concept} key={concept.id} />)}
    </div>
  );
}

function PracticeCard({
  answer,
  canNext,
  canPrevious,
  current,
  next,
  onAnswerChange,
  onSubmit,
  previous,
  sessionCard,
  total,
}: {
  answer: string;
  canNext: boolean;
  canPrevious: boolean;
  current: number;
  next: () => void;
  onAnswerChange: (value: string) => void;
  onSubmit: () => void;
  previous: () => void;
  sessionCard: MasteryPracticeSessionCard;
  total: number;
}) {
  const [showConceptPeek, setShowConceptPeek] = useState(false);
  const { card, concepts, metaphor, submittedAt } = sessionCard;
  const primaryConcept = concepts[0] ?? null;
  const stages = [...new Set(card.targets.map((target) => target.stage))];

  return (
    <MasteryCardFrame maxWidthClassName="max-w-[820px]">
      <div className="mb-3 flex min-h-6 items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-white/38">
        <span>{kindLabels[card.kind]}</span>
        <span>· {card.difficulty}</span>
        {stages.length > 0 && <span>· {stages.map((stage) => stageLabels[stage]).join(" / ")}</span>}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-3 pr-2" style={masteryBottomFadeStyle}>
        <div className="space-y-9 pb-7">
          {card.conceptContextVisible && primaryConcept ? (
            <MasteryConceptContent concept={primaryConcept} />
          ) : (
            <h2 className="break-words text-[26px] font-semibold leading-8 text-white/94">{card.title}</h2>
          )}

          {card.metaphorContextVisible && primaryConcept && metaphor && (
            <section>
              <MasteryMetaphorContent concept={primaryConcept} metaphor={metaphor} />
            </section>
          )}

          {card.contextMarkdown && (
            <section>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-white/34">
                {contextLabels[card.kind] || "Context"}
              </p>
              <RichMarkdown className="mt-2 text-[15px] leading-7 text-white/86">{card.contextMarkdown}</RichMarkdown>
            </section>
          )}

          <section>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-white/34">
              {card.kind === "feynman" ? "Explain it in your own words" : "Task"}
            </p>
            <RichMarkdown className="mt-2 text-lg leading-8 text-white/92">{card.promptMarkdown}</RichMarkdown>
          </section>

          {submittedAt ? (
            <section className="rounded-md bg-white/[0.04] p-4 ring-1 ring-white/[0.08]">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-white/42">
                <SpinnerGapIcon className="animate-spin" size={15} />
                Submitted · grading in background
              </div>
              <RichMarkdown className="mt-3 text-sm leading-6 text-white/72">{sessionCard.answerMarkdown}</RichMarkdown>
            </section>
          ) : (
            <section>
              <AutoGrowingTextarea
                className="min-h-40 w-full resize-none rounded-md bg-black/20 px-3 py-2 text-sm leading-6 text-white outline-none placeholder:text-white/24 focus:bg-black/25 border border-white/[0.08] focus:border-white/[0.12] transition"
                onChange={onAnswerChange}
                placeholder={card.answerMode === "multi_turn" ? "Respond to the scenario with your full reasoning..." : "Write your answer..."}
                value={answer}
              />
              <div className="mt-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <SpeechToTextButton
                    onTranscript={(transcript) => onAnswerChange(appendTranscript(answer, transcript))}
                  />
                  {!card.conceptContextVisible && concepts.length > 0 && (
                    <button
                      className="inline-flex items-center gap-2 text-sm font-medium text-white/48 transition hover:text-white/84"
                      onClick={() => setShowConceptPeek(true)}
                      type="button"
                    >
                      <EyeIcon size={16} />
                      Peek at concepts
                    </button>
                  )}
                </div>
                <button
                  className="inline-flex items-center gap-2 rounded-md bg-white px-3 py-2 text-sm font-semibold text-black transition hover:bg-white/88 disabled:opacity-35"
                  disabled={!answer.trim()}
                  onClick={onSubmit}
                  type="button"
                >
                  <PaperPlaneRightIcon size={15} />
                  Submit and continue
                </button>
              </div>
            </section>
          )}

        </div>
      </div>

      <MasteryCardNavigation
        canNext={canNext}
        canPrevious={canPrevious}
        current={current}
        next={next}
        previous={previous}
        total={total}
      />

      <Dialog
        display={
          <div className="max-h-[min(70vh,680px)] overflow-y-auto pr-2 py-4" style={masteryBottomFadeStyle}>
            <ConceptPeek concepts={concepts} />
          </div>
        }
        onClose={() => setShowConceptPeek(false)}
        open={showConceptPeek}
        panelClassName="max-w-3xl"
        title="Concepts for this card"
      />
    </MasteryCardFrame>
  );
}

function gradingLabel(grading: MasteryPracticeGrading | null) {
  if (!grading) return "Awaiting submission";
  if (grading.status === "queued") return "Queued";
  if (grading.status === "running") return "Grading";
  if (grading.status === "failed") return "Needs attention";
  return grading.score === null ? "Graded" : `${grading.score}/100`;
}

function mergePracticeSession(
  current: MasteryPracticeSession | null,
  incoming: MasteryPracticeSession,
  discardOptimisticCardId: number | null = null,
) {
  if (!current || current.id !== incoming.id) return incoming;
  const currentCards = new Map(current.cards.map((entry) => [entry.id, entry]));
  return {
    ...incoming,
    cards: incoming.cards.map((entry) => {
      const local = currentCards.get(entry.id);
      if (
        local &&
        local.id !== discardOptimisticCardId &&
        (local.grading?.id ?? 0) < 0 &&
        !entry.submittedAt
      ) {
        return local;
      }
      return entry;
    }),
  };
}

function ResultsView({
  filter,
  onFilterChange,
  onOutcomeChange,
  onRetry,
  outcomeChangingId,
  session,
}: {
  filter: ResultFilter;
  onFilterChange: (filter: ResultFilter) => void;
  onOutcomeChange: (sessionCard: MasteryPracticeSessionCard, outcome: "passed" | "review") => void;
  onRetry: (sessionCard: MasteryPracticeSessionCard) => void;
  outcomeChangingId: number | null;
  session: MasteryPracticeSession;
}) {
  const passingScore = session.masterySettings.passingScore;
  const outcomeFor = (entry: MasteryPracticeSessionCard) => {
    if (entry.manualOutcome) return entry.manualOutcome;
    return entry.grading?.status === "succeeded" && (entry.grading.score ?? 0) >= passingScore
      ? "passed"
      : "review";
  };
  const succeeded = session.cards.filter((entry) => entry.grading?.status === "succeeded" && entry.grading.score !== null);
  const average = succeeded.length > 0
    ? Math.round(succeeded.reduce((total, entry) => total + (entry.grading?.score ?? 0), 0) / succeeded.length)
    : null;
  const filteredCards = session.cards.filter((entry) => {
    const grading = entry.grading;
    if (filter === "all") return true;
    if (filter === "pending") return !grading || grading.status === "queued" || grading.status === "running";
    if (!grading || grading.status === "queued" || grading.status === "running") return false;
    return outcomeFor(entry) === filter;
  });

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col">
      <div className="shrink-0 border-b border-white/[0.07] pb-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-white/34">Practice results</p>
            <h2 className="mt-1 text-2xl font-semibold text-white/92">
              {average === null ? "Grading in progress" : `${average}/100 average`}
            </h2>
            <p className="mt-1 text-sm text-white/42">
              {succeeded.length} of {session.cards.length} graded · Passing score {passingScore}/100 · {formatDate(session.createdAt)}
            </p>
          </div>
          <div className="flex h-8 overflow-hidden rounded-md border border-white/[0.08] bg-white/[0.025]">
            {(["all", "pending", "passed", "review"] as const).map((value) => (
              <button
                aria-pressed={filter === value}
                className={`px-3 text-xs capitalize transition ${
                  filter === value ? "bg-white/[0.12] text-white/84" : "text-white/42 hover:text-white/72"
                }`}
                key={value}
                onClick={() => onFilterChange(value)}
                type="button"
              >
                {value}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto py-4 pr-1">
        {filteredCards.length === 0 && (
          <div className="flex min-h-52 items-center justify-center text-sm text-white/42">No results in this filter.</div>
        )}
        {filteredCards.map((entry, index) => {
          const grading = entry.grading;
          const outcome = outcomeFor(entry);
          const canSetOutcome = grading?.status === "succeeded" || grading?.status === "failed";
          const changingOutcome = outcomeChangingId === entry.id;
          return (
            <article className="rounded-md border border-white/[0.07] bg-white/[0.025] p-4" key={entry.id}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-white/34">
                    Card {index + 1} · {kindLabels[entry.card.kind]}
                  </p>
                  <h3 className="mt-1 text-base font-semibold leading-6 text-white/88">{entry.card.title}</h3>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <span className={`text-sm font-semibold ${
                    grading?.status === "failed" ? "text-red-200/80" : "text-white/68"
                  }`}>
                    {gradingLabel(grading)}
                  </span>
                  {canSetOutcome && (
                    <div className="flex h-8 overflow-hidden rounded-md bg-white/[0.035]">
                      {(["passed", "review"] as const).map((value) => (
                        <button
                          aria-pressed={outcome === value}
                          className={`px-3 text-xs capitalize transition disabled:opacity-40 ${
                            outcome === value
                              ? "bg-white/[0.12] text-white/84"
                              : "text-white/42 hover:bg-white/[0.06] hover:text-white/72"
                          }`}
                          disabled={changingOutcome}
                          key={value}
                          onClick={() => onOutcomeChange(entry, value)}
                          type="button"
                        >
                          {value}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-5 space-y-5">
                <section>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-white/32">Your answer</p>
                  <RichMarkdown className="mt-2 text-sm leading-6 text-white/72">
                    {entry.answerMarkdown || "No answer recorded."}
                  </RichMarkdown>
                </section>
                <section className="border-t border-white/[0.07] pt-5">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-white/32">Feedback</p>
                  {grading?.status === "succeeded" ? (
                    <RichMarkdown className="mt-2 text-sm leading-6 text-white/76">
                      {grading.feedbackMarkdown}
                    </RichMarkdown>
                  ) : grading?.status === "failed" ? (
                    <div className="mt-2">
                      <p className="text-sm leading-6 text-red-100/66">{grading.error || "Grading failed."}</p>
                      <button
                        className="mt-3 inline-flex items-center gap-2 rounded-md bg-white/[0.09] px-3 py-2 text-xs font-semibold text-white/78 transition hover:bg-white/[0.14]"
                        onClick={() => onRetry(entry)}
                        type="button"
                      >
                        <ArrowsClockwiseIcon size={14} />
                        Retry grading
                      </button>
                    </div>
                  ) : (
                    <div className="mt-2 flex items-center gap-2 text-sm text-white/42">
                      <SpinnerGapIcon className="animate-spin" size={15} />
                      Grading continues in the background.
                    </div>
                  )}
                </section>
              </div>

              {grading?.status === "succeeded" && (
                <div className="mt-5 flex items-start justify-between gap-4 border-t border-white/[0.07] pt-5">
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-white/32">Sample answer</p>
                    <RichMarkdown className="mt-2 text-sm leading-6 text-white/58">
                      {entry.card.expectedAnswerMarkdown}
                    </RichMarkdown>
                  </div>
                  <button
                    className="shrink-0 rounded-md px-3 py-2 text-xs font-medium text-white/44 transition hover:bg-white/[0.06] hover:text-white/74"
                    onClick={() => onRetry(entry)}
                    type="button"
                  >
                    Regrade
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}

const MasteryPracticeWorkspace = forwardRef<MasteryPracticeWorkspaceHandle, MasteryPracticeWorkspaceProps>(
function MasteryPracticeWorkspace({
  cardState,
  documentPath,
  getCurrentDocumentMarkdown,
  isGenerating,
  onEnsureReadyCards,
  onOpenGeneration,
  onPracticeChanged,
  onResultsChange,
  onResumableChange,
  onStartingChange,
  onViewChange,
  progress,
  view,
}: MasteryPracticeWorkspaceProps, ref) {
  const cards = useMemo(() => cardState?.cards ?? [], [cardState?.cards]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [detailCardId, setDetailCardId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [outcomeChangingId, setOutcomeChangingId] = useState<number | null>(null);
  const [practiceMode, setPracticeMode] = useState<PracticeMode>("answering");
  const [resultFilter, setResultFilter] = useState<ResultFilter>("all");
  const [resumableSessionId, setResumableSessionId] = useState<number | null>(null);
  const [selectedCardIds, setSelectedCardIds] = useState<number[]>([]);
  const [session, setSession] = useState<MasteryPracticeSession | null>(null);
  const refreshedSessionsRef = useRef(new Set<number>());

  useEffect(() => {
    onResultsChange(view === "practice" && practiceMode === "results");
  }, [onResultsChange, practiceMode, view]);

  useEffect(() => {
    if (!documentPath) return;
    let cancelled = false;
    window.learner?.listMasteryPracticeSessions(documentPath)
      .then((sessions) => {
        if (cancelled) return;
        const resumable = sessions.find((candidate) => candidate.status === "active");
        setResumableSessionId(resumable?.id ?? null);
        onResumableChange(Boolean(resumable));
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Could not load practice history.");
      });
    return () => {
      cancelled = true;
    };
  }, [documentPath, onResumableChange]);

  const shouldPoll = Boolean(
    session?.cards.some((entry) => entry.grading?.status === "queued" || entry.grading?.status === "running"),
  );
  const pollingSessionId = session?.id ?? null;

  useEffect(() => {
    if (!pollingSessionId || !shouldPoll) return;
    let cancelled = false;
    const sessionId = pollingSessionId;
    const poll = async () => {
      try {
        const nextSession = await window.learner?.getMasteryPracticeSession(sessionId, readAiSettings());
        if (cancelled || !nextSession) return;
        setSession((current) => mergePracticeSession(current, nextSession));
        const resumable = isResumablePractice(nextSession);
        setResumableSessionId(resumable ? nextSession.id : null);
        onResumableChange(resumable);
        const hasPending = nextSession.cards.some(
          (entry) => entry.grading?.status === "queued" || entry.grading?.status === "running",
        );
        if (!hasPending && !refreshedSessionsRef.current.has(sessionId)) {
          refreshedSessionsRef.current.add(sessionId);
          await onPracticeChanged();
        }
      } catch (pollError) {
        if (!cancelled) setError(pollError instanceof Error ? pollError.message : "Could not refresh grading results.");
      }
    };
    const intervalId = window.setInterval(() => {
      void poll();
    }, 1400);
    void poll();
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [documentPath, onPracticeChanged, onResumableChange, pollingSessionId, shouldPoll]);

  const toggleSelection = (cardId: number) => {
    setSelectedCardIds((current) => current.includes(cardId)
      ? current.filter((candidate) => candidate !== cardId)
      : [...current, cardId]);
  };

  const startPractice = async () => {
    if (!documentPath || isStarting) return;
    if (resumableSessionId) {
      setError(null);
      setIsStarting(true);
      onStartingChange(true);
      try {
        const resumedSession = await window.learner?.getMasteryPracticeSession(resumableSessionId, readAiSettings());
        if (!resumedSession) throw new Error("Practice session is not available in this renderer.");
        setActiveIndex(0);
        setAnswers({});
        setPracticeMode(resumedSession.cards.every((entry) => entry.submittedAt) ? "results" : "answering");
        setResultFilter("all");
        setSession(resumedSession);
        onViewChange("practice");
      } catch (resumeError) {
        setError(resumeError instanceof Error ? resumeError.message : "Could not resume practice.");
      } finally {
        setIsStarting(false);
        onStartingChange(false);
      }
      return;
    }
    const masterySettings = readMasterySettings();
    setError(null);
    setIsStarting(true);
    onStartingChange(true);
    try {
      let practiceCardIds = selectedCardIds;
      const readyCardCount = cards.filter((card) => card.status === "active").length;
      if (practiceCardIds.length === 0 && readyCardCount < masterySettings.practiceCardCount) {
        const generatedState = await onEnsureReadyCards(masterySettings.practiceCardCount);
        if (!generatedState) throw new Error("Could not prepare enough ready cards for practice.");
        practiceCardIds = generatedState.cards
          .filter((card) => card.status === "active")
          .slice(0, masterySettings.practiceCardCount)
          .map((card) => card.id);
        if (practiceCardIds.length < masterySettings.practiceCardCount) {
          throw new Error("Could not prepare enough ready cards for practice.");
        }
      }
      const nextSession = await window.learner?.createMasteryPracticeSession({
        cardIds: practiceCardIds,
        desiredCount: masterySettings.practiceCardCount,
        documentPath,
        markdown: getCurrentDocumentMarkdown(),
        masterySettings,
      });
      if (!nextSession) throw new Error("Practice sessions are not available in this renderer.");
      setActiveIndex(0);
      setAnswers({});
      setPracticeMode("answering");
      setResultFilter("all");
      setSelectedCardIds([]);
      setSession(nextSession);
      const resumable = isResumablePractice(nextSession);
      setResumableSessionId(resumable ? nextSession.id : null);
      onResumableChange(resumable);
      onViewChange("practice");
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Could not start practice.");
    } finally {
      setIsStarting(false);
      onStartingChange(false);
    }
  };

  const submitAnswer = (sessionCard: MasteryPracticeSessionCard) => {
    if (!session || sessionCard.submittedAt) return;
    const answer = (answers[sessionCard.id] || "").trim();
    if (!answer) return;
    setError(null);
    const submittedAt = session.createdAt;
    const optimisticSession: MasteryPracticeSession = {
      ...session,
      cards: session.cards.map((entry) => entry.id === sessionCard.id
        ? {
            ...entry,
            answerMarkdown: answer,
            submittedAt,
            grading: {
              effectsApplied: false,
              error: "",
              feedbackMarkdown: "",
              gradedAt: null,
              id: -entry.id,
              kind: "initial",
              model: "",
              score: null,
              startedAt: null,
              status: "queued",
            },
          }
        : entry),
    };
    const allSubmitted = optimisticSession.cards.every((entry) => entry.submittedAt);
    refreshedSessionsRef.current.delete(session.id);
    setSession(optimisticSession);
    if (allSubmitted) {
      setPracticeMode("results");
      setResultFilter("all");
      setResumableSessionId(null);
      onResumableChange(false);
    } else {
      const nextUnanswered = optimisticSession.cards.findIndex(
        (entry, index) => index > activeIndex && !entry.submittedAt,
      );
      setActiveIndex(nextUnanswered >= 0 ? nextUnanswered : optimisticSession.cards.findIndex((entry) => !entry.submittedAt));
    }

    window.learner?.submitMasteryPracticeAnswer({
      answerMarkdown: answer,
      sessionCardId: sessionCard.id,
      settings: readAiSettings(),
    })
      .then((nextSession) => {
        if (!nextSession) return;
        setSession((current) => mergePracticeSession(current, nextSession));
        const resumable = isResumablePractice(nextSession);
        setResumableSessionId(resumable ? nextSession.id : null);
        onResumableChange(resumable);
      })
      .catch(async (submitError: unknown) => {
        setError(submitError instanceof Error ? submitError.message : "Could not submit this answer.");
        const restored = await window.learner?.getMasteryPracticeSession(session.id, readAiSettings());
        if (restored) {
          setSession((current) => mergePracticeSession(current, restored, sessionCard.id));
          setActiveIndex(session.cards.findIndex((entry) => entry.id === sessionCard.id));
          setPracticeMode("answering");
          const resumable = isResumablePractice(restored);
          setResumableSessionId(resumable ? restored.id : null);
          onResumableChange(resumable);
        }
      });
  };

  const retryGrading = (sessionCard: MasteryPracticeSessionCard) => {
    if (!session) return;
    setError(null);
    const previousStatus = sessionCard.grading?.status;
    setSession({
      ...session,
      cards: session.cards.map((entry) => entry.id === sessionCard.id
        ? {
            ...entry,
            grading: {
              effectsApplied: entry.grading?.effectsApplied ?? false,
              error: "",
              feedbackMarkdown: entry.grading?.feedbackMarkdown ?? "",
              gradedAt: null,
              id: -(entry.grading?.id ?? entry.id),
              kind: previousStatus === "succeeded" ? "regrade" : "retry",
              model: "",
              score: null,
              startedAt: null,
              status: "queued",
            },
          }
        : entry),
      status: "grading",
    });
    refreshedSessionsRef.current.delete(session.id);
    window.learner?.retryMasteryPracticeGrading({
      sessionCardId: sessionCard.id,
      settings: readAiSettings(),
    })
      .then((nextSession) => {
        if (nextSession) setSession((current) => mergePracticeSession(current, nextSession));
      })
      .catch((retryError: unknown) => {
        setError(retryError instanceof Error ? retryError.message : "Could not queue grading.");
      });
  };

  const setCardOutcome = (sessionCard: MasteryPracticeSessionCard, outcome: "passed" | "review") => {
    if (!session || outcomeChangingId !== null || sessionCard.manualOutcome === outcome) return;
    setError(null);
    setOutcomeChangingId(sessionCard.id);
    window.learner?.setMasteryPracticeCardOutcome({ outcome, sessionCardId: sessionCard.id })
      .then(async (nextSession) => {
        if (nextSession) setSession((current) => mergePracticeSession(current, nextSession));
        await onPracticeChanged();
      })
      .catch((outcomeError: unknown) => {
        setError(outcomeError instanceof Error ? outcomeError.message : "Could not update this card outcome.");
      })
      .finally(() => setOutcomeChangingId(null));
  };

  const openHistorySession = async (sessionId: number) => {
    setError(null);
    try {
      const nextSession = await window.learner?.getMasteryPracticeSession(sessionId, readAiSettings());
      if (!nextSession) throw new Error("Practice session is not available in this renderer.");
      setActiveIndex(0);
      setAnswers({});
      setPracticeMode(nextSession.cards.every((entry) => entry.submittedAt) ? "results" : "answering");
      setResultFilter("all");
      setSession(nextSession);
      onViewChange("practice");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not open practice session.");
    }
  };

  const removePracticeSession = (sessionId: number) => {
    if (resumableSessionId === sessionId) {
      setResumableSessionId(null);
      onResumableChange(false);
    }
    if (session?.id === sessionId) {
      setSession(null);
      onResultsChange(false);
      onViewChange("deck");
    }
  };

  useImperativeHandle(ref, () => ({
    removePracticeSession,
    openHistorySession,
    startPractice,
  }));

  const safeActiveIndex = session?.cards.length
    ? Math.max(0, Math.min(activeIndex, session.cards.length - 1))
    : 0;
  const setFocusedPracticeIndex = useCallback((index: number) => {
    if (!session?.cards.length) return;
    setActiveIndex(Math.max(0, Math.min(session.cards.length - 1, index)));
  }, [session?.cards.length]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {isGenerating && progress && <ProgressStatus progress={progress} />}
      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-md bg-red-300/10 px-4 py-3 text-sm text-red-100/80">
          <WarningCircleIcon className="mt-0.5 shrink-0" size={17} />
          {error}
        </div>
      )}

      {cards.length === 0 && view === "deck" ? (
        <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col items-center justify-center text-center">
          <h3 className="text-lg font-semibold text-white/88">No practice cards</h3>
          <button
            className="mt-5 rounded-md bg-white px-4 py-2 text-sm font-semibold text-black transition hover:bg-white/88 disabled:opacity-35"
            disabled={isGenerating}
            onClick={onOpenGeneration}
            type="button"
          >
            Generate cards
          </button>
        </div>
      ) : view === "deck" ? (
        <DeckView
          cards={cards}
          detailCardId={detailCardId}
          documentPath={documentPath}
          onDetailChange={setDetailCardId}
          onToggleSelection={toggleSelection}
          selectedCardIds={selectedCardIds}
        />
      ) : !session ? (
        <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col items-center justify-center text-center">
          <h3 className="text-lg font-semibold text-white/88">No active practice</h3>
          <p className="mt-2 text-sm text-white/42">Choose a practice set from the deck.</p>
          <button
            className="mt-5 rounded-md bg-white px-4 py-2 text-sm font-semibold text-black transition hover:bg-white/88"
            onClick={() => onViewChange("deck")}
            type="button"
          >
            Open deck
          </button>
        </div>
      ) : practiceMode === "results" ? (
        <ResultsView
          filter={resultFilter}
          onFilterChange={setResultFilter}
          onOutcomeChange={setCardOutcome}
          onRetry={retryGrading}
          outcomeChangingId={outcomeChangingId}
          session={session}
        />
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
          <MasteryCardCarousel
            activeIndex={safeActiveIndex}
            getKey={(entry) => entry.id}
            items={session.cards}
            onActiveIndexChange={setFocusedPracticeIndex}
            renderSlide={({ canNext, canPrevious, index, item, next, previous, total }) => (
              <PracticeCard
                answer={answers[item.id] || ""}
                canNext={canNext}
                canPrevious={canPrevious}
                current={index + 1}
                key={item.id}
                next={next}
                onAnswerChange={(value) => setAnswers((current) => ({ ...current, [item.id]: value }))}
                onSubmit={() => submitAnswer(item)}
                previous={previous}
                sessionCard={item}
                total={total}
              />
            )}
          />
        </div>
      )}
    </div>
  );
});

export default MasteryPracticeWorkspace;