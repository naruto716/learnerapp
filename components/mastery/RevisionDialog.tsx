"use client";

import {
  CalendarBlankIcon,
  CaretLeftIcon,
  ClockCounterClockwiseIcon,
  PlayIcon,
  SpinnerGapIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import Dialog from "@/components/Dialog";
import { readAiSettings } from "@/components/ai/aiSettings";
import type { AgentForegroundContext } from "@/components/ai/agentForegroundContext";
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

function localDateKey(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

type CalendarDueItem = {
  conceptName: string;
  count: number;
  documentPath: string;
};

export default function RevisionDialog({
  onClose,
  onForegroundContextChange,
  open,
}: {
  onClose: () => void;
  onForegroundContextChange?: (context: AgentForegroundContext | null) => void;
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
  const calendarDueItems = useMemo(() => {
    const itemsByDate = new Map<string, CalendarDueItem[]>();
    if (!overview) return itemsByDate;

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const groupedItems = new Map<string, Map<string, CalendarDueItem>>();

    overview.notes.forEach((note) => {
      note.concepts.forEach((concept) => {
        concept.stages.forEach((stage) => {
          const date = localDateKey(Math.max(stage.dueAt, todayStart.getTime()));
          const dateItems = groupedItems.get(date) ?? new Map<string, CalendarDueItem>();
          const key = `${note.documentPath}:${concept.id}`;
          const current = dateItems.get(key);
          dateItems.set(key, {
            conceptName: concept.name,
            count: (current?.count ?? 0) + 1,
            documentPath: note.documentPath,
          });
          groupedItems.set(date, dateItems);
        });
      });
    });

    groupedItems.forEach((items, date) => {
      itemsByDate.set(date, [...items.values()]);
    });
    return itemsByDate;
  }, [overview]);
  const upcomingDays = useMemo(() => {
    if (!overview) return [];
    return overview.calendar
      .slice(1)
      .filter((day) => day.dueCount > 0)
      .map((day) => ({ ...day, items: calendarDueItems.get(day.date) ?? [] }))
      .slice(0, 6);
  }, [calendarDueItems, overview]);

  return (
    <Dialog
      display={
        <div className="flex h-[calc(100vh-7rem)] min-h-0 flex-col overflow-hidden [--results-sticky-bg:#242424]">
          {error && (
            <div className="mb-3 rounded-md border border-red-300/15 bg-red-300/10 px-3 py-2 text-sm text-red-100/80">
              {error}
            </div>
          )}

          {session ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <MasteryPracticeWorkspace
                cardState={null}
                documentPath={null}
                getCurrentDocumentMarkdown={() => ""}
                isGenerating={false}
                onEnsureReadyCards={async () => null}
                onForegroundContextChange={open ? onForegroundContextChange : undefined}
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

                  <div className="grid grid-cols-7 rounded-md border border-white/[0.08] bg-black/10">
                    {overview.calendar.map((day, index) => {
                      const dueItems = calendarDueItems.get(day.date) ?? [];
                      return (
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
                          <div className="group/due relative mt-3 inline-flex">
                            <button
                              aria-label={`${day.dueCount} revisions due on ${day.date}`}
                              className={`inline-flex h-6 min-w-6 cursor-default items-center justify-center rounded px-1.5 text-xs font-medium tabular-nums transition-colors ${
                                index === 0
                                  ? "border border-amber-200/15 bg-amber-200/10 text-amber-100/80 hover:bg-amber-200/15"
                                  : "bg-white/[0.07] text-white/62 hover:bg-white/10"
                              }`}
                              type="button"
                            >
                              {day.dueCount}
                            </button>
                            <div
                              className={`absolute top-full z-30 hidden w-64 pt-1 group-hover/due:block group-focus-within/due:block ${
                                index % 7 >= 4 ? "right-0" : "left-0"
                              }`}
                            >
                              <div className="rounded-md border border-white/10 bg-[#202020] p-2.5 text-left shadow-xl">
                                <p className="mb-2 text-[11px] font-medium text-white/45">
                                  {index === 0 ? "Due now" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(`${day.date}T12:00:00`))}
                                </p>
                                <div className="max-h-52 space-y-2 overflow-y-auto overscroll-contain">
                                  {dueItems.map((item) => (
                                    <div key={`${item.documentPath}:${item.conceptName}`}>
                                      <p className="truncate text-[11px] text-white/38">{noteName(item.documentPath)}</p>
                                      <div className="flex items-start justify-between gap-2 text-xs text-white/78">
                                        <span className="min-w-0 break-words">{item.conceptName}</span>
                                        {item.count > 1 && <span className="shrink-0 text-white/38">{item.count}</span>}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                        </div>
                      );
                    })}
                  </div>
                </section>

                <aside className="flex h-full min-h-0 flex-col overflow-hidden pl-5">
                  <div className="shrink-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-white/62">Today</p>
                    <p className="mt-1 text-lg font-semibold text-white/92">Your revision plan</p>
                  </div>
                  <div className="mt-4 shrink-0 space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-md bg-white/[0.09] text-white/82">
                        <CalendarBlankIcon size={18} />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-white/90">{overview.dailyCardLimit} card limit</p>
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

                  <div className="mt-7 flex min-h-0 flex-1 flex-col">
                    <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-white/36">Upcoming</p>
                      <span className="text-[11px] text-white/26">Next 34 days</span>
                    </div>
                    {upcomingDays.length === 0 ? (
                      <p className="text-sm text-white/34">No future revisions scheduled.</p>
                    ) : (
                      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain pr-1">
                        {upcomingDays.map((day) => (
                          <div className="grid grid-cols-[52px_minmax(0,1fr)] gap-3" key={day.date}>
                            <div>
                              <p className="text-xs font-medium text-white/58">
                                {new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(new Date(`${day.date}T12:00:00`))}
                              </p>
                              <p className="mt-0.5 text-[11px] text-white/30">
                                {new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(new Date(`${day.date}T12:00:00`))}
                              </p>
                            </div>
                            <div className="min-w-0 space-y-2">
                              {day.items.slice(0, 3).map((item) => (
                                <div className="min-w-0" key={`${day.date}:${item.documentPath}:${item.conceptName}`}>
                                  <p className="truncate text-xs text-white/72">{item.conceptName}</p>
                                  <p className="truncate text-[11px] text-white/30">{noteName(item.documentPath)}</p>
                                </div>
                              ))}
                              {day.items.length > 3 && (
                                <p className="text-[11px] text-white/34">+{day.items.length - 3} more</p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </aside>
              </div>

              <section className="mt-6 pt-4">
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
      headerActions={session ? (
        <span className="shrink-0 text-xs font-normal text-white/38">
          {session.cards.length} cards · {new Set(session.cards.map((card) => card.sourceDocumentPath)).size} notes
        </span>
      ) : undefined}
      headerClassName={session ? "mb-1" : "mb-4"}
      keepMounted
      onClose={closeDialog}
      open={open}
      panelClassName="max-h-[calc(100vh-2rem)] max-w-6xl overflow-hidden"
      title={session ? (
        <button
          className="inline-flex items-center gap-2 rounded-md py-1 pr-2 text-white/72 transition hover:text-white"
          onClick={() => {
            setSession(null);
            void loadOverview();
          }}
          type="button"
        >
          <CaretLeftIcon size={15} />
          Revision
        </button>
      ) : "Revision"}
    />
  );
}
