const {
  Rating,
  State,
  createEmptyCard,
  fsrs,
  generatorParameters,
} = require("ts-fsrs");
const { ensureMasteryStageStates } = require("./masteryConcepts");
const { normalizeMasteryScoringSettings } = require("./masteryScoring");

function ratingForScore(score, passingScore) {
  if (score < passingScore) return Rating.Again;
  const passingRange = Math.max(1, 100 - passingScore);
  const position = (score - passingScore) / passingRange;
  if (position < 0.25) return Rating.Hard;
  if (position >= 0.85) return Rating.Easy;
  return Rating.Good;
}

function schedulerForSettings(masterySettings) {
  return fsrs(generatorParameters({
    enable_fuzz: false,
    enable_short_term: true,
    request_retention: masterySettings.revisionRetention / 100,
  }));
}

function stageRowToFsrsCard(row, reviewedAt) {
  if (!row || !row.fsrs_state) return createEmptyCard(new Date(reviewedAt));
  return {
    due: new Date(row.next_due_at || reviewedAt),
    stability: Number(row.fsrs_stability || 0),
    difficulty: Number(row.fsrs_difficulty || 0),
    elapsed_days: 0,
    scheduled_days: Number(row.fsrs_scheduled_days || 0),
    learning_steps: Number(row.fsrs_learning_steps || 0),
    reps: Number(row.attempt_count || 0),
    lapses: Number(row.lapse_count || 0),
    state: Number(row.fsrs_state || State.New),
    last_review: row.last_reviewed_at ? new Date(row.last_reviewed_at) : undefined,
  };
}

function reviewStage({
  card,
  conceptId,
  conceptName,
  db,
  documentPath,
  eventKind = "graded",
  gradingRunId = null,
  masterySettings,
  outcome,
  reviewedAt,
  score,
  sessionCardId = null,
  sessionId = null,
  sourceCardId = null,
  submissionId = null,
  stage,
  startingCard = null,
}) {
  ensureMasteryStageStates([conceptId]);
  const validSessionId = sessionId && db.prepare("SELECT id FROM mastery_practice_sessions WHERE id = ?").get(sessionId)
    ? sessionId
    : null;
  const validSessionCardId = sessionCardId && db.prepare("SELECT id FROM mastery_practice_session_cards WHERE id = ?").get(sessionCardId)
    ? sessionCardId
    : null;
  const validSubmissionId = submissionId && db.prepare("SELECT id FROM mastery_practice_submissions WHERE id = ?").get(submissionId)
    ? submissionId
    : null;
  const validGradingRunId = gradingRunId && db.prepare("SELECT id FROM mastery_practice_grading_runs WHERE id = ?").get(gradingRunId)
    ? gradingRunId
    : null;
  const prior = db
    .prepare("SELECT * FROM mastery_stage_states WHERE concept_id = ? AND stage = ?")
    .get(conceptId, stage);
  const rating = outcome === "review" ? Rating.Again : ratingForScore(score, masterySettings.passingScore);
  const scheduler = schedulerForSettings(masterySettings);
  const priorCard = startingCard || stageRowToFsrsCard(prior, reviewedAt);
  const result = scheduler.repeat(priorCard, new Date(reviewedAt))[rating];
  const next = result.card;
  const nextDueAt = next.due.getTime();

  db.prepare(
    `UPDATE mastery_stage_states
     SET last_reviewed_at = ?, next_due_at = ?, fsrs_difficulty = ?, fsrs_stability = ?,
         fsrs_retrievability = ?, fsrs_state = ?, fsrs_scheduled_days = ?,
         fsrs_learning_steps = ?, updated_at = ?
     WHERE concept_id = ? AND stage = ?`,
  ).run(
    reviewedAt,
    nextDueAt,
    next.difficulty,
    next.stability,
    1,
    next.state,
    next.scheduled_days,
    next.learning_steps,
    reviewedAt,
    conceptId,
    stage,
  );

  const dedupeKey = eventKind === "graded"
    ? submissionId
      ? `graded:submission:${submissionId}:${conceptId}:${stage}`
      : gradingRunId
        ? `graded:run:${gradingRunId}:${conceptId}:${stage}`
        : `graded:direct:${sourceCardId || "legacy"}:${conceptId}:${stage}:${reviewedAt}`
    : `manual:${sessionCardId || "none"}:${outcome}:${conceptId}:${stage}:${reviewedAt}`;
  db.prepare(
    `INSERT OR IGNORE INTO mastery_revision_events(
       event_kind, document_path, concept_id, concept_name, stage, session_id,
       session_card_id, submission_id, grading_run_id, source_card_id, score,
       outcome, rating, reviewed_at, previous_due_at, next_due_at,
       previous_stability, next_stability, previous_difficulty, next_difficulty,
       metadata_json, dedupe_key
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    eventKind,
    documentPath,
    conceptId,
    conceptName,
    stage,
    validSessionId,
    validSessionCardId,
    validSubmissionId,
    validGradingRunId,
    sourceCardId,
    score,
    outcome,
    rating,
    reviewedAt,
    prior?.next_due_at ?? null,
    nextDueAt,
    prior?.fsrs_stability ?? null,
    next.stability,
    prior?.fsrs_difficulty ?? null,
    next.difficulty,
    JSON.stringify({
      cardKind: card.kind,
      difficulty: card.difficulty,
      priorCard: {
        ...priorCard,
        due: priorCard.due instanceof Date ? priorCard.due.getTime() : priorCard.due,
        last_review: priorCard.last_review instanceof Date ? priorCard.last_review.getTime() : priorCard.last_review,
      },
    }),
    dedupeKey,
  );
  return { nextDueAt, rating };
}

function scheduleCardTargets({
  card,
  db,
  documentPath,
  eventKind,
  gradingRunId,
  masterySettings: rawMasterySettings,
  outcome,
  reviewedAt,
  score,
  sessionCardId,
  sessionId,
  sourceCardId,
  submissionId,
}) {
  const masterySettings = normalizeMasteryScoringSettings(rawMasterySettings);
  return card.targets.map((target) => reviewStage({
    card,
    conceptId: target.conceptId,
    conceptName: target.conceptName || `Concept ${target.conceptId}`,
    db,
    documentPath,
    eventKind,
    gradingRunId,
    masterySettings,
    outcome,
    reviewedAt,
    score,
    sessionCardId,
    sessionId,
    sourceCardId,
    submissionId,
    stage: target.stage,
  }));
}

function rescheduleManualOutcome({
  card,
  db,
  documentPath,
  masterySettings: rawMasterySettings,
  outcome,
  reviewedAt,
  score,
  sessionCardId,
  sessionId,
  sourceCardId,
}) {
  const masterySettings = normalizeMasteryScoringSettings(rawMasterySettings);
  return card.targets.map((target) => {
    const gradedEvent = db.prepare(
      `SELECT metadata_json, reviewed_at
       FROM mastery_revision_events
       WHERE event_kind = 'graded' AND session_card_id = ? AND concept_id = ? AND stage = ?
       ORDER BY id ASC LIMIT 1`,
    ).get(sessionCardId, target.conceptId, target.stage);
    let startingCard = null;
    if (gradedEvent) {
      try {
        const priorCard = JSON.parse(gradedEvent.metadata_json || "{}").priorCard;
        if (priorCard) {
          startingCard = {
            ...priorCard,
            due: new Date(priorCard.due || gradedEvent.reviewed_at),
            last_review: priorCard.last_review ? new Date(priorCard.last_review) : undefined,
          };
        }
      } catch {
        startingCard = null;
      }
    }
    return reviewStage({
      card,
      conceptId: target.conceptId,
      conceptName: target.conceptName || `Concept ${target.conceptId}`,
      db,
      documentPath,
      eventKind: "manual_outcome",
      masterySettings,
      outcome,
      reviewedAt,
      score,
      sessionCardId,
      sessionId,
      sourceCardId,
      stage: target.stage,
      startingCard,
    });
  });
}

function backfillLegacyRevisionSchedules(db, masterySettings = {}) {
  const normalizedSettings = normalizeMasteryScoringSettings(masterySettings);
  const rows = db.prepare(
    `SELECT states.*, concepts.document_path, concepts.name AS concept_name
     FROM mastery_stage_states states
     JOIN mastery_concepts concepts ON concepts.id = states.concept_id
     WHERE states.attempt_count > 0 AND states.last_reviewed_at IS NOT NULL
       AND (states.next_due_at IS NULL OR states.fsrs_state = 0)`,
  ).all();
  rows.forEach((row) => {
    const syntheticCard = {
      difficulty: "standard",
      kind: "diagnostic",
      targets: [{ conceptId: row.concept_id, conceptName: row.concept_name, stage: row.stage }],
    };
    const outcome = row.next_due_at ? "review" : "passed";
    const score = outcome === "review"
      ? 0
      : normalizedSettings.passingScore + Math.round((100 - normalizedSettings.passingScore) / 2);
    reviewStage({
      card: syntheticCard,
      conceptId: row.concept_id,
      conceptName: row.concept_name,
      db,
      documentPath: row.document_path,
      eventKind: "graded",
      masterySettings: normalizedSettings,
      outcome,
      reviewedAt: row.last_reviewed_at,
      score,
      stage: row.stage,
    });
  });
  return rows.length;
}

module.exports = {
  backfillLegacyRevisionSchedules,
  ratingForScore,
  rescheduleManualOutcome,
  scheduleCardTargets,
};
