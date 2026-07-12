const { getDocumentMastery, getMasteryDatabase, normalizeDocumentPath } = require("./masteryConcepts");
const { ensureMasteryCardSchema } = require("./masteryCardSchema");
const { requestCardEvaluation, requestRevisionCards } = require("./masteryCardAi");
const { saveCardEvaluation, targetedWeaknesses } = require("./masteryCardProgress");
const { getDocumentMasteryCards } = require("./masteryCardStore");
const { saveGeneratedCards } = require("./masteryCardStore");
const { normalizeMasteryScoringSettings } = require("./masteryScoring");
const { rescheduleManualOutcome } = require("./masteryRevision");

const staleRunMs = 5 * 60 * 1000;
let gradingWorkerRunning = false;
let revisionPreparationPromise = null;

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
    scope: session.scope || "document",
    sessionKind: session.session_kind || "practice",
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
        manualOutcome: row.manual_outcome || null,
        metaphor: snapshot.metaphor || null,
        sortOrder: row.sort_order,
        sourceCardId: row.source_card_id ?? null,
        sourceDocumentPath: row.source_document_path || session.document_path,
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
  if (requestedIds.length > 0 && cards.some((card) => card.status !== "active")) {
    throw new Error("Only ready cards can be selected for practice.");
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
         session_id, source_card_id, source_document_path, source_document_markdown,
         sort_order, card_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    cards.forEach((card, index) => {
      const conceptIds = new Set(card.targets.map((target) => target.conceptId));
      const weaknessIds = new Set(card.weaknessLinks.map((link) => link.weaknessId));
      insertCard.run(
        sessionId,
        card.id,
        normalizedPath,
        String(markdown || ""),
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

function dueRevisionRows(now = Date.now()) {
  ensurePracticeSchema();
  return getMasteryDatabase()
    .prepare(
      `SELECT states.*, concepts.document_path, concepts.name AS concept_name,
              concepts.explanation_markdown, concepts.source_excerpt_markdown,
              concepts.mastery_level,
              (SELECT COUNT(*) FROM mastery_weakness_targets targets
               JOIN mastery_weaknesses weaknesses ON weaknesses.id = targets.weakness_id
               WHERE targets.concept_id = states.concept_id AND targets.stage = states.stage
                 AND weaknesses.status = 'active') AS active_weakness_count
       FROM mastery_stage_states states
       JOIN mastery_concepts concepts ON concepts.id = states.concept_id
       WHERE concepts.status = 'active' AND states.status = 'active'
         AND states.next_due_at IS NOT NULL
       ORDER BY states.next_due_at ASC, active_weakness_count DESC,
                states.lapse_count DESC, states.score ASC, concepts.document_path, concepts.id, states.stage`,
    )
    .all()
    .map((row) => ({ ...row, is_due: row.next_due_at <= now }));
}

function revisionOverview({ days = 35, masterySettings = {} } = {}) {
  const normalizedSettings = normalizeMasteryScoringSettings(masterySettings);
  const now = Date.now();
  const rows = dueRevisionRows(now);
  const dueRows = rows.filter((row) => row.is_due);
  const preparationPlan = revisionPreparationPlan({ masterySettings: normalizedSettings, now });
  const notes = new Map();
  rows.forEach((row) => {
    const note = notes.get(row.document_path) || {
      concepts: new Map(),
      documentPath: row.document_path,
      dueCount: 0,
      lastReviewedAt: null,
      nextDueAt: null,
    };
    note.dueCount += row.is_due ? 1 : 0;
    note.lastReviewedAt = Math.max(note.lastReviewedAt || 0, row.last_reviewed_at || 0) || null;
    note.nextDueAt = Math.min(note.nextDueAt ?? Number.POSITIVE_INFINITY, row.next_due_at);
    const concept = note.concepts.get(row.concept_id) || {
      dueCount: 0,
      id: row.concept_id,
      lastReviewedAt: null,
      name: row.concept_name,
      nextDueAt: null,
      stages: [],
    };
    concept.dueCount += row.is_due ? 1 : 0;
    concept.lastReviewedAt = Math.max(concept.lastReviewedAt || 0, row.last_reviewed_at || 0) || null;
    concept.nextDueAt = Math.min(concept.nextDueAt ?? Number.POSITIVE_INFINITY, row.next_due_at);
    concept.stages.push({
      dueAt: row.next_due_at,
      isDue: row.is_due,
      lapseCount: row.lapse_count,
      score: Number(row.score),
      stage: row.stage,
    });
    note.concepts.set(row.concept_id, concept);
    notes.set(row.document_path, note);
  });

  const calendarStart = new Date(now);
  calendarStart.setHours(0, 0, 0, 0);
  const dayCounts = new Map();
  rows.forEach((row) => {
    const date = new Date(Math.max(row.next_due_at, calendarStart.getTime()));
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    dayCounts.set(key, (dayCounts.get(key) || 0) + 1);
  });
  const calendar = Array.from({ length: Math.max(7, Math.min(90, Number(days) || 35)) }, (_, index) => {
    const date = new Date(calendarStart.getTime() + index * 24 * 60 * 60 * 1000);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return { date: key, dueCount: dayCounts.get(key) || 0 };
  });
  const activeSession = getMasteryDatabase().prepare(
    `SELECT sessions.id FROM mastery_practice_sessions sessions
     WHERE sessions.session_kind = 'revision' AND sessions.scope = 'global'
       AND sessions.status != 'complete'
     ORDER BY sessions.created_at DESC, sessions.id DESC LIMIT 1`,
  ).get();
  return {
    activeSessionId: activeSession?.id ?? null,
    calendar,
    dailyCardLimit: normalizedSettings.revisionDailyCardLimit,
    dueCount: dueRows.length,
    notes: [...notes.values()].map((note) => ({
      ...note,
      concepts: [...note.concepts.values()],
      nextDueAt: Number.isFinite(note.nextDueAt) ? note.nextDueAt : null,
    })),
    overdueCount: dueRows.filter((row) => row.next_due_at < calendarStart.getTime()).length,
    preparedCardCount: preparationPlan.selected.length,
    preparingCards: Boolean(revisionPreparationPromise),
    requiredCardCount: preparationPlan.selected.length + preparationPlan.conceptsToGenerate.length,
  };
}

function fallbackRevisionCard(row) {
  const stagePrompts = {
    2: "Explain the concept plainly, including its purpose and core mechanism.",
    3: "Connect this concept to another idea or consequence from the note, and explain why the connection holds.",
    4: "Describe the concept's structure: its important parts, relationships, and boundaries.",
    5: "Describe a likely misunderstanding or failure involving this concept, then diagnose and correct it.",
    6: "Apply this concept to a concrete example or decision and justify the result.",
  };
  return {
    answerMode: "single_turn",
    conceptContextVisible: false,
    contextMarkdown: row.source_excerpt_markdown || "",
    difficulty: "standard",
    expectedAnswerMarkdown: row.explanation_markdown || row.source_excerpt_markdown || row.concept_name,
    graphEdgeIds: [],
    kind: "diagnostic",
    metaphorContextVisible: false,
    promptMarkdown: stagePrompts[row.stage] || "Explain and apply this concept.",
    rubricMarkdown: `The answer accurately demonstrates ${row.concept_name} at mastery stage ${row.stage}, uses the note's meaning, and explains its reasoning rather than only naming terms.`,
    targetedWeaknessIds: [],
    targets: [{ conceptId: row.concept_id, conceptName: row.concept_name, stage: row.stage }],
    title: row.concept_name,
    weaknessLinks: [],
  };
}

function dueTargetKey(target) {
  return `${target.conceptId}:${target.stage}`;
}

function revisionPreparationPlan({ masterySettings = {}, now = Date.now() } = {}) {
  const normalizedSettings = normalizeMasteryScoringSettings(masterySettings);
  const dueRows = dueRevisionRows(now).filter((row) => row.is_due);
  const targetRows = new Map(dueRows.map((row) => [`${row.concept_id}:${row.stage}`, row]));
  const uncovered = new Set(targetRows.keys());
  const selected = [];
  const statesByPath = new Map();
  const candidateCards = [];

  [...new Set(dueRows.map((row) => row.document_path))].forEach((documentPath) => {
    const state = getDocumentMasteryCards(documentPath);
    statesByPath.set(documentPath, state);
    state.cards.forEach((card) => {
      if (card.status !== "active") return;
      const covered = card.targets.map(dueTargetKey).filter((key) => targetRows.has(key));
      if (covered.length > 0) candidateCards.push({ card, covered, documentPath, state });
    });
  });

  while (selected.length < normalizedSettings.revisionDailyCardLimit) {
    const best = candidateCards
      .filter((candidate) => !selected.some((entry) => entry.card.id === candidate.card.id))
      .map((candidate) => ({
        ...candidate,
        uncoveredTargets: candidate.covered.filter((key) => uncovered.has(key)),
      }))
      .filter((candidate) => candidate.uncoveredTargets.length > 0)
      .sort((left, right) => right.uncoveredTargets.length - left.uncoveredTargets.length)[0];
    if (!best) break;
    best.uncoveredTargets.forEach((key) => uncovered.delete(key));
    selected.push({
      card: {
        ...best.card,
        targets: best.card.targets.filter((target) => best.uncoveredTargets.includes(dueTargetKey(target))),
      },
      documentPath: best.documentPath,
      state: best.state,
    });
  }

  const uncoveredRows = [...uncovered].map((key) => targetRows.get(key)).filter(Boolean);
  const conceptsToGenerate = [...new Set(uncoveredRows.map((row) => row.concept_id))]
    .slice(0, Math.max(0, normalizedSettings.revisionDailyCardLimit - selected.length))
    .map((conceptId) => {
      const rows = uncoveredRows.filter((row) => row.concept_id === conceptId);
      return {
        documentPath: rows[0].document_path,
        explanationMarkdown: rows[0].explanation_markdown || "",
        id: conceptId,
        name: rows[0].concept_name,
        sourceExcerptMarkdown: rows[0].source_excerpt_markdown || "",
        stages: rows.map((row) => row.stage),
      };
    });
  return { conceptsToGenerate, dueRows, selected };
}

async function prepareRevisionCards({ masterySettings = {}, settings = {} } = {}) {
  if (revisionPreparationPromise) return revisionPreparationPromise;
  revisionPreparationPromise = (async () => {
    const initialPlan = revisionPreparationPlan({ masterySettings });
    const conceptsByPath = new Map();
    initialPlan.conceptsToGenerate.forEach((concept) => {
      const concepts = conceptsByPath.get(concept.documentPath) || [];
      concepts.push(concept);
      conceptsByPath.set(concept.documentPath, concepts);
    });
    for (const [documentPath, concepts] of conceptsByPath) {
      let generatedCards = [];
      let model = "local";
      try {
        const generated = await requestRevisionCards({ concepts, documentPath, settings });
        generatedCards = generated.cards;
        model = generated.model;
      } catch (error) {
        console.warn(
          `Background revision card generation failed for ${documentPath}:`,
          error instanceof Error ? error.message : error,
        );
      }
      const currentPlan = revisionPreparationPlan({ masterySettings });
      const stillNeeded = new Map(
        currentPlan.conceptsToGenerate
          .filter((concept) => concept.documentPath === documentPath)
          .map((concept) => [concept.id, new Set(concept.stages)]),
      );
      generatedCards = generatedCards.filter((card) => {
        const conceptId = card.targets[0]?.conceptId;
        const stages = stillNeeded.get(conceptId);
        return stages && card.targets.every((target) => stages.has(target.stage));
      });
      const generatedConceptIds = new Set(
        generatedCards.flatMap((card) => card.targets.map((target) => target.conceptId)),
      );
      const fallbacks = concepts
        .filter((concept) => stillNeeded.has(concept.id))
        .filter((concept) => !generatedConceptIds.has(concept.id))
        .map((concept) => fallbackRevisionCard({
          concept_id: concept.id,
          concept_name: concept.name,
          explanation_markdown: concept.explanationMarkdown,
          source_excerpt_markdown: concept.sourceExcerptMarkdown,
          stage: concept.stages[0],
        }))
        .map((card, index) => ({
          ...card,
          targets: concepts
            .find((concept) => concept.id === card.targets[0].conceptId)
            .stages.map((stage) => ({
              conceptId: card.targets[0].conceptId,
              conceptName: card.targets[0].conceptName,
              stage,
            })),
          title: concepts.find((concept) => concept.id === card.targets[0].conceptId)?.name || card.title,
          generationOrder: index,
        }));
      const cards = [...generatedCards, ...fallbacks];
      if (cards.length > 0) {
        saveGeneratedCards({
          cards,
          documentPath,
          generationPrompt: "Automatic due revision preparation",
          model,
        });
      }
    }
    return revisionPreparationPlan({ masterySettings });
  })().finally(() => {
    revisionPreparationPromise = null;
  });
  return revisionPreparationPromise;
}

function kickRevisionPreparation(request = {}) {
  void prepareRevisionCards(request).catch((error) => {
    console.warn("Background revision preparation failed:", error instanceof Error ? error.message : error);
  });
}

function createRevisionSession({ masterySettings = {} } = {}) {
  ensurePracticeSchema();
  const normalizedSettings = normalizeMasteryScoringSettings(masterySettings);
  const overview = revisionOverview({ masterySettings: normalizedSettings });
  if (overview.activeSessionId) return practiceSessionResult(overview.activeSessionId);
  const plan = revisionPreparationPlan({ masterySettings: normalizedSettings });
  const dueRows = plan.dueRows.filter((row) => row.is_due);
  if (dueRows.length === 0) throw new Error("No concepts are due for revision.");

  const selected = [...plan.selected];
  const selectedCardIds = new Set();
  const selectedTargets = new Set();
  const statesByPath = new Map();
  selected.forEach((entry) => {
    selectedCardIds.add(entry.card.id);
    entry.card.targets.forEach((target) => selectedTargets.add(dueTargetKey(target)));
    statesByPath.set(entry.documentPath, entry.state);
  });
  for (const row of dueRows) {
    if (selected.length >= normalizedSettings.revisionDailyCardLimit) break;
    const targetKey = `${row.concept_id}:${row.stage}`;
    if (selectedTargets.has(targetKey)) continue;
    let state = statesByPath.get(row.document_path);
    if (!state) {
      state = getDocumentMasteryCards(row.document_path);
      statesByPath.set(row.document_path, state);
    }
    let card = state.cards.find((candidate) =>
      !selectedCardIds.has(candidate.id)
      && candidate.status !== "retired"
      && candidate.targets.some((target) => target.conceptId === row.concept_id && target.stage === row.stage),
    );
    if (!card) {
      saveGeneratedCards({
        cards: [fallbackRevisionCard(row)],
        documentPath: row.document_path,
        generationPrompt: "Automatic revision fallback",
        model: "local",
      });
      state = getDocumentMasteryCards(row.document_path);
      statesByPath.set(row.document_path, state);
      card = state.cards.find((candidate) =>
        !selectedCardIds.has(candidate.id)
        && candidate.targets.some((target) => target.conceptId === row.concept_id && target.stage === row.stage),
      );
    }
    if (!card) continue;
    const dueTargetKeys = new Set(dueRows.map((candidate) => `${candidate.concept_id}:${candidate.stage}`));
    const dueTargets = card.targets.filter((target) => dueTargetKeys.has(`${target.conceptId}:${target.stage}`));
    if (dueTargets.length === 0) continue;
    dueTargets.forEach((target) => selectedTargets.add(`${target.conceptId}:${target.stage}`));
    selectedCardIds.add(card.id);
    selected.push({ card: { ...card, targets: dueTargets }, documentPath: row.document_path, state });
  }
  if (selected.length === 0) throw new Error("No revision cards could be prepared.");

  const db = getMasteryDatabase();
  const now = Date.now();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = db.prepare(
      `INSERT INTO mastery_practice_sessions(
         document_path, session_kind, scope, status, document_markdown,
         mastery_settings_json, created_at, updated_at
       ) VALUES ('__global_revision__', 'revision', 'global', 'active', '', ?, ?, ?)`,
    ).run(JSON.stringify(normalizedSettings), now, now);
    const sessionId = Number(result.lastInsertRowid);
    const insertCard = db.prepare(
      `INSERT INTO mastery_practice_session_cards(
         session_id, source_card_id, source_document_path, source_document_markdown,
         sort_order, card_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    selected.forEach(({ card, documentPath, state }, index) => {
      const mastery = getDocumentMastery(documentPath, "");
      const conceptIds = new Set(card.targets.map((target) => target.conceptId));
      const weaknessIds = new Set(card.weaknessLinks.map((link) => link.weaknessId));
      const concepts = mastery.concepts.filter((concept) => conceptIds.has(concept.id));
      const sourceMarkdown = concepts
        .map((concept) => `## ${concept.name}\n\n${concept.explanationMarkdown}`)
        .join("\n\n");
      insertCard.run(
        sessionId,
        card.id,
        documentPath,
        sourceMarkdown,
        index,
        JSON.stringify({
          card,
          concepts,
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
                cards.id AS session_card_id, cards.source_card_id, cards.card_json, cards.session_id,
                COALESCE(cards.source_document_path, sessions.document_path) AS document_path,
                COALESCE(cards.source_document_markdown, sessions.document_markdown) AS document_markdown,
                sessions.mastery_settings_json
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
  if (!db.prepare("SELECT id FROM mastery_practice_grading_runs WHERE id = ?").get(run.id)) return;
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
      practiceSessionCardId: run.session_card_id,
      practiceSessionId: run.session_id,
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

function setPracticeCardOutcome({ outcome, sessionCardId }) {
  ensurePracticeSchema();
  if (outcome !== "passed" && outcome !== "review") {
    throw new Error("Practice card outcome must be passed or review.");
  }
  const db = getMasteryDatabase();
  const sessionCard = db
    .prepare(
      `SELECT cards.id, cards.session_id, cards.source_card_id, cards.card_json,
              COALESCE(cards.source_document_path, sessions.document_path) AS source_document_path,
              sessions.mastery_settings_json,
              submissions.id AS submission_id,
              runs.score
       FROM mastery_practice_session_cards cards
       JOIN mastery_practice_sessions sessions ON sessions.id = cards.session_id
       LEFT JOIN mastery_practice_submissions submissions ON submissions.session_card_id = cards.id
       LEFT JOIN mastery_practice_grading_runs runs ON runs.id = (
         SELECT MAX(candidate.id) FROM mastery_practice_grading_runs candidate
         WHERE candidate.submission_id = submissions.id AND candidate.status = 'succeeded'
       )
       WHERE cards.id = ?`,
    )
    .get(Number(sessionCardId));
  if (!sessionCard) throw new Error("Practice card was not found.");

  const now = Date.now();
  const masterySettings = normalizeMasteryScoringSettings(parseJson(sessionCard.mastery_settings_json, {}));
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE mastery_practice_session_cards SET manual_outcome = ? WHERE id = ?")
      .run(outcome, sessionCard.id);
    if (sessionCard.source_card_id) {
      db.prepare("UPDATE mastery_cards SET status = ?, retry_at = ?, updated_at = ? WHERE id = ?")
        .run(
          outcome === "passed" ? "done" : "delayed",
          outcome === "passed" ? null : now + masterySettings.reviewCooldownDays * 24 * 60 * 60 * 1000,
          now,
          sessionCard.source_card_id,
        );
    }
    const snapshot = parseJson(sessionCard.card_json, {});
    const card = snapshot.card || snapshot;
    if (card?.targets?.length) {
      rescheduleManualOutcome({
        card,
        db,
        documentPath: sessionCard.source_document_path,
        masterySettings,
        outcome,
        reviewedAt: now,
        score: sessionCard.score ?? (outcome === "passed" ? masterySettings.passingScore : 0),
        sessionCardId: sessionCard.id,
        sessionId: sessionCard.session_id,
        sourceCardId: sessionCard.source_card_id,
      });
    }
    db.prepare("UPDATE mastery_practice_sessions SET updated_at = ? WHERE id = ?")
      .run(now, sessionCard.session_id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return practiceSessionResult(sessionCard.session_id);
}

function getPracticeSession(sessionId, { runGrading = true } = {}) {
  if (runGrading) kickPracticeGrading();
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
         OR EXISTS (
          SELECT 1 FROM mastery_practice_session_cards source_cards
          WHERE source_cards.session_id = sessions.id
            AND source_cards.source_document_path = ?
         )
       ORDER BY sessions.created_at DESC, sessions.id DESC`,
    )
     .all(normalizedPath, normalizedPath)
    .map((row) => ({
      averageScore: row.average_score ?? null,
      cardCount: row.card_count,
      completedAt: row.completed_at ?? null,
      createdAt: row.created_at,
      id: row.id,
      scope: row.scope || "document",
      sessionKind: row.session_kind || "practice",
      status: row.status,
    }));
}

function deletePracticeSession({ documentPath, sessionId }) {
  ensurePracticeSchema();
  const normalizedPath = normalizeDocumentPath(documentPath);
  if (!normalizedPath) throw new Error("Document path is required.");
  const result = getMasteryDatabase()
    .prepare("DELETE FROM mastery_practice_sessions WHERE id = ? AND document_path = ?")
    .run(Number(sessionId), normalizedPath);
  if (result.changes === 0) throw new Error("Practice session was not found.");
  return listPracticeSessions(normalizedPath);
}

function listPracticeEvidence({ cardId, conceptId, documentPath }) {
  ensurePracticeSchema();
  const normalizedPath = normalizeDocumentPath(documentPath);
  if (!normalizedPath) throw new Error("Document path is required.");
  const requestedCardId = Number(cardId) || null;
  const requestedConceptId = Number(conceptId) || null;
  if (!requestedCardId && !requestedConceptId) {
    throw new Error("A concept or flashcard is required.");
  }

  return getMasteryDatabase()
    .prepare(
      `SELECT sessions.id AS session_id, sessions.status AS session_status,
              sessions.mastery_settings_json, sessions.created_at AS session_created_at,
              sessions.completed_at AS session_completed_at,
              cards.*, submissions.answer_markdown, submissions.submitted_at,
              runs.id AS run_id, runs.kind AS run_kind, runs.status AS grading_status,
              runs.score, runs.feedback_markdown, runs.model, runs.error,
              runs.effects_applied, runs.started_at, runs.completed_at AS graded_at
       FROM mastery_practice_session_cards cards
       JOIN mastery_practice_sessions sessions ON sessions.id = cards.session_id
       LEFT JOIN mastery_practice_submissions submissions ON submissions.session_card_id = cards.id
       LEFT JOIN mastery_practice_grading_runs runs ON runs.id = (
         SELECT MAX(candidate.id) FROM mastery_practice_grading_runs candidate
         WHERE candidate.submission_id = submissions.id
       )
      WHERE COALESCE(cards.source_document_path, sessions.document_path) = ?
       ORDER BY sessions.created_at DESC, sessions.id DESC, cards.sort_order, cards.id`,
    )
    .all(normalizedPath)
    .map((row) => {
      const snapshot = parseJson(row.card_json, {});
      const card = snapshot.card || snapshot;
      return {
        answerMarkdown: row.answer_markdown || "",
        card,
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
        manualOutcome: row.manual_outcome || null,
        passingScore: normalizeMasteryScoringSettings(parseJson(row.mastery_settings_json, {})).passingScore,
        sessionCompletedAt: row.session_completed_at ?? null,
        sessionCreatedAt: row.session_created_at,
        sessionId: row.session_id,
        sessionStatus: row.session_status,
        sourceCardId: row.source_card_id ?? null,
        submittedAt: row.submitted_at ?? null,
      };
    })
    .filter((entry) => {
      if (requestedCardId) return entry.sourceCardId === requestedCardId;
      return entry.card.targets?.some((target) => target.conceptId === requestedConceptId)
        || entry.concepts.some((concept) => concept.id === requestedConceptId);
    });
}

module.exports = {
  createPracticeSession,
  createRevisionSession,
  deletePracticeSession,
  ensurePracticeSchema,
  getPracticeSession,
  kickPracticeGrading,
  listPracticeEvidence,
  listPracticeSessions,
  kickRevisionPreparation,
  prepareRevisionCards,
  revisionPreparationPlan,
  revisionOverview,
  retryPracticeGrading,
  setPracticeCardOutcome,
  submitPracticeAnswer,
};