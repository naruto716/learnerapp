const { getDocumentMastery, getMasteryDatabase, normalizeDocumentPath } = require("./masteryConcepts");
const { ensureMasteryCardSchema } = require("./masteryCardSchema");
const { requestCardEvaluation } = require("./masteryCardAi");
const { saveCardEvaluation, targetedWeaknesses } = require("./masteryCardProgress");
const { getDocumentMasteryCards } = require("./masteryCardStore");
const { normalizeMasteryScoringSettings } = require("./masteryScoring");

const staleRunMs = 5 * 60 * 1000;
let gradingWorkerRunning = false;

function parseJson(value, fallback) {
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return fallback;
  }
}

function cardConceptContext(card, mastery) {
  const conceptIds = new Set(card.targets.map((target) => target.conceptId));
  return mastery.concepts
    .filter((concept) => conceptIds.has(concept.id))
    .map((concept) => `## ${concept.name}\n\n${concept.explanationMarkdown}`)
    .join("\n\n");
}

function snapshotTargetedWeaknesses(card, snapshot) {
  const targetedIds = new Set(
    card.weaknessLinks
      .filter((link) => link.relationship === "target")
      .map((link) => link.weaknessId),
  );
  return (snapshot?.weaknesses || []).filter((weakness) => targetedIds.has(weakness.id));
}

function ensurePracticeSchema() {
  ensureMasteryCardSchema();
  getMasteryDatabase()
    .prepare(
      `UPDATE mastery_practice_grading_runs
       SET status = 'queued', started_at = NULL, updated_at = ?
       WHERE status = 'running' AND started_at < ?`,
    )
    .run(Date.now(), Date.now() - staleRunMs);
}

function latestRunRows(sessionId) {
  return getMasteryDatabase()
    .prepare(
      `SELECT runs.* FROM mastery_practice_grading_runs runs
       JOIN mastery_practice_submissions submissions ON submissions.id = runs.submission_id
       JOIN mastery_practice_session_cards cards ON cards.id = submissions.session_card_id
       JOIN (
         SELECT submission_id, MAX(id) AS latest_id
         FROM mastery_practice_grading_runs
         GROUP BY submission_id
       ) latest ON latest.latest_id = runs.id
       WHERE cards.session_id = ?`,
    )
    .all(sessionId);
}

function refreshSessionStatus(sessionId) {
  const db = getMasteryDatabase();
  const session = db.prepare("SELECT * FROM mastery_practice_sessions WHERE id = ?").get(sessionId);
  if (!session) return;
  const cardCount = db
    .prepare("SELECT COUNT(*) AS count FROM mastery_practice_session_cards WHERE session_id = ?")
    .get(sessionId).count;
  const submissionCount = db
    .prepare(
      `SELECT COUNT(*) AS count FROM mastery_practice_submissions submissions
       JOIN mastery_practice_session_cards cards ON cards.id = submissions.session_card_id
       WHERE cards.session_id = ?`,
    )
    .get(sessionId).count;
  if (submissionCount < cardCount) {
    db.prepare("UPDATE mastery_practice_sessions SET status = 'active', updated_at = ? WHERE id = ?")
      .run(Date.now(), sessionId);
    return;
  }

  const runs = latestRunRows(sessionId);
  const active = runs.some((run) => run.status === "queued" || run.status === "running");
  const failed = runs.some((run) => run.status === "failed");
  const now = Date.now();
  const status = active ? "grading" : failed ? "needs_attention" : "complete";
  db.prepare(
    `UPDATE mastery_practice_sessions
     SET status = ?, submitted_at = COALESCE(submitted_at, ?),
         completed_at = ?, updated_at = ?
     WHERE id = ?`,
  ).run(status, now, status === "complete" ? now : null, now, sessionId);
}

