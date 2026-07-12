"use client";

import {
  ArrowLeftIcon,
  CalendarBlankIcon,
  ClockCounterClockwiseIcon,
  PlayIcon,
  SpinnerGapIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import Dialog from "@/components/Dialog";
import { readAiSettings } from "@/components/ai/aiSettings";
import { readMasterySettings } from "./masterySettings";
import MasteryPracticeWorkspace from "./MasteryPracticeWorkspace";

const stageLabels: Record<MasteryStage, string> = {
  2: "Comprehension",
  3: "Connection",
  4: "Structure",
  5: "Debugging",
  6: "Application",
};

function noteName(documentPath: string) {
  return documentPath.replace(/\.json$/i, "").split("/").at(-1) || documentPath;
}

function formatMoment(timestamp: number | null) {
  if (!timestamp) return "Not reviewed";
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: new Date(timestamp).getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  }).format(new Date(timestamp));
}

function calendarLabel(date: string) {
  return new Intl.DateTimeFormat(undefined, { day: "numeric" }).format(new Date(`${date}T12:00:00`));
}

function weekDay(date: string) {
  return new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(new Date(`${date}T12:00:00`));
}

export default function RevisionDialog({
  onClose,
  open,
}: {
  onClose: () => void;
  open: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [overview, setOverview] = useState<MasteryRevisionOverview | null>(null);
  const [session, setSession] = useState<MasteryPracticeSession | null>(null);

  const loadOverview = useCallback(async () => {
    try {
      const nextOverview = await window.learner?.getMasteryRevisionOverview({
        days: 35,
        masterySettings: readMasterySettings(),
        settings: readAiSettings(),
      });
      if (!nextOverview) throw new Error("Revision is not available in this renderer.");
      setOverview(nextOverview);
      return nextOverview;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load revision schedule.");
      return null;
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    let ignore = false;
    window.learner?.getMasteryRevisionOverview({
      days: 35,
      masterySettings: readMasterySettings(),
      settings: readAiSettings(),
    })
      .then((nextOverview) => {
        if (!ignore && nextOverview) setOverview(nextOverview);
      })
      .catch((loadError: unknown) => {
        if (!ignore) {
          setError(loadError instanceof Error ? loadError.message : "Could not load revision schedule.");
        }
      });
    return () => {
      ignore = true;
    };
  }, [open]);

  const closeDialog = () => {
    setError(null);
    setSession(null);
    onClose();
  };

  const startOrResume = async () => {
    if (isLoading) return;
    setError(null);
    setIsLoading(true);
    try {
      const nextSession = overview?.activeSessionId
        ? await window.learner?.getMasteryPracticeSession(overview.activeSessionId)
        : await window.learner?.createMasteryRevisionSession({ masterySettings: readMasterySettings() });
      if (!nextSession) throw new Error("Revision session is not available in this renderer.");
      setSession(nextSession);
      await loadOverview();
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Could not start revision.");
    } finally {
      setIsLoading(false);
    }
  };

  const dueNotes = useMemo(
    () => overview?.notes.filter((note) => note.dueCount > 0) ?? [],
    [overview?.notes],
  );

  return (
    <Dialog
      display={
        <div className="flex h-[min(78vh,820px)] min-h-0 flex-col overflow-hidden">
          {error && (
            <div className="mb-3 rounded-md border border-red-300/15 bg-red-300/10 px-3 py-2 text-sm text-red-100/80">
              {error}
            </div>
          )}

          {session ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="mb-2 flex items-center justify-between border-b border-white/[0.08] pb-3">
                <button
                  className="inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-white/58 transition hover:bg-white/[0.06] hover:text-white/88"
                  onClick={() => {
                    setSession(null);
                    void loadOverview();
                  }}
                  type="button"
                >
                  <ArrowLeftIcon size={15} />
                  Schedule
                </button>
                <span className="text-xs text-white/38">
                  {session.cards.length} cards across {new Set(session.cards.map((card) => card.sourceDocumentPath)).size} notes
                </span>
              </div>
              <MasteryPracticeWorkspace
                cardState={null}
                documentPath={null}
                getCurrentDocumentMarkdown={() => ""}
                isGenerating={false}
                onEnsureReadyCards={async () => null}
                onOpenGeneration={() => {}}
                onPracticeChanged={loadOverview}
                onResultsChange={() => {}}
                onResumableChange={() => {}}
                onStartingChange={() => {}}
                onViewChange={() => {}}
                progress={null}
                suppliedSession={session}
                view="practice"
              />
            </div>
          ) : !overview ? (
            <div className="flex flex-1 items-center justify-center text-white/42">
              <SpinnerGapIcon className="animate-spin" size={20} />
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.6fr)]">
                <section>
                  <div className="mb-3 flex items-end justify-between gap-3">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-white/36">Next 35 days</p>
                      <h3 className="mt-1 text-lg font-semibold text-white/90">Revision calendar</h3>
                    </div>
                    <div className="flex gap-5 text-right">
                      <div>
                        <p className="text-xl font-semibold text-white/92">{overview.dueCount}</p>
                        <p className="text-xs text-white/38">Due now</p>
                      </div>
                      <div>
                        <p className="text-xl font-semibold text-amber-200/90">{overview.overdueCount}</p>
                        <p className="text-xs text-white/38">Overdue</p>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-7 overflow-hidden rounded-md border border-white/[0.08] bg-black/10">
                    {overview.calendar.map((day, index) => (
                      <div
                        className={`relative min-h-20 border-b border-r border-white/[0.06] p-2 ${
                          index < 7 ? "bg-white/[0.025]" : ""
                        }`}
                        key={day.date}
                      >
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-white/32">{index < 7 ? weekDay(day.date) : ""}</span>
                          <span className={index === 0 ? "font-semibold text-white" : "text-white/52"}>
                            {calendarLabel(day.date)}
                          </span>
                        </div>
                        {day.dueCount > 0 && (
                          <div className={`mt-3 inline-flex h-6 min-w-6 items-center justify-center rounded px-1.5 text-xs font-semibold ${
                            index === 0 ? "bg-amber-200 text-black" : "bg-white/10 text-white/72"
                          }`}>
                            {day.dueCount}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </section>

                <aside className="border-l border-white/[0.08] pl-5">
                  <p className="text-xs font-medium uppercase tracking-wide text-white/36">Today</p>
                  <div className="mt-3 space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-md bg-white/[0.07] text-white/70">
                        <CalendarBlankIcon size={18} />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white/86">{overview.dailyCardLimit} card limit</p>
                        <p className="text-xs text-white/38">
                          {overview.preparingCards && overview.preparedCardCount < overview.requiredCardCount
                            ? `Preparing ${overview.requiredCardCount - overview.preparedCardCount} card${overview.requiredCardCount - overview.preparedCardCount === 1 ? "" : "s"}`
                            : `${overview.requiredCardCount} card${overview.requiredCardCount === 1 ? "" : "s"} ready · ${Math.max(0, overview.dueCount - overview.dailyCardLimit)} remain after today`}
                        </p>
                      </div>
                    </div>
                    <button
                      className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-white px-4 py-2.5 text-sm font-semibold text-black transition hover:bg-white/88 disabled:opacity-35"
                      disabled={isLoading || (!overview.activeSessionId && overview.dueCount === 0)}
                      onClick={() => void startOrResume()}
                      type="button"
                    >
                      {isLoading ? <SpinnerGapIcon className="animate-spin" size={16} /> : overview.activeSessionId ? <ClockCounterClockwiseIcon size={16} /> : <PlayIcon size={16} />}
                      {overview.activeSessionId ? "Resume revision" : "Start revision"}
                    </button>
                  </div>
                </aside>
              </div>

              <section className="mt-6 border-t border-white/[0.08] pt-4">
                <div className="mb-2 grid grid-cols-[minmax(0,1fr)_50px] gap-3 px-2 text-[11px] font-medium uppercase tracking-wide text-white/30 sm:grid-cols-[minmax(0,1fr)_100px_110px_90px]">
                  <span>Note and concept</span>
                  <span className="hidden sm:block">Last</span>
                  <span className="hidden sm:block">Next</span>
                  <span className="text-right">Due</span>
                </div>
                {dueNotes.length === 0 ? (
                  <div className="py-12 text-center text-sm text-white/38">Nothing is due.</div>
                ) : (
                  dueNotes.map((note) => (
                    <div className="border-t border-white/[0.06]" key={note.documentPath}>
                      <div className="grid grid-cols-[minmax(0,1fr)_50px] gap-3 px-2 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_100px_110px_90px]">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-white/82">{noteName(note.documentPath)}</p>
                          <p className="truncate text-xs text-white/34">{note.documentPath.replace(/\.json$/i, "")}</p>
                        </div>
                        <span className="hidden text-xs text-white/48 sm:block">{formatMoment(note.lastReviewedAt)}</span>
                        <span className="hidden text-xs text-white/48 sm:block">{formatMoment(note.nextDueAt)}</span>
                        <span className="text-right font-semibold text-white/76">{note.dueCount}</span>
                      </div>
                      {note.concepts.filter((concept) => concept.dueCount > 0).map((concept) => (
                        <div
                          className="grid grid-cols-[minmax(0,1fr)_50px] gap-3 border-t border-white/[0.035] px-2 py-2.5 pl-7 text-xs sm:grid-cols-[minmax(0,1fr)_100px_110px_90px]"
                          key={concept.id}
                        >
                          <div className="min-w-0">
                            <p className="truncate text-white/64">{concept.name}</p>
                            <p className="mt-0.5 truncate text-white/28">
                              {concept.stages.filter((stage) => stage.isDue).map((stage) => stageLabels[stage.stage]).join(" · ")}
                            </p>
                          </div>
                          <span className="hidden text-white/38 sm:block">{formatMoment(concept.lastReviewedAt)}</span>
                          <span className="hidden text-white/38 sm:block">{formatMoment(concept.nextDueAt)}</span>
                          <span className="text-right text-white/54">{concept.dueCount}</span>
                        </div>
                      ))}
                    </div>
                  ))
                )}
              </section>
            </div>
          )}
        </div>
      }
      onClose={closeDialog}
      open={open}
      panelClassName="max-h-[calc(100vh-2rem)] max-w-6xl overflow-hidden"
      title={session ? "Revision session" : "Revision"}
    />
  );
}
