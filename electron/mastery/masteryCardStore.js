const {
  ensureMasteryStageStates,
  getMasteryDatabase,
  normalizeDocumentPath,
} = require("./masteryConcepts");
const {
  currentCardContractVersion,
  ensureMasteryCardSchema,
  targetProficiencies,
} = require("./masteryCardSchema");

const defaultCardPreferences = {
  generationPrompt: "",
  targetProficiency: "proficient",
};

function normalizeCardPreferences(preferences = {}) {
  const targetProficiency = String(preferences.targetProficiency || "").trim().toLowerCase();
  return {
    generationPrompt: String(preferences.generationPrompt || "").trim(),
    targetProficiency: targetProficiencies.includes(targetProficiency)
      ? targetProficiency
      : defaultCardPreferences.targetProficiency,
  };
}

function getDocumentCardPreferences(documentPath) {
  ensureMasteryCardSchema();
  const row = getMasteryDatabase()
    .prepare("SELECT * FROM mastery_card_preferences WHERE document_path = ?")
    .get(documentPath);
  return row
    ? {
        generationPrompt: row.generation_prompt || "",
        targetProficiency: row.target_proficiency,
      }
    : { ...defaultCardPreferences };
}

function saveDocumentCardPreferences(documentPath, preferences) {
  ensureMasteryCardSchema();
  const normalized = normalizeCardPreferences(preferences);
  getMasteryDatabase()
    .prepare(
      `INSERT INTO mastery_card_preferences(document_path, generation_prompt, target_proficiency, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(document_path) DO UPDATE SET
         generation_prompt = excluded.generation_prompt,
         target_proficiency = excluded.target_proficiency,
         updated_at = excluded.updated_at`,
    )
    .run(documentPath, normalized.generationPrompt, normalized.targetProficiency, Date.now());
  return normalized;
}

function activeConceptRows(documentPath) {
  const rows = getMasteryDatabase()
    .prepare(
      `SELECT * FROM mastery_concepts
       WHERE document_path = ? AND status = 'active'
       ORDER BY sort_order, id`,
    )
    .all(documentPath);
  ensureMasteryStageStates(rows.map((row) => row.id));
  return rows;
}

function rowsForIds(sql, ids) {
  if (ids.length === 0) return [];
  return getMasteryDatabase()
    .prepare(sql.replace("__IDS__", ids.map(() => "?").join(",")))
    .all(...ids);
}

function parseGraphEdgeIds(value) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.filter((id) => Number.isInteger(id) && id > 0) : [];
  } catch {
    return [];
  }
}

function cleanupInactiveTargets(db, documentPath) {
  db
    .prepare(
      `DELETE FROM mastery_card_targets
       WHERE card_id IN (SELECT id FROM mastery_cards WHERE document_path = ?)
         AND concept_id IN (SELECT id FROM mastery_concepts WHERE status != 'active')`,
    )
    .run(documentPath);
  db
    .prepare(
      `DELETE FROM mastery_cards
       WHERE document_path = ?
         AND NOT EXISTS (SELECT 1 FROM mastery_card_targets WHERE card_id = mastery_cards.id)`,
    )
    .run(documentPath);
  db
    .prepare(
      `DELETE FROM mastery_weakness_targets
       WHERE weakness_id IN (SELECT id FROM mastery_weaknesses WHERE document_path = ?)
         AND concept_id IN (SELECT id FROM mastery_concepts WHERE status != 'active')`,
    )
    .run(documentPath);
  db
    .prepare(
      `DELETE FROM mastery_weaknesses
       WHERE document_path = ?
         AND NOT EXISTS (SELECT 1 FROM mastery_weakness_targets WHERE weakness_id = mastery_weaknesses.id)`,
    )
    .run(documentPath);
}