function practiceSessionResult(sessionId) {
  ensurePracticeSchema();
  const db = getMasteryDatabase();
  const session = db.prepare("SELECT * FROM mastery_practice_sessions WHERE id = ?").get(Number(sessionId));
  if (!session) throw new Error("Practice session was not found.");
  const rows = db
    .prepare(
      `SELECT cards.*, submissions.id AS submission_id, submissions.answer_markdown,
              submissions.submitted_at,
              runs.id AS run_id, runs.kind AS run_kind, runs.status AS grading_status,
              runs.score, runs.feedback_markdown, runs.model, runs.error,
              runs.effects_applied, runs.started_at, runs.completed_at AS graded_at
       FROM mastery_practice_session_cards cards
       LEFT JOIN mastery_practice_submissions submissions ON submissions.session_card_id = cards.id
       LEFT JOIN mastery_practice_grading_runs runs ON runs.id = (
         SELECT MAX(candidate.id) FROM mastery_practice_grading_runs candidate
         WHERE candidate.submission_id = submissions.id
       )
       WHERE cards.session_id = ?
       ORDER BY cards.sort_order, cards.id`,
    )
    .all(session.id);

  return {
    completedAt: session.completed_at ?? null,
    createdAt: session.created_at,
    documentPath: session.document_path,
    id: session.id,
    masterySettings: normalizeMasteryScoringSettings(parseJson(session.mastery_settings_json, {})),
    status: session.status,
    submittedAt: session.submitted_at ?? null,
    cards: rows.map((row) => {
      const snapshot = parseJson(row.card_json, {});
      return {
        answerMarkdown: row.answer_markdown || "",
        card: snapshot.card || snapshot,
        concepts: snapshot.concepts || [],
        grading: row.run_id
          ? {
              effectsApplied: Boolean(row.effects_applied),
              error: row.error || "",
              feedbackMarkdown: row.feedback_markdown || "",
              gradedAt: row.graded_at ?? null,
              id: row.run_id,
              kind: row.run_kind,
              model: row.model || "",
              score: row.score ?? null,
              startedAt: row.started_at ?? null,
              status: row.grading_status,
            }
          : null,
        id: row.id,
        metaphor: snapshot.metaphor || null,
        sortOrder: row.sort_order,
        sourceCardId: row.source_card_id ?? null,
        submittedAt: row.submitted_at ?? null,
        weaknesses: snapshot.weaknesses || [],
      };
    }),
  };
}

