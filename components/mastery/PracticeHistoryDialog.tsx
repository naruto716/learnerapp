"use client";

import { SpinnerGapIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import Dialog from "@/components/Dialog";
import RichMarkdown from "@/components/markdown/RichMarkdown";
import { masteryBottomFadeStyle } from "./MasteryCardLayout";

const kindLabels: Partial<Record<MasteryCardKind, string>> = {
  contrast: "Contrast",
  debugging: "Fault diagnosis",
  diagnostic: "Diagnostic",
  drill: "Drill",
  feynman: "Feynman explanation",
  quiz: "Application",
  relationship: "Relationships",
  scenario: "Simulation",
};

function formatPracticeDate(value: number) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function effectiveOutcome(entry: MasteryPracticeEvidence) {
  if (entry.manualOutcome) return entry.manualOutcome;
  if (!entry.grading || entry.grading.status === "queued" || entry.grading.status === "running") return null;
  return entry.grading?.status === "succeeded" && (entry.grading.score ?? 0) >= entry.passingScore
    ? "passed"
    : "review";
}

function gradingLabel(entry: MasteryPracticeEvidence) {
  if (!entry.grading) return "Not submitted";
  if (entry.grading.status === "queued") return "Queued";
  if (entry.grading.status === "running") return "Grading";
  if (entry.grading.status === "failed") return "Grading failed";
  return `${entry.grading.score ?? 0}/100`;
}

export default function PracticeHistoryDialog({
  onClose,
  open,
  request,
  title,
}: {
  onClose: () => void;
  open: boolean;
  request: MasteryPracticeEvidenceRequest | null;
  title: string;
}) {
  const [entries, setEntries] = useState<MasteryPracticeEvidence[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const cardId = request?.cardId;
  const conceptId = request?.conceptId;
  const documentPath = request?.documentPath;

  useEffect(() => {
    if (!open || !documentPath) return;
    let cancelled = false;
    setError("");
    setLoading(true);
    window.learner?.listMasteryPracticeEvidence({ cardId, conceptId, documentPath })
      .then((nextEntries) => {
        if (!cancelled) setEntries(nextEntries ?? []);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Could not load practice history.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cardId, conceptId, documentPath, open]);

  return (
    <Dialog
      display={
        <div className="max-h-[min(72vh,760px)] overflow-y-auto pr-1" style={masteryBottomFadeStyle}>
          {loading ? (
            <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-white/44">
              <SpinnerGapIcon className="animate-spin" size={16} />
              Loading practice history
            </div>
          ) : error ? (
            <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-red-100/72">
              <WarningCircleIcon size={16} />
              {error}
            </div>
          ) : entries.length === 0 ? (
            <div className="flex min-h-48 items-center justify-center text-sm text-white/42">
              No practice history yet.
            </div>
          ) : (
            <div className="space-y-3 pb-5">
              {entries.map((entry) => {
                const outcome = effectiveOutcome(entry);
                return (
                  <article className="rounded-md border border-white/[0.07] bg-white/[0.025] p-4" key={entry.id}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-[10px] font-medium uppercase tracking-wide text-white/34">
                          {kindLabels[entry.card.kind] || entry.card.kind} · {formatPracticeDate(entry.sessionCreatedAt)}
                        </p>
                        <h3 className="mt-1 text-sm font-semibold leading-5 text-white/88">{entry.card.title}</h3>
                      </div>
                      <div className="flex shrink-0 items-center gap-2 text-xs font-semibold">
                        <span className={outcome === "passed"
                          ? "text-emerald-100/72"
                          : outcome === "review" ? "text-amber-100/72" : "text-white/42"}>
                          {outcome === "passed" ? "Passed" : outcome === "review" ? "Review" : "Pending"}
                        </span>
                        <span className="text-white/56">{gradingLabel(entry)}</span>
                      </div>
                    </div>

                    <section className="mt-4 border-t border-white/[0.07] pt-4">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-white/32">Your answer</p>
                      <RichMarkdown className="mt-2 text-sm leading-6 text-white/70">
                        {entry.answerMarkdown || "No answer recorded."}
                      </RichMarkdown>
                    </section>

                    <section className="mt-4 border-t border-white/[0.07] pt-4">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-white/32">Feedback</p>
                      <RichMarkdown className="mt-2 text-sm leading-6 text-white/74">
                        {entry.grading?.feedbackMarkdown || entry.grading?.error || "No feedback available."}
                      </RichMarkdown>
                    </section>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      }
      onClose={onClose}
      open={open}
      panelClassName="max-w-3xl"
      title={title}
    />
  );
}