function getDocumentMasteryCards(documentPath) {
  ensureMasteryCardSchema();
  const normalizedPath = normalizeDocumentPath(documentPath);
  if (!normalizedPath) throw new Error("Document path is required.");

  const db = getMasteryDatabase();
  cleanupInactiveTargets(db, normalizedPath);
  const now = Date.now();
  db
    .prepare(
      `UPDATE mastery_cards
       SET status = 'active', retry_at = NULL, updated_at = ?
       WHERE document_path = ? AND status = 'delayed' AND retry_at IS NOT NULL AND retry_at <= ?`,
    )
    .run(now, normalizedPath, now);

  const concepts = activeConceptRows(normalizedPath);
  const conceptIds = concepts.map((concept) => concept.id);
  const cards = db
    .prepare(
      `SELECT * FROM mastery_cards
       WHERE document_path = ? AND status != 'retired'
       ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'delayed' THEN 1 ELSE 2 END,
                COALESCE(retry_at, created_at), id`,
    )
    .all(normalizedPath);
  const cardIds = cards.map((card) => card.id);
  const targetRows = rowsForIds(
    `SELECT targets.card_id, targets.concept_id, targets.stage, targets.sort_order,
            concepts.name AS concept_name
     FROM mastery_card_targets targets
     JOIN mastery_concepts concepts ON concepts.id = targets.concept_id
     WHERE targets.card_id IN (__IDS__)
     ORDER BY targets.card_id, targets.sort_order, targets.concept_id, targets.stage`,
    cardIds,
  );
  const weaknessLinks = rowsForIds(
    `SELECT card_id, weakness_id, relationship FROM mastery_card_weaknesses
     WHERE card_id IN (__IDS__) ORDER BY card_id, weakness_id`,
    cardIds,
  );
  const latestAttempts = rowsForIds(
    `SELECT attempts.* FROM mastery_card_attempts attempts
     JOIN (
       SELECT card_id, MAX(id) AS latest_id FROM mastery_card_attempts
       WHERE card_id IN (__IDS__) GROUP BY card_id
     ) latest ON latest.latest_id = attempts.id`,
    cardIds,
  );
  const messages = rowsForIds(
    `SELECT * FROM mastery_card_messages WHERE card_id IN (__IDS__)
     ORDER BY created_at, id`,
    cardIds,
  );
  const targetsByCard = new Map();
  const weaknessesByCard = new Map();
  const attemptsByCard = new Map(latestAttempts.map((attempt) => [attempt.card_id, attempt]));
  const messagesByCard = new Map();

  targetRows.forEach((row) => {
    const values = targetsByCard.get(row.card_id) || [];
    values.push({ conceptId: row.concept_id, conceptName: row.concept_name, stage: row.stage });
    targetsByCard.set(row.card_id, values);
  });
  weaknessLinks.forEach((row) => {
    const values = weaknessesByCard.get(row.card_id) || [];
    values.push({ relationship: row.relationship, weaknessId: row.weakness_id });
    weaknessesByCard.set(row.card_id, values);
  });
  messages.forEach((row) => {
    const values = messagesByCard.get(row.card_id) || [];
    values.push({ contentMarkdown: row.content_markdown, id: row.id, role: row.role });
    messagesByCard.set(row.card_id, values);
  });

  const weaknessRows = db
    .prepare(
      `SELECT * FROM mastery_weaknesses WHERE document_path = ?
       ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, updated_at DESC`,
    )
    .all(normalizedPath);
  const weaknessIds = weaknessRows.map((weakness) => weakness.id);
  const weaknessTargets = rowsForIds(
    `SELECT targets.*, concepts.name AS concept_name
     FROM mastery_weakness_targets targets
     JOIN mastery_concepts concepts ON concepts.id = targets.concept_id
     WHERE targets.weakness_id IN (__IDS__)
     ORDER BY targets.weakness_id, targets.concept_id, targets.stage`,
    weaknessIds,
  );
  const weaknessTargetsById = new Map();
  weaknessTargets.forEach((row) => {
    const values = weaknessTargetsById.get(row.weakness_id) || [];
    values.push({ conceptId: row.concept_id, conceptName: row.concept_name, stage: row.stage });
    weaknessTargetsById.set(row.weakness_id, values);
  });

  return {
    cards: cards.map((row) => {
      const latestAttempt = attemptsByCard.get(row.id);
      return {
        answerMode: row.answer_mode,
        conceptContextVisible: Boolean(row.concept_context_visible),
        contextMarkdown: row.context_markdown || "",
        createdAt: row.created_at,
        difficulty: row.difficulty || "standard",
        expectedAnswerMarkdown: row.expected_answer_markdown,
        id: row.id,
        graphEdgeIds: parseGraphEdgeIds(row.graph_edge_ids_json),
        kind: row.kind,
        latestAttempt: latestAttempt
          ? {
              answerMarkdown: latestAttempt.answer_markdown,
              createdAt: latestAttempt.created_at,
              feedbackMarkdown: latestAttempt.feedback_markdown,
              id: latestAttempt.id,
              score: latestAttempt.score,
            }
          : null,
        messages: messagesByCard.get(row.id) || [],
        metaphorContextVisible: Boolean(row.metaphor_context_visible),
        promptMarkdown: row.prompt_markdown,
        retryAt: row.retry_at ?? null,
        rubricMarkdown: row.rubric_markdown,
        status: row.status,
        targets: targetsByCard.get(row.id) || [],
        title: row.title || row.prompt_markdown,
        updatedAt: row.updated_at,
        weaknessLinks: weaknessesByCard.get(row.id) || [],
      };
    }),
    documentPath: normalizedPath,
    preferences: getDocumentCardPreferences(normalizedPath),
    stageStates: rowsForIds(
      `SELECT * FROM mastery_stage_states WHERE concept_id IN (__IDS__)
       ORDER BY concept_id, stage`,
      conceptIds,
    ).map((row) => ({
      attemptCount: row.attempt_count,
      conceptId: row.concept_id,
      fsrsDifficulty: row.fsrs_difficulty ?? null,
      fsrsRetrievability: row.fsrs_retrievability ?? null,
      fsrsStability: row.fsrs_stability ?? null,
      lastReviewedAt: row.last_reviewed_at ?? null,
      lapseCount: row.lapse_count,
      nextDueAt: row.next_due_at ?? null,
      score: Number(row.score),
      stage: row.stage,
      status: row.status,
    })),
    weaknesses: weaknessRows.map((row) => ({
      description: row.description,
      exposedAt: row.exposed_at,
      id: row.id,
      reopenedCount: row.reopened_count,
      resolvedAt: row.resolved_at ?? null,
      status: row.status,
      targets: weaknessTargetsById.get(row.id) || [],
      title: row.title,
      updatedAt: row.updated_at,
    })),
  };
}

