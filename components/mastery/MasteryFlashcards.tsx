"use client";

import {
  CheckIcon,
  EyeIcon,
  PaperPlaneRightIcon,
} from "@phosphor-icons/react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import RichMarkdown from "@/components/markdown/RichMarkdown";
import MasteryCardCarousel from "./MasteryCardCarousel";
import { MasteryCardFrame, MasteryCardNavigation, masteryBottomFadeStyle } from "./MasteryCardLayout";
import { MasteryConceptContent, MasteryMetaphorContent } from "./MasteryConceptContent";

type MasteryFlashcardsProps = {
  cardState: DocumentMasteryCards | null;
  concepts: MasteryConcept[];
  isDiscussing: boolean;
  isEvaluating: boolean;
  isGenerating: boolean;
  metaphor: MasteryMetaphor | null;
  onContinueDiscussion: (cardId: number, message: string) => boolean | Promise<boolean>;
  onEvaluate: (cardId: number, answerMarkdown?: string) => boolean | Promise<boolean>;
  onOpenGeneration: () => void;
  onViewChange: (view: FlashcardView) => void;
  progress: MasteryCardProgress | null;
  view: FlashcardView;
};

export type FlashcardView = "deck" | "practice";

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
  autoFocus = false,
  className,
  onChange,
  placeholder,
  value,
}: {
  autoFocus?: boolean;
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
      autoFocus={autoFocus}
      className={className}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      ref={textareaRef}
      rows={3}
      style={{ overflowY: "hidden" }}
      value={value}
    />
  );
}

