const crypto = require("crypto");
const {
  ensureMasteryStageStates,
  getMasteryDatabase,
  masteryLevelForStageStates,
  masteryStages,
} = require("./masteryConcepts");
const { threeDaysMs } = require("./masteryCardSchema");
const { normalizeMasteryScoringSettings } = require("./masteryScoring");

function targetedWeaknesses(card, state) {
  const ids = new Set(
    card.weaknessLinks
      .filter((link) => link.relationship === "target")
      .map((link) => link.weaknessId),
  );
  return state.weaknesses.filter((weakness) => ids.has(weakness.id));
}

function normalizeWeaknessKey(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
  return normalized || crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 20);
}

function upsertWeakness(db, { card, documentPath, outcome, passingScore, score, targetedIds, now }) {
  const requestedId = outcome.weaknessId && targetedIds.has(outcome.weaknessId) ? outcome.weaknessId : null;
  const resolved = Boolean(requestedId && score >= passingScore && outcome.state === "resolved");
  let row = requestedId ? db.prepare("SELECT * FROM mastery_weaknesses WHERE id = ?").get(requestedId) : null;

  if (!row) {
    const stableKey = normalizeWeaknessKey(
      `${outcome.title}|${[...outcome.conceptIds].sort((a, b) => a - b).join(",")}|${[...outcome.stages]
        .sort((a, b) => a - b)
        .join(",")}`,
    );
    row = db
      .prepare("SELECT * FROM mastery_weaknesses WHERE document_path = ? AND stable_key = ?")
      .get(documentPath, stableKey);
    if (!row) {
      const inserted = db
        .prepare(
          `INSERT INTO mastery_weaknesses(
             document_path, stable_key, title, description, status, exposed_at, updated_at
           ) VALUES (?, ?, ?, ?, 'active', ?, ?)`,
        )
        .run(documentPath, stableKey, outcome.title, outcome.description, now, now);
      row = db.prepare("SELECT * FROM mastery_weaknesses WHERE id = ?").get(Number(inserted.lastInsertRowid));
    }
  }

  const wasResolved = row.status === "resolved";
  const nextStatus = resolved ? "resolved" : "active";
  db
    .prepare(
      `UPDATE mastery_weaknesses
       SET title = ?, description = ?, status = ?, resolved_at = ?, resolving_card_id = ?,
           resolving_attempt_id = NULL, reopened_count = reopened_count + ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      outcome.title,
      outcome.description,
      nextStatus,
      resolved ? now : null,
      resolved ? card.id : null,
      wasResolved && !resolved ? 1 : 0,
      now,
      row.id,
    );

  const insertTarget = db.prepare(
    "INSERT OR IGNORE INTO mastery_weakness_targets(weakness_id, concept_id, stage) VALUES (?, ?, ?)",
  );
  outcome.conceptIds.forEach((conceptId) => {
    outcome.stages.forEach((stage) => insertTarget.run(row.id, conceptId, stage));
  });
  db
    .prepare(
      "INSERT OR IGNORE INTO mastery_card_weaknesses(card_id, weakness_id, relationship) VALUES (?, ?, ?)",
    )
    .run(card.id, row.id, requestedId ? "target" : "exposed");
  return { outcome: nextStatus, weaknessId: row.id };
}

function updateStageEvidence(db, card, score, now, masterySettings) {
  const cleared = score >= masterySettings.passingScore;
  const awardedPoints = cleared ? masterySettings.points[card.kind][card.difficulty] : 0;
  const update = db.prepare(
    `UPDATE mastery_stage_states
     SET score = ?, attempt_count = attempt_count + 1, last_reviewed_at = ?, next_due_at = ?,
         lapse_count = lapse_count + ?, updated_at = ?
     WHERE concept_id = ? AND stage = ?`,
  );
  const affectedConceptIds = new Set();

  card.targets.forEach((target) => {
    const state = db
      .prepare("SELECT * FROM mastery_stage_states WHERE concept_id = ? AND stage = ?")
      .get(target.conceptId, target.stage);
    const nextScore = Math.min(100, Number(state?.score || 0) + awardedPoints);
    update.run(
      nextScore,
      now,
      cleared ? null : now + threeDaysMs,
      cleared ? 0 : 1,
      now,
      target.conceptId,
      target.stage,
    );
    affectedConceptIds.add(target.conceptId);
  });

  affectedConceptIds.forEach((conceptId) => {
    const states = db
      .prepare("SELECT score, attempt_count FROM mastery_stage_states WHERE concept_id = ? ORDER BY stage")
      .all(conceptId);
    db
      .prepare(
        `UPDATE mastery_concepts
         SET mastery_level = ?, mastery_rationale = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        masteryLevelForStageStates(states, masterySettings),
        cleared
          ? `Cleared ${card.difficulty} ${card.kind} card ${card.id}: +${awardedPoints} points.`
          : `Card ${card.id} scored ${score}/100; no mastery points awarded.`,
        now,
        conceptId,
      );
  });
}

