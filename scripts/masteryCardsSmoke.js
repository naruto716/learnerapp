const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const { DatabaseSync } = require("node:sqlite");

const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "learner-mastery-"));
const databasePath = path.join(userDataPath, "learner.sqlite");
const documentPath = "smoke/topic.json";
const now = Date.now();

function seedLegacyDatabase() {
  const db = new DatabaseSync(databasePath);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE mastery_generation_runs (
      id INTEGER PRIMARY KEY,
      document_path TEXT NOT NULL,
      document_hash TEXT NOT NULL,
      model TEXT,
      generated_at INTEGER NOT NULL
    );
    CREATE TABLE mastery_concepts (
      id INTEGER PRIMARY KEY,
      document_path TEXT NOT NULL,
      run_id INTEGER,
      stable_key TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT,
      summary_markdown TEXT,
      explanation_markdown TEXT,
      source_excerpt_markdown TEXT,
      mastery_level TEXT NOT NULL DEFAULT 'new',
      mastery_rationale TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(document_path, stable_key),
      FOREIGN KEY(run_id) REFERENCES mastery_generation_runs(id) ON DELETE SET NULL
    );
    CREATE TABLE mastery_cards (
      id INTEGER PRIMARY KEY,
      document_path TEXT NOT NULL,
      kind TEXT NOT NULL,
      answer_mode TEXT NOT NULL,
      prompt_markdown TEXT NOT NULL,
      expected_answer_markdown TEXT NOT NULL DEFAULT '',
      rubric_markdown TEXT NOT NULL DEFAULT '',
      challenge INTEGER NOT NULL DEFAULT 20,
      concept_context_visible INTEGER NOT NULL DEFAULT 0,
      metaphor_context_visible INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      retry_at INTEGER,
      generation_instruction TEXT,
      model TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  db.prepare(
    "INSERT INTO mastery_generation_runs(id, document_path, document_hash, model, generated_at) VALUES (1, ?, 'hash', 'test', ?)",
  ).run(documentPath, now);
  db.prepare(
    `INSERT INTO mastery_concepts(
       id, document_path, run_id, stable_key, name, type, summary_markdown,
       explanation_markdown, source_excerpt_markdown, mastery_level,
       mastery_rationale, status, sort_order, created_at, updated_at
     ) VALUES (1, ?, 1, 'alpha', 'Alpha', 'concept', 'legacy summary',
               'Alpha explanation', 'Alpha source', 'new', 'No evidence', 'active', 0, ?, ?)`,
  ).run(documentPath, now, now);
  db.prepare(
    `INSERT INTO mastery_cards(
       id, document_path, kind, answer_mode, prompt_markdown, status, created_at, updated_at
     ) VALUES (99, ?, 'concept_review', 'review', 'Legacy passive card', 'active', ?, ?)`,
  ).run(documentPath, now, now);
  db.close();
}

seedLegacyDatabase();

const originalLoad = Module._load;
Module._load = function loadWithElectronStub(request, parent, isMain) {
  if (request === "electron") return { app: { getPath: () => userDataPath } };
  return originalLoad.call(this, request, parent, isMain);
};

const conceptsApi = require("../electron/mastery/masteryConcepts");
const {
  clearDocumentMasteryCards,
  getDocumentMasteryCards,
  saveDocumentCardPreferences,
  saveGeneratedCards,
} = require("../electron/mastery/masteryCardStore");
const { saveCardEvaluation } = require("../electron/mastery/masteryCardProgress");
const { currentCardContractVersion, ensureMasteryCardSchema } = require("../electron/mastery/masteryCardSchema");
const { prepareGeneratedCards } = require("../electron/mastery/masteryCardAi");
const { defaultMasteryScoringSettings } = require("../electron/mastery/masteryScoring");
Module._load = originalLoad;

function baseCard(overrides = {}) {
  return {
    answerMode: "single_turn",
    conceptContextVisible: false,
    contextMarkdown: "",
    difficulty: "standard",
    expectedAnswerMarkdown: "A complete sample answer.",
    graphEdgeIds: [],
    kind: "diagnostic",
    metaphorContextVisible: false,
    promptMarkdown: "Explain Alpha in your own words.",
    rubricMarkdown: "Explains Alpha accurately in plain language.",
    targetedWeaknessIds: [],
    targets: [{ conceptId: 1, stage: 2 }],
    title: "Explain Alpha",
    ...overrides,
  };
}

function feynmanCard(overrides = {}) {
  return baseCard({
    conceptContextVisible: true,
    kind: "feynman",
    metaphorContextVisible: true,
    promptMarkdown: "This is deliberately replaced by the contract.",
    targets: [
      { conceptId: 1, stage: 2 },
      { conceptId: 1, stage: 3 },
    ],
    title: "Alpha",
    ...overrides,
  });
}

function relationshipCard(overrides = {}) {
  return baseCard({
    difficulty: "advanced",
    graphEdgeIds: [10],
    kind: "relationship",
    promptMarkdown: "Explain why this dependency matters.",
    rubricMarkdown: "Explains the dependency and its consequence.",
    targets: [
      { conceptId: 1, stage: 3 },
      { conceptId: 2, stage: 6 },
    ],
    title: "Why Alpha depends on Beta",
    ...overrides,
  });
}

try {
  const db = conceptsApi.getMasteryDatabase();
  ensureMasteryCardSchema();
  const conceptColumns = db.prepare("PRAGMA table_info(mastery_concepts)").all().map((column) => column.name);
  const cardColumns = db.prepare("PRAGMA table_info(mastery_cards)").all().map((column) => column.name);
  assert.equal(conceptColumns.includes("summary_markdown"), false, "legacy concept schema should migrate");
  assert.ok(cardColumns.includes("difficulty"), "card difficulty should be persisted");
  assert.equal(db.prepare("SELECT name FROM mastery_concepts WHERE id = 1").get().name, "Alpha");
  assert.equal(db.prepare("SELECT status FROM mastery_cards WHERE id = 99").get().status, "retired");
  assert.equal(currentCardContractVersion, 3);

  db.prepare(
    `INSERT INTO mastery_concepts(
       id, document_path, run_id, stable_key, name, type, explanation_markdown,
       source_excerpt_markdown, mastery_level, mastery_rationale, status,
       sort_order, created_at, updated_at
     ) VALUES (2, ?, 1, 'beta', 'Beta', 'concept', 'Beta explanation',
               'Beta source', 'new', 'No evidence', 'active', 1, ?, ?)`,
  ).run(documentPath, now, now);
  conceptsApi.ensureMasteryStageStates([1, 2]);

  const mastery = conceptsApi.getDocumentMastery(documentPath, "note");
  const masteryWithMetaphor = { ...mastery, metaphor: { title: "Shared scene" } };
  const graph = {
    edges: [{ explanation: "Alpha requires Beta.", id: 10, relation: "depends_on", source: 100, target: 200 }],
    nodes: [{ id: 100, name: "Alpha" }, { id: 200, name: "Beta" }],
  };

  const preparedFeynman = prepareGeneratedCards([feynmanCard()], masteryWithMetaphor, graph, [])[0];
  assert.equal(
    preparedFeynman.promptMarkdown,
    "Teach this concept in your own words. Do not copy the concept card's wording.",
  );
  assert.equal(preparedFeynman.conceptContextVisible, true);
  assert.equal(preparedFeynman.metaphorContextVisible, true);
  assert.equal(preparedFeynman.targets.length, 2, "one concept may record several covered stages");

  const preparedRelationship = prepareGeneratedCards([relationshipCard()], masteryWithMetaphor, graph, [])[0];
  assert.match(preparedRelationship.contextMarkdown, /Alpha.*depends on.*Beta/);
  assert.deepEqual(
    preparedRelationship.targets.map((target) => target.stage),
    [3, 6],
    "relationship cards must not be bound to one stage",
  );
  assert.doesNotThrow(() =>
    prepareGeneratedCards(
      [baseCard({ contextMarkdown: "Solve one focused exercise.", kind: "drill", targets: [{ conceptId: 1, stage: 2 }] })],
      masteryWithMetaphor,
      graph,
      [],
    ),
  );
  assert.throws(
    () =>
      prepareGeneratedCards(
        [feynmanCard({ targets: [{ conceptId: 1, stage: 2 }, { conceptId: 2, stage: 3 }] })],
        masteryWithMetaphor,
        graph,
        [],
      ),
    /must cover 1 concept/,
  );
  assert.throws(
    () => prepareGeneratedCards([relationshipCard({ graphEdgeIds: [999] })], masteryWithMetaphor, graph, []),
    /unknown graph edge/,
  );

  const preferences = saveDocumentCardPreferences(documentPath, {
    generationPrompt: "More procedural practice, fewer generic questions.",
    targetProficiency: "advanced",
  });
  assert.equal(preferences.targetProficiency, "advanced");

  saveGeneratedCards({
    cards: [preparedFeynman, preparedRelationship],
    documentPath,
    generationPrompt: preferences.generationPrompt,
    model: "test",
  });
  let state = getDocumentMasteryCards(documentPath);
  assert.equal(state.cards.length, 2);
  assert.deepEqual(state.preferences, preferences);
  assert.equal(state.cards.find((card) => card.kind === "feynman").difficulty, "standard");

  const customScoring = structuredClone(defaultMasteryScoringSettings);
  customScoring.passingScore = 85;
  customScoring.points.feynman.standard = 17;
  const firstCard = state.cards.find((card) => card.kind === "feynman");
  assert.ok(firstCard);

  saveCardEvaluation({
    answerMarkdown: "Incomplete answer",
    card: firstCard,
    documentPath,
    evaluation: {
      feedbackMarkdown: "The mechanism is missing.",
      model: "test",
      score: 80,
      weaknessOutcomes: [
        {
          conceptIds: [1],
          description: "Does not explain Alpha's mechanism.",
          stages: [2],
          state: "active",
          title: "Missing mechanism",
          weaknessId: null,
        },
      ],
    },
    mastery,
    masterySettings: customScoring,
    state,
  });
  state = getDocumentMasteryCards(documentPath);
  const delayedCard = state.cards.find((card) => card.id === firstCard.id);
  assert.equal(delayedCard.status, "delayed", "the configured pass threshold must be used");
  assert.ok(delayedCard.retryAt >= now + 3 * 24 * 60 * 60 * 1000);
  assert.equal(state.stageStates.find((entry) => entry.conceptId === 1 && entry.stage === 2).score, 0);
  assert.equal(state.stageStates.find((entry) => entry.conceptId === 1 && entry.stage === 3).score, 0);
  assert.equal(state.weaknesses[0].status, "active");

  db.prepare("UPDATE mastery_cards SET retry_at = ? WHERE id = ?").run(Date.now() - 1, firstCard.id);
  state = getDocumentMasteryCards(documentPath);
  const retryCard = state.cards.find((card) => card.id === firstCard.id);
  assert.equal(retryCard.status, "active");
  assert.equal(retryCard.retryAt, null);

  const weaknessId = state.weaknesses[0].id;
  const targetedFeynman = prepareGeneratedCards(
    [feynmanCard({ targetedWeaknessIds: [weaknessId], title: "Resolve Alpha weakness" })],
    masteryWithMetaphor,
    graph,
    state.weaknesses,
  )[0];
  saveGeneratedCards({
    cards: [targetedFeynman],
    documentPath,
    generationPrompt: preferences.generationPrompt,
    model: "test",
  });
  state = getDocumentMasteryCards(documentPath);
  const targetedCard = state.cards.find((card) => card.id !== firstCard.id && card.kind === "feynman");
  assert.ok(targetedCard.weaknessLinks.some((link) => link.weaknessId === weaknessId && link.relationship === "target"));

  saveCardEvaluation({
    answerMarkdown: "Complete answer",
    card: targetedCard,
    documentPath,
    evaluation: {
      feedbackMarkdown: "The mechanism is now explicit.",
      model: "test",
      score: 90,
      weaknessOutcomes: [
        {
          conceptIds: [1],
          description: "Alpha's mechanism is now understood.",
          stages: [2],
          state: "resolved",
          title: "Missing mechanism",
          weaknessId,
        },
      ],
    },
    mastery: conceptsApi.getDocumentMastery(documentPath, "note"),
    masterySettings: customScoring,
    state,
  });
  state = getDocumentMasteryCards(documentPath);
  assert.equal(state.cards.find((card) => card.id === targetedCard.id).status, "done");
  assert.equal(state.weaknesses.find((weakness) => weakness.id === weaknessId).status, "resolved");
  assert.equal(state.stageStates.find((entry) => entry.conceptId === 1 && entry.stage === 2).score, 17);
  assert.equal(state.stageStates.find((entry) => entry.conceptId === 1 && entry.stage === 3).score, 17);

  const relationship = state.cards.find((card) => card.kind === "relationship");
  saveCardEvaluation({
    answerMarkdown: "Complete relationship answer",
    card: relationship,
    documentPath,
    evaluation: { feedbackMarkdown: "Correct.", model: "test", score: 95, weaknessOutcomes: [] },
    mastery: conceptsApi.getDocumentMastery(documentPath, "note"),
    masterySettings: defaultMasteryScoringSettings,
    state,
  });
  state = getDocumentMasteryCards(documentPath);
  assert.equal(state.stageStates.find((entry) => entry.conceptId === 1 && entry.stage === 3).score, 33);
  assert.equal(state.stageStates.find((entry) => entry.conceptId === 2 && entry.stage === 6).score, 16);

  saveGeneratedCards({
    cards: [baseCard({ title: "Additional card" })],
    documentPath,
    generationPrompt: preferences.generationPrompt,
    model: "test",
  });
  state = getDocumentMasteryCards(documentPath);
  assert.equal(state.cards.length, 4, "later generations must append cards");

  db.prepare("DELETE FROM mastery_concepts WHERE id = 1").run();
  state = getDocumentMasteryCards(documentPath);
  const sharedCard = state.cards.find((card) => card.kind === "relationship");
  assert.ok(sharedCard, "a shared card should survive deletion of one target concept");
  assert.deepEqual(sharedCard.targets.map((target) => target.conceptId), [2]);

  state = clearDocumentMasteryCards({ documentPath, resetProgress: true });
  assert.equal(state.cards.length, 0);
  assert.equal(state.weaknesses.length, 0);
  assert.ok(state.stageStates.every((stage) => stage.score === 0 && stage.attemptCount === 0));
  assert.deepEqual(state.preferences, preferences, "note generation preferences should survive deck clearing");

  console.log("Mastery card smoke test passed.");
} finally {
  conceptsApi.closeMasteryDatabase();
  fs.rmSync(userDataPath, { force: true, recursive: true });
}