function createPracticeSession({ cardIds = [], desiredCount = 5, documentPath, markdown = "", masterySettings = {} }) {
  ensurePracticeSchema();
  const normalizedPath = normalizeDocumentPath(documentPath);
  if (!normalizedPath) throw new Error("Document path is required.");
  const state = getDocumentMasteryCards(normalizedPath);
  const requestedIds = [...new Set(cardIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  const cards = requestedIds.length > 0
    ? requestedIds.map((id) => state.cards.find((card) => card.id === id)).filter(Boolean)
    : state.cards.filter((card) => card.status === "active").slice(0, Math.max(1, Number(desiredCount) || 5));
  if (requestedIds.length > 0 && cards.length !== requestedIds.length) {
    throw new Error("One or more selected cards are no longer available.");
  }
  if (cards.length === 0) throw new Error("No ready cards are available for practice.");
  if (requestedIds.length === 0 && cards.length < Math.max(1, Number(desiredCount) || 5)) {
    throw new Error("Generate more ready cards before starting this practice.");
  }

  const db = getMasteryDatabase();
  const mastery = getDocumentMastery(normalizedPath, markdown);
  const now = Date.now();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = db
      .prepare(
        `INSERT INTO mastery_practice_sessions(
           document_path, status, document_markdown, mastery_settings_json, created_at, updated_at
         ) VALUES (?, 'active', ?, ?, ?, ?)`,
      )
      .run(normalizedPath, String(markdown || ""), JSON.stringify(normalizeMasteryScoringSettings(masterySettings)), now, now);
    const sessionId = Number(result.lastInsertRowid);
    const insertCard = db.prepare(
      `INSERT INTO mastery_practice_session_cards(
         session_id, source_card_id, sort_order, card_json, created_at
       ) VALUES (?, ?, ?, ?, ?)`,
    );
    cards.forEach((card, index) => {
      const conceptIds = new Set(card.targets.map((target) => target.conceptId));
      const weaknessIds = new Set(card.weaknessLinks.map((link) => link.weaknessId));
      insertCard.run(
        sessionId,
        card.id,
        index,
        JSON.stringify({
          card,
          concepts: mastery.concepts.filter((concept) => conceptIds.has(concept.id)),
          metaphor: mastery.metaphor,
          weaknesses: state.weaknesses.filter((weakness) => weaknessIds.has(weakness.id)),
        }),
        now,
      );
    });
    db.exec("COMMIT");
    return practiceSessionResult(sessionId);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function claimNextRun() {
  ensurePracticeSchema();
  const db = getMasteryDatabase();
  db.exec("BEGIN IMMEDIATE");
  try {
    const run = db
      .prepare(
        `SELECT runs.id FROM mastery_practice_grading_runs runs
         WHERE runs.status = 'queued'
         ORDER BY runs.queued_at, runs.id LIMIT 1`,
      )
      .get();
    if (!run) {
      db.exec("COMMIT");
      return null;
    }
    const now = Date.now();
    db.prepare(
      `UPDATE mastery_practice_grading_runs
       SET status = 'running', started_at = ?, updated_at = ?
       WHERE id = ? AND status = 'queued'`,
    ).run(now, now, run.id);
    const row = db
      .prepare(
        `SELECT runs.*, submissions.answer_markdown, submissions.id AS submission_id,
                cards.source_card_id, cards.card_json, cards.session_id,
                sessions.document_path, sessions.document_markdown, sessions.mastery_settings_json
         FROM mastery_practice_grading_runs runs
         JOIN mastery_practice_submissions submissions ON submissions.id = runs.submission_id
         JOIN mastery_practice_session_cards cards ON cards.id = submissions.session_card_id
         JOIN mastery_practice_sessions sessions ON sessions.id = cards.session_id
         WHERE runs.id = ?`,
      )
      .get(run.id);
    db.exec("COMMIT");
    return row;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

async function gradeRun(run) {
  const snapshot = parseJson(run.card_json, null);
  const card = snapshot?.card || snapshot;
  if (!card) throw new Error("The practice card snapshot is invalid.");
  const masterySettings = normalizeMasteryScoringSettings(parseJson(run.mastery_settings_json, {}));
  const mastery = getDocumentMastery(run.document_path, run.document_markdown);
  const state = getDocumentMasteryCards(run.document_path);
  const snapshotMastery = snapshot?.concepts
    ? { ...mastery, concepts: snapshot.concepts }
    : mastery;
  const evaluation = await requestCardEvaluation({
    answerMarkdown: run.answer_markdown,
    card,
    conceptContext: cardConceptContext(card, snapshotMastery),
    passingScore: masterySettings.passingScore,
    settings: {},
    weaknesses: snapshot?.weaknesses
      ? snapshotTargetedWeaknesses(card, snapshot)
      : targetedWeaknesses(card, state),
  });

  const db = getMasteryDatabase();
  const effectsAlreadyApplied = Boolean(
    db.prepare(
      `SELECT 1 FROM mastery_practice_grading_runs
       WHERE submission_id = ? AND effects_applied = 1 LIMIT 1`,
    ).get(run.submission_id),
  );
  let effectsApplied = false;
  if (!effectsAlreadyApplied && run.source_card_id && state.cards.some((candidate) => candidate.id === run.source_card_id)) {
    saveCardEvaluation({
      answerMarkdown: run.answer_markdown,
      card: { ...card, id: run.source_card_id },
      documentPath: run.document_path,
      evaluation,
      mastery,
      masterySettings,
      practiceRunId: run.id,
      practiceSubmissionId: run.submission_id,
      state,
    });
    effectsApplied = true;
  }

  const now = Date.now();
  db.prepare(
    `UPDATE mastery_practice_grading_runs
     SET status = 'succeeded', score = ?, feedback_markdown = ?, evaluation_json = ?,
         model = ?, error = NULL, effects_applied = ?, completed_at = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    evaluation.score,
    evaluation.feedbackMarkdown,
    JSON.stringify(evaluation),
    evaluation.model || null,
    effectsApplied ? 1 : 0,
    now,
    now,
    run.id,
  );
  refreshSessionStatus(run.session_id);
}

async function runGradingWorker() {
  if (gradingWorkerRunning) return;
  gradingWorkerRunning = true;
  try {
    while (true) {
      const run = claimNextRun();
      if (!run) break;
      try {
        await gradeRun(run);
      } catch (error) {
        const now = Date.now();
        getMasteryDatabase()
          .prepare(
            `UPDATE mastery_practice_grading_runs
             SET status = 'failed', error = ?, completed_at = ?, updated_at = ? WHERE id = ?`,
          )
          .run(error instanceof Error ? error.message : "Grading failed.", now, now, run.id);
        refreshSessionStatus(run.session_id);
      }
    }
  } finally {
    gradingWorkerRunning = false;
  }
}

function kickPracticeGrading() {
  void runGradingWorker();
}

function submitPracticeAnswer({ answerMarkdown, sessionCardId }) {
  ensurePracticeSchema();
  const answer = String(answerMarkdown || "").trim();
  if (!answer) throw new Error("Write an answer before submitting this card.");
  const db = getMasteryDatabase();
  const card = db
    .prepare(
      `SELECT cards.*, sessions.status AS session_status
       FROM mastery_practice_session_cards cards
       JOIN mastery_practice_sessions sessions ON sessions.id = cards.session_id
       WHERE cards.id = ?`,
    )
    .get(Number(sessionCardId));
  if (!card) throw new Error("Practice card was not found.");
  if (card.session_status !== "active") throw new Error("This practice session is no longer accepting answers.");
  if (db.prepare("SELECT id FROM mastery_practice_submissions WHERE session_card_id = ?").get(card.id)) {
    throw new Error("This practice answer was already submitted.");
  }

  const now = Date.now();
  db.exec("BEGIN IMMEDIATE");
  try {
    const submission = db
      .prepare(
        `INSERT INTO mastery_practice_submissions(session_card_id, answer_markdown, submitted_at)
         VALUES (?, ?, ?)`,
      )
      .run(card.id, answer, now);
    db.prepare(
      `INSERT INTO mastery_practice_grading_runs(
         submission_id, kind, status, queued_at, updated_at
       ) VALUES (?, 'initial', 'queued', ?, ?)`,
    ).run(Number(submission.lastInsertRowid), now, now);
    db.prepare("UPDATE mastery_practice_sessions SET updated_at = ? WHERE id = ?").run(now, card.session_id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  refreshSessionStatus(card.session_id);
  kickPracticeGrading();
  return practiceSessionResult(card.session_id);
}

function retryPracticeGrading({ sessionCardId }) {
  ensurePracticeSchema();
  const db = getMasteryDatabase();
  const submission = db
    .prepare(
      `SELECT submissions.*, cards.session_id
       FROM mastery_practice_submissions submissions
       JOIN mastery_practice_session_cards cards ON cards.id = submissions.session_card_id
       WHERE submissions.session_card_id = ?`,
    )
    .get(Number(sessionCardId));
  if (!submission) throw new Error("Submit an answer before requesting grading.");
  const latest = db
    .prepare(
      `SELECT * FROM mastery_practice_grading_runs
       WHERE submission_id = ? ORDER BY id DESC LIMIT 1`,
    )
    .get(submission.id);
  if (latest && (latest.status === "queued" || latest.status === "running")) {
    return practiceSessionResult(submission.session_id);
  }
  const now = Date.now();
  db.prepare(
    `INSERT INTO mastery_practice_grading_runs(
       submission_id, kind, status, queued_at, updated_at
     ) VALUES (?, ?, 'queued', ?, ?)`,
  ).run(submission.id, latest?.status === "succeeded" ? "regrade" : "retry", now, now);
  db.prepare(
    `UPDATE mastery_practice_sessions
     SET status = 'grading', completed_at = NULL, updated_at = ? WHERE id = ?`,
  ).run(now, submission.session_id);
  kickPracticeGrading();
  return practiceSessionResult(submission.session_id);
}

function getPracticeSession(sessionId) {
  kickPracticeGrading();
  return practiceSessionResult(sessionId);
}

function listPracticeSessions(documentPath) {
  ensurePracticeSchema();
  const normalizedPath = normalizeDocumentPath(documentPath);
  if (!normalizedPath) throw new Error("Document path is required.");
  return getMasteryDatabase()
    .prepare(
      `SELECT sessions.*,
              (SELECT COUNT(*) FROM mastery_practice_session_cards cards WHERE cards.session_id = sessions.id) AS card_count,
              (SELECT ROUND(AVG(runs.score))
               FROM mastery_practice_session_cards cards
               JOIN mastery_practice_submissions submissions ON submissions.session_card_id = cards.id
               JOIN mastery_practice_grading_runs runs ON runs.id = (
                 SELECT MAX(candidate.id) FROM mastery_practice_grading_runs candidate
                 WHERE candidate.submission_id = submissions.id AND candidate.status = 'succeeded'
               )
               WHERE cards.session_id = sessions.id) AS average_score
       FROM mastery_practice_sessions sessions
       WHERE sessions.document_path = ?
       ORDER BY sessions.created_at DESC, sessions.id DESC`,
    )
    .all(normalizedPath)
    .map((row) => ({
      averageScore: row.average_score ?? null,
      cardCount: row.card_count,
      completedAt: row.completed_at ?? null,
      createdAt: row.created_at,
      id: row.id,
      status: row.status,
    }));
}

module.exports = {
  createPracticeSession,
  ensurePracticeSchema,
  getPracticeSession,
  kickPracticeGrading,
  listPracticeSessions,
  retryPracticeGrading,
  submitPracticeAnswer,
};