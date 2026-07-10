"use client";

import { type FormEvent, useState } from "react";
import Dialog from "@/components/Dialog";
import { masteryThresholdLevels } from "./masterySettings";

const proficiencyLabels: Record<MasteryTargetProficiency, string> = {
  familiar: "Familiar",
  developing: "Developing",
  proficient: "Proficient",
  advanced: "Advanced",
  mastered: "Mastered",
};

type MasteryCardGenerationDialogProps = {
  hasCards: boolean;
  onClose: () => void;
  onGenerate: (preferences: MasteryCardPreferences) => boolean | Promise<boolean>;
  overlayClassName: string;
  preferences: MasteryCardPreferences;
};

export default function MasteryCardGenerationDialog({
  hasCards,
  onClose,
  onGenerate,
  overlayClassName,
  preferences,
}: MasteryCardGenerationDialogProps) {
  const [generationPrompt, setGenerationPrompt] = useState(preferences.generationPrompt);
  const [targetProficiency, setTargetProficiency] = useState<MasteryTargetProficiency>(
    preferences.targetProficiency,
  );
  const targetIndex = masteryThresholdLevels.indexOf(targetProficiency);
  const targetPercentage = (targetIndex / (masteryThresholdLevels.length - 1)) * 100;
  const targetTrackBackground = `linear-gradient(to right, rgba(255,255,255,0.72) 0%, rgba(255,255,255,0.72) ${targetPercentage}%, rgba(255,255,255,0.12) ${targetPercentage}%, rgba(255,255,255,0.12) 100%)`;

  const formId = "mastery-card-generation-form";
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void onGenerate({ generationPrompt, targetProficiency });
    onClose();
  };

  return (
    <Dialog
      display={
        <form className="space-y-5" id={formId} onSubmit={handleSubmit}>
          <div className="flex items-start justify-between gap-3 pb-4 text-[11px] font-medium uppercase tracking-wide">
            <span className="shrink-0 whitespace-nowrap text-white/34">Target proficiency</span>
            <div className="relative min-w-0 flex-1">
              <input
                aria-label="Set target proficiency"
                aria-valuetext={proficiencyLabels[targetProficiency]}
                className="h-2 min-w-0 w-full cursor-pointer appearance-none rounded-full bg-white/[0.12] accent-white outline-none [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
                max={masteryThresholdLevels.length - 1}
                min={0}
                onChange={(event) => {
                  const proficiency = masteryThresholdLevels[Number(event.currentTarget.value)];
                  if (proficiency) setTargetProficiency(proficiency);
                }}
                step={1}
                style={{ background: targetTrackBackground }}
                type="range"
                value={targetIndex}
              />
              <span
                className="pointer-events-none absolute top-full mt-1.5 -translate-x-1/2 whitespace-nowrap text-[10px] font-medium uppercase tracking-wide text-white/40"
                style={{ left: `clamp(12px, ${targetPercentage}%, calc(100% - 12px))` }}
              >
                {proficiencyLabels[targetProficiency]}
              </span>
            </div>
          </div>

          <label className="block">
            <span className="text-xs font-medium text-white/48">Generation prompt</span>
            <textarea
              autoFocus
              className="mt-2 min-h-32 w-full resize-y rounded-md bg-black/20 px-3 py-3 text-sm leading-6 text-white outline-none ring-1 ring-white/[0.09] placeholder:text-white/24 focus:ring-white/[0.22]"
              onChange={(event) => setGenerationPrompt(event.target.value)}
              placeholder="Optional, for example: focus on payment idempotency and difficult debugging cases"
              value={generationPrompt}
            />
          </label>
        </form>
      }
      footer={
        <button
          className="rounded-md bg-white px-4 py-2 text-sm font-semibold text-black transition hover:bg-white/88"
          form={formId}
          type="submit"
        >
          {hasCards ? "Generate more cards" : "Generate cards"}
        </button>
      }
      onClose={onClose}
      open={true}
      overlayClassName={overlayClassName}
      panelClassName="max-w-xl"
      title={hasCards ? "Generate cards" : "Create a practice deck"}
    />
  );
}