function formatRetryAt(value: number | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(value);
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
    <div className="mx-auto mb-4 w-full max-w-4xl text-xs text-white/48">
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
  onSelect,
  selectedCardId,
}: {
  cards: MasteryCard[];
  onSelect: (cardId: number) => void;
  selectedCardId: number | null;
}) {
  return (
    <div className="mx-auto grid w-full max-w-5xl gap-3 pb-2 md:grid-cols-2 xl:grid-cols-3">
      {cards.map((card) => (
        <button
          className={`min-h-40 rounded-lg p-4 text-left transition ${
            card.id === selectedCardId
              ? "bg-white/[0.075] text-white/90"
              : "bg-white/[0.035] text-white/68 hover:bg-white/[0.055] hover:text-white/84"
          }`}
          key={card.id}
          onClick={() => onSelect(card.id)}
          type="button"
        >
          <div className="flex items-center justify-between gap-3 text-[11px] font-medium uppercase tracking-wide text-white/38">
            <span>{kindLabels[card.kind]}</span>
            <span>{cardStateLabel(card)}</span>
          </div>
          <p className="mt-3 line-clamp-3 text-base font-semibold leading-6">{card.title}</p>
          <p className="mt-4 line-clamp-2 text-xs leading-5 text-white/42">{targetSummary(card.targets)}</p>
        </button>
      ))}
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
  canNext,
  canPrevious,
  card,
  concepts,
  current,
  isDiscussing,
  isEvaluating,
  metaphor,
  next,
  onContinueDiscussion,
  onEvaluate,
  previous,
  total,
  weaknesses,
}: {
  canNext: boolean;
  canPrevious: boolean;
  card: MasteryCard;
  concepts: MasteryConcept[];
  current: number;
  isDiscussing: boolean;
  isEvaluating: boolean;
  metaphor: MasteryMetaphor | null;
  next: () => void;
  onContinueDiscussion: (cardId: number, message: string) => boolean | Promise<boolean>;
  onEvaluate: (cardId: number, answerMarkdown?: string) => boolean | Promise<boolean>;
  previous: () => void;
  total: number;
  weaknesses: MasteryWeakness[];
}) {
  const [answer, setAnswer] = useState("");
  const [discussionMessage, setDiscussionMessage] = useState("");
  const [showConceptPeek, setShowConceptPeek] = useState(false);
  const targetIds = useMemo(() => new Set(card.targets.map((target) => target.conceptId)), [card.targets]);
  const targetConcepts = concepts.filter((concept) => targetIds.has(concept.id));
  const primaryConcept = targetConcepts[0] ?? null;
  const revealed = Boolean(card.latestAttempt) && card.status !== "active";
  const cardWeaknessIds = new Set(card.weaknessLinks.map((link) => link.weaknessId));
  const cardWeaknesses = weaknesses.filter((weakness) => cardWeaknessIds.has(weakness.id));
  const stage = card.targets[0]?.stage;
  const stages = [...new Set(card.targets.map((target) => target.stage))];

  const sendDiscussionMessage = async () => {
    const message = discussionMessage.trim();
    if (!message) return;
    await onContinueDiscussion(card.id, message);
    setDiscussionMessage("");
  };

  return (
    <MasteryCardFrame maxWidthClassName="max-w-[820px]">
      <div className="mb-3 flex min-h-6 items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-white/38">
        <span>{kindLabels[card.kind]}</span>
        <span>· {card.difficulty}</span>
        {stage && <span>· {stages.map((targetStage) => stageLabels[targetStage]).join(" / ")}</span>}
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

          {card.answerMode === "multi_turn" && !revealed && (
            <section className="space-y-4">
              {card.messages.map((message) => (
                <div className={message.role === "user" ? "pl-12" : "pr-12"} key={message.id}>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-white/30">
                    {message.role === "user" ? "You" : "Drill"}
                  </p>
                  <RichMarkdown className="text-sm leading-6 text-white/82">{message.contentMarkdown}</RichMarkdown>
                </div>
              ))}
              <AutoGrowingTextarea
                className="min-h-24 w-full resize-none rounded-md bg-black/20 px-3 py-2 text-sm leading-6 text-white outline-none ring-1 ring-white/[0.08] placeholder:text-white/24 focus:ring-white/[0.2]"
                onChange={setDiscussionMessage}
                placeholder="Explain your reasoning..."
                value={discussionMessage}
              />
              <div className="flex justify-end gap-2">
                {card.messages.length > 0 && (
                  <button
                    className="rounded-md px-3 py-2 text-sm font-medium text-white/58 transition hover:bg-white/[0.06] hover:text-white/88 disabled:opacity-30"
                    disabled={isDiscussing || isEvaluating}
                    onClick={() => {
                      void onEvaluate(card.id);
                    }}
                    type="button"
                  >
                    End and evaluate
                  </button>
                )}
                <button
                  className="inline-flex items-center gap-2 rounded-md bg-white px-3 py-2 text-sm font-semibold text-black transition hover:bg-white/88 disabled:opacity-35"
                  disabled={isDiscussing || isEvaluating || !discussionMessage.trim()}
                  onClick={() => {
                    void sendDiscussionMessage();
                  }}
                  type="button"
                >
                  <PaperPlaneRightIcon size={15} />
                  Send
                </button>
              </div>
            </section>
          )}

          {card.answerMode === "single_turn" && !revealed && (
            <section>
              <AutoGrowingTextarea
                className="min-h-36 w-full resize-none rounded-md bg-black/20 px-3 py-2 text-sm leading-6 text-white outline-none ring-1 ring-white/[0.08] placeholder:text-white/24 focus:ring-white/[0.2]"
                onChange={setAnswer}
                placeholder="Write your answer..."
                value={answer}
              />
              <div className="mt-3 flex justify-end">
                <button
                  className="inline-flex items-center gap-2 rounded-md bg-white px-3 py-2 text-sm font-semibold text-black transition hover:bg-white/88 disabled:opacity-35"
                  disabled={isEvaluating || !answer.trim()}
                  onClick={() => {
                    void onEvaluate(card.id, answer);
                  }}
                  type="button"
                >
                  <CheckIcon size={15} />
                  Evaluate
                </button>
              </div>
            </section>
          )}

          {revealed && card.latestAttempt && (
            <section className="space-y-8">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-white/34">
                  Result · {card.latestAttempt.score}/100
                </p>
                <RichMarkdown className="mt-2 text-[15px] leading-7 text-white/84">
                  {card.latestAttempt.feedbackMarkdown}
                </RichMarkdown>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-white/34">Sample answer</p>
                <RichMarkdown className="mt-2 text-[15px] leading-7 text-white/84">
                  {card.expectedAnswerMarkdown}
                </RichMarkdown>
              </div>
              {cardWeaknesses.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-white/34">Weaknesses</p>
                  <div className="mt-2 space-y-3">
                    {cardWeaknesses.map((weakness) => (
                      <div key={weakness.id}>
                        <p className="text-sm font-semibold text-white/82">{weakness.title}</p>
                        <p className="mt-1 text-sm leading-6 text-white/62">{weakness.description}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {!card.conceptContextVisible && (
                <div>
                  <button
                    className="inline-flex items-center gap-2 text-sm font-medium text-white/58 transition hover:text-white/88"
                    onClick={() => setShowConceptPeek((visible) => !visible)}
                    type="button"
                  >
                    <EyeIcon size={16} />
                    {showConceptPeek ? "Hide concepts" : "Peek at concepts"}
                  </button>
                  {showConceptPeek && <div className="mt-6"><ConceptPeek concepts={targetConcepts} /></div>}
                </div>
              )}
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
    </MasteryCardFrame>
  );
}

export default function MasteryFlashcards({
  cardState,
  concepts,
  isDiscussing,
  isEvaluating,
  isGenerating,
  metaphor,
  onContinueDiscussion,
  onEvaluate,
  onOpenGeneration,
  onViewChange,
  progress,
  view,
}: MasteryFlashcardsProps) {
  const cards = useMemo(() => cardState?.cards ?? [], [cardState?.cards]);
  const [selectedCardId, setSelectedCardId] = useState<number | null>(null);
  const selectedCard = cards.find((card) => card.id === selectedCardId) ?? cards[0] ?? null;
  const selectedIndex = selectedCard ? Math.max(0, cards.findIndex((card) => card.id === selectedCard.id)) : 0;

  const selectCard = (cardId: number) => {
    setSelectedCardId(cardId);
    onViewChange("practice");
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {isGenerating && progress && <ProgressStatus progress={progress} />}

      {cards.length === 0 ? (
        <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col items-center justify-center text-center">
          <h3 className="text-lg font-semibold text-white/88">No practice cards</h3>
          <button
            className="mt-5 rounded-md bg-white px-4 py-2 text-sm font-semibold text-black transition hover:bg-white/88 disabled:opacity-35"
            disabled={isGenerating || concepts.length === 0}
            onClick={onOpenGeneration}
            type="button"
          >
            Generate cards
          </button>
        </div>
      ) : view === "deck" ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <DeckView cards={cards} onSelect={selectCard} selectedCardId={selectedCard?.id ?? null} />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
          <MasteryCardCarousel
            activeIndex={selectedIndex}
            getKey={(card) => card.id}
            items={cards}
            onActiveIndexChange={(index) => setSelectedCardId(cards[index]?.id ?? null)}
            renderSlide={({ canNext, canPrevious, index, item, next, previous, total }) => (
              <PracticeCard
                canNext={canNext}
                canPrevious={canPrevious}
                card={item}
                concepts={concepts}
                current={index + 1}
                isDiscussing={isDiscussing}
                isEvaluating={isEvaluating}
                key={item.id}
                metaphor={metaphor}
                next={next}
                onContinueDiscussion={onContinueDiscussion}
                onEvaluate={onEvaluate}
                previous={previous}
                total={total}
                weaknesses={cardState?.weaknesses ?? []}
              />
            )}
          />
        </div>
      )}

    </div>
  );
}