function insertCard(db, card, { documentPath, generationPrompt, model, now }) {
  const result = db
    .prepare(
      `INSERT INTO mastery_cards(
         document_path, kind, answer_mode, title, context_markdown, prompt_markdown, expected_answer_markdown,
         rubric_markdown, difficulty, concept_context_visible, metaphor_context_visible,
         graph_edge_ids_json, contract_version, status, generation_instruction, model, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
    )
    .run(
      documentPath,
      card.kind,
      card.answerMode,
      card.title,
      card.contextMarkdown || "",
      card.promptMarkdown,
      card.expectedAnswerMarkdown || "",
      card.rubricMarkdown || "",
      card.difficulty,
      card.conceptContextVisible ? 1 : 0,
      card.metaphorContextVisible ? 1 : 0,
      JSON.stringify(card.graphEdgeIds || []),
      currentCardContractVersion,
      generationPrompt || null,
      model || null,
      now,
      now,
    );
  const cardId = Number(result.lastInsertRowid);
  const insertTarget = db.prepare(
    "INSERT INTO mastery_card_targets(card_id, concept_id, stage, sort_order) VALUES (?, ?, ?, ?)",
  );
  card.targets.forEach((target, index) => insertTarget.run(cardId, target.conceptId, target.stage, index));
  const insertWeakness = db.prepare(
    "INSERT OR IGNORE INTO mastery_card_weaknesses(card_id, weakness_id, relationship) VALUES (?, ?, 'target')",
  );
  card.targetedWeaknessIds.forEach((weaknessId) => insertWeakness.run(cardId, weaknessId));
}

function saveGeneratedCards({ cards, documentPath, generationPrompt, model }) {
  ensureMasteryCardSchema();
  const db = getMasteryDatabase();
  const now = Date.now();
  db.exec("BEGIN IMMEDIATE");
  try {
    cards.forEach((card) => insertCard(db, card, { documentPath, generationPrompt, model, now }));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function getCardContext(cardId, documentPath) {
  const state = getDocumentMasteryCards(documentPath);
  const card = state.cards.find((candidate) => candidate.id === Number(cardId));
  if (!card) throw new Error("Flashcard was not found.");
  return { card, state };
}

function appendDiscussionTurn(cardId, userMessage, assistantMessage) {
  const db = getMasteryDatabase();
  const insert = db.prepare(
    "INSERT INTO mastery_card_messages(card_id, role, content_markdown, created_at) VALUES (?, ?, ?, ?)",
  );
  const now = Date.now();
  db.exec("BEGIN IMMEDIATE");
  try {
    insert.run(cardId, "user", userMessage, now);
    insert.run(cardId, "assistant", assistantMessage, now + 1);
    db.prepare("UPDATE mastery_cards SET updated_at = ? WHERE id = ?").run(now + 1, cardId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function clearDocumentMasteryCards({ documentPath, resetProgress = true }) {
  ensureMasteryCardSchema();
  const normalizedPath = normalizeDocumentPath(documentPath);
  if (!normalizedPath) throw new Error("Document path is required.");
  const db = getMasteryDatabase();
  const conceptIds = activeConceptRows(normalizedPath).map((concept) => concept.id);

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM mastery_cards WHERE document_path = ?").run(normalizedPath);
    db.prepare("DELETE FROM mastery_weaknesses WHERE document_path = ?").run(normalizedPath);
    if (resetProgress && conceptIds.length > 0) {
      const placeholders = conceptIds.map(() => "?").join(",");
      db
        .prepare(
          `UPDATE mastery_stage_states
           SET score = 0, attempt_count = 0, last_reviewed_at = NULL, next_due_at = NULL,
               lapse_count = 0, status = 'active', updated_at = ?
           WHERE concept_id IN (${placeholders})`,
        )
        .run(Date.now(), ...conceptIds);
      db
        .prepare(
          `UPDATE mastery_concepts
           SET mastery_level = 'new', mastery_rationale = 'No practice evidence yet.', updated_at = ?
           WHERE id IN (${placeholders})`,
        )
        .run(Date.now(), ...conceptIds);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getDocumentMasteryCards(normalizedPath);
}

module.exports = {
  appendDiscussionTurn,
  clearDocumentMasteryCards,
  defaultCardPreferences,
  getCardContext,
  getDocumentCardPreferences,
  getDocumentMasteryCards,
  normalizeCardPreferences,
  saveDocumentCardPreferences,
  saveGeneratedCards,
};