function includeMissingTargetedOutcomes(evaluation, card, state) {
  const outcomesById = new Set(
    evaluation.weaknessOutcomes.filter((outcome) => outcome.weaknessId).map((outcome) => outcome.weaknessId),
  );
  targetedWeaknesses(card, state).forEach((weakness) => {
    if (outcomesById.has(weakness.id)) return;
    evaluation.weaknessOutcomes.push({
      conceptIds: weakness.targets.map((target) => target.conceptId),
      description: weakness.description,
      stages: weakness.targets.map((target) => target.stage),
      state: "active",
      title: weakness.title,
      weaknessId: weakness.id,
    });
  });
}

function saveCardEvaluation({ answerMarkdown, card, documentPath, evaluation, mastery, masterySettings = {}, state }) {
  const normalizedSettings = normalizeMasteryScoringSettings(masterySettings);
  includeMissingTargetedOutcomes(evaluation, card, state);
  const db = getMasteryDatabase();
  const now = Date.now();
  const targetedIds = new Set(
    card.weaknessLinks.filter((link) => link.relationship === "target").map((link) => link.weaknessId),
  );

  db.exec("BEGIN IMMEDIATE");
  try {
    const attemptResult = db
      .prepare(
        `INSERT INTO mastery_card_attempts(card_id, answer_markdown, score, feedback_markdown, model, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(card.id, answerMarkdown, evaluation.score, evaluation.feedbackMarkdown, evaluation.model, now);
    const attemptId = Number(attemptResult.lastInsertRowid);
    const insertAttemptWeakness = db.prepare(
      "INSERT OR REPLACE INTO mastery_attempt_weaknesses(attempt_id, weakness_id, outcome) VALUES (?, ?, ?)",
    );

    evaluation.weaknessOutcomes.forEach((outcome) => {
      const conceptIds = outcome.conceptIds.filter((conceptId) =>
        mastery.concepts.some((concept) => concept.id === conceptId),
      );
      const stages = [...new Set(outcome.stages.filter((stage) => masteryStages.includes(stage)))];
      if (conceptIds.length === 0 || stages.length === 0) return;
      const result = upsertWeakness(db, {
        card,
        documentPath,
        now,
        outcome: { ...outcome, conceptIds, stages },
        passingScore: normalizedSettings.passingScore,
        score: evaluation.score,
        targetedIds,
      });
      insertAttemptWeakness.run(attemptId, result.weaknessId, result.outcome);
      if (result.outcome === "resolved") {
        db
          .prepare("UPDATE mastery_weaknesses SET resolving_attempt_id = ? WHERE id = ?")
          .run(attemptId, result.weaknessId);
      }
    });

    ensureMasteryStageStates(card.targets.map((target) => target.conceptId));
    updateStageEvidence(db, card, evaluation.score, now, normalizedSettings);
    db
      .prepare("UPDATE mastery_cards SET status = ?, retry_at = ?, updated_at = ? WHERE id = ?")
      .run(
        evaluation.score >= normalizedSettings.passingScore ? "done" : "delayed",
        evaluation.score >= normalizedSettings.passingScore ? null : now + threeDaysMs,
        now,
        card.id,
      );
    // The graded attempt retains the complete transcript. A future retry must start a new drill.
    db.prepare("DELETE FROM mastery_card_messages WHERE card_id = ?").run(card.id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

module.exports = {
  saveCardEvaluation,
  targetedWeaknesses,
};
