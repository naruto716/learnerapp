"use client";

export const masteryCardKinds = [
  "feynman",
  "relationship",
  "contrast",
  "debugging",
  "diagnostic",
  "drill",
  "quiz",
  "scenario",
] as const;

export const masteryCardDifficulties = ["introductory", "standard", "advanced", "expert"] as const;
export const masteryThresholdLevels = ["familiar", "developing", "proficient", "advanced", "mastered"] as const;

export type MasteryScoringSettings = {
  passingScore: number;
  points: Record<(typeof masteryCardKinds)[number], Record<(typeof masteryCardDifficulties)[number], number>>;
  thresholds: Record<(typeof masteryThresholdLevels)[number], number>;
};

const storageKey = "learner.mastery.scoring.v1";

export const defaultMasteryScoringSettings: MasteryScoringSettings = {
  passingScore: 80,
  points: {
    feynman: { introductory: 8, standard: 12, advanced: 16, expert: 20 },
    relationship: { introductory: 8, standard: 12, advanced: 16, expert: 20 },
    contrast: { introductory: 8, standard: 12, advanced: 16, expert: 20 },
    debugging: { introductory: 10, standard: 14, advanced: 18, expert: 22 },
    diagnostic: { introductory: 8, standard: 12, advanced: 16, expert: 20 },
    drill: { introductory: 6, standard: 10, advanced: 14, expert: 18 },
    quiz: { introductory: 8, standard: 12, advanced: 18, expert: 24 },
    scenario: { introductory: 10, standard: 14, advanced: 20, expert: 26 },
  },
  thresholds: {
    familiar: 25,
    developing: 50,
    proficient: 80,
    advanced: 90,
    mastered: 95,
  },
};

function boundedInteger(value: unknown, fallback: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(100, Math.round(numeric))) : fallback;
}

function cloneDefaults(): MasteryScoringSettings {
  return {
    passingScore: defaultMasteryScoringSettings.passingScore,
    points: Object.fromEntries(
      masteryCardKinds.map((kind) => [kind, { ...defaultMasteryScoringSettings.points[kind] }]),
    ) as MasteryScoringSettings["points"],
    thresholds: { ...defaultMasteryScoringSettings.thresholds },
  };
}

export function normalizeMasterySettings(value: unknown): MasteryScoringSettings {
  const source = value && typeof value === "object" ? (value as Partial<MasteryScoringSettings>) : {};
  const defaults = cloneDefaults();
  const thresholds = Object.fromEntries(
    masteryThresholdLevels.map((level) => [
      level,
      boundedInteger(source.thresholds?.[level], defaults.thresholds[level]),
    ]),
  ) as MasteryScoringSettings["thresholds"];
  const orderedThresholds = masteryThresholdLevels.map((level) => thresholds[level]);
  const thresholdsAreValid = orderedThresholds.every(
    (threshold, index) => threshold > 0 && (index === 0 || threshold > orderedThresholds[index - 1]),
  );

  return {
    passingScore: Math.max(1, boundedInteger(source.passingScore, defaults.passingScore)),
    points: Object.fromEntries(
      masteryCardKinds.map((kind) => [
        kind,
        Object.fromEntries(
          masteryCardDifficulties.map((difficulty) => [
            difficulty,
            boundedInteger(source.points?.[kind]?.[difficulty], defaults.points[kind][difficulty]),
          ]),
        ),
      ]),
    ) as MasteryScoringSettings["points"],
    thresholds: thresholdsAreValid ? thresholds : defaults.thresholds,
  };
}

export function readMasterySettings(): MasteryScoringSettings {
  if (typeof window === "undefined") return cloneDefaults();
  try {
    return normalizeMasterySettings(JSON.parse(localStorage.getItem(storageKey) || "null"));
  } catch {
    return cloneDefaults();
  }
}

export function writeMasterySettings(settings: MasteryScoringSettings) {
  const normalized = normalizeMasterySettings(settings);
  if (typeof window !== "undefined") localStorage.setItem(storageKey, JSON.stringify(normalized));
  return normalized;
}

export function resetMasterySettings() {
  return writeMasterySettings(cloneDefaults());
}
