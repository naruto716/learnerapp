/* Centralizes the scoring contract shared by generation, evaluation, mastery
 * points, and revision scheduling. Settings are bounded so progression remains
 * valid even when persisted input is malformed. */
const cardKinds = [
  "feynman",
  "relationship",
  "contrast",
  "debugging",
  "diagnostic",
  "drill",
  "quiz",
  "scenario",
];
const cardDifficulties = ["introductory", "standard", "advanced", "expert"];
const thresholdLevels = ["familiar", "developing", "proficient", "advanced", "mastered"];

const defaultMasteryScoringSettings = {
  passingScore: 60,
  practiceCardCount: 5,
  revisionDailyCardLimit: 15,
  revisionRetention: 90,
  reviewCooldownDays: 3,
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
  thresholds: { familiar: 25, developing: 50, proficient: 80, advanced: 90, mastered: 95 },
};

function boundedInteger(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(100, Math.round(numeric))) : fallback;
}

function boundedPracticeCount(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(1, Math.min(50, Math.round(numeric))) : fallback;
}

function boundedCooldownDays(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(1, Math.min(365, Math.round(numeric))) : fallback;
}

function normalizeMasteryScoringSettings(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const thresholds = Object.fromEntries(
    thresholdLevels.map((level) => [
      level,
      boundedInteger(source.thresholds?.[level], defaultMasteryScoringSettings.thresholds[level]),
    ]),
  );
  const orderedThresholds = thresholdLevels.map((level) => thresholds[level]);
  const thresholdsAreValid = orderedThresholds.every(
    (threshold, index) => threshold > 0 && (index === 0 || threshold > orderedThresholds[index - 1]),
  );

  // Thresholds must be strictly increasing; otherwise fall back as a group so
  // mastery levels remain unambiguous rather than partially accepting settings.
  // Reject the complete threshold set when its order is impossible; partial
  // acceptance would make mastery levels ambiguous.
  return {
    passingScore: Math.max(1, boundedInteger(source.passingScore, defaultMasteryScoringSettings.passingScore)),
    practiceCardCount: boundedPracticeCount(
      source.practiceCardCount,
      defaultMasteryScoringSettings.practiceCardCount,
    ),
    revisionDailyCardLimit: boundedPracticeCount(
      source.revisionDailyCardLimit,
      defaultMasteryScoringSettings.revisionDailyCardLimit,
    ),
    revisionRetention: Math.max(
      70,
      Math.min(
        99,
        boundedInteger(source.revisionRetention, defaultMasteryScoringSettings.revisionRetention),
      ),
    ),
    reviewCooldownDays: boundedCooldownDays(
      source.reviewCooldownDays,
      defaultMasteryScoringSettings.reviewCooldownDays,
    ),
    points: Object.fromEntries(
      cardKinds.map((kind) => [
        kind,
        Object.fromEntries(
          cardDifficulties.map((difficulty) => [
            difficulty,
            boundedInteger(
              source.points?.[kind]?.[difficulty],
              defaultMasteryScoringSettings.points[kind][difficulty],
            ),
          ]),
        ),
      ]),
    ),
    thresholds: thresholdsAreValid ? thresholds : { ...defaultMasteryScoringSettings.thresholds },
  };
}

module.exports = {
  cardDifficulties,
  cardKinds,
  defaultMasteryScoringSettings,
  normalizeMasteryScoringSettings,
  thresholdLevels,
};
