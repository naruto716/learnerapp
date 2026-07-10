const { getMasteryDatabase } = require("./masteryConcepts");
const { cardDifficulties, cardKinds } = require("./masteryScoring");

const answerModes = ["single_turn", "multi_turn"];
const targetProficiencies = ["familiar", "developing", "proficient", "advanced", "mastered"];
const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
const currentCardContractVersion = 3;

let schemaReady = false;

function ensureMasteryCardSchema() {
  if (schemaReady) return;

  const db = getMasteryDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS mastery_cards (
      id INTEGER PRIMARY KEY,
      document_path TEXT NOT NULL,
      kind TEXT NOT NULL,
      answer_mode TEXT NOT NULL,
      title TEXT NOT NULL,
      context_markdown TEXT NOT NULL DEFAULT '',
      prompt_markdown TEXT NOT NULL,
      expected_answer_markdown TEXT NOT NULL DEFAULT '',
      rubric_markdown TEXT NOT NULL DEFAULT '',
      challenge INTEGER NOT NULL DEFAULT 20 CHECK(challenge BETWEEN 0 AND 100),
      difficulty TEXT NOT NULL DEFAULT 'standard' CHECK(difficulty IN ('introductory', 'standard', 'advanced', 'expert')),
      concept_context_visible INTEGER NOT NULL DEFAULT 0,
      metaphor_context_visible INTEGER NOT NULL DEFAULT 0,
      graph_edge_ids_json TEXT NOT NULL DEFAULT '[]',
      contract_version INTEGER NOT NULL DEFAULT 3,
      status TEXT NOT NULL DEFAULT 'active',
      retry_at INTEGER,
      generation_instruction TEXT,
      model TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS mastery_cards_document_index
      ON mastery_cards(document_path, status, retry_at, created_at);

    CREATE TABLE IF NOT EXISTS mastery_card_targets (
      card_id INTEGER NOT NULL,
      concept_id INTEGER NOT NULL,
      stage INTEGER NOT NULL CHECK(stage BETWEEN 2 AND 6),
      sort_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(card_id, concept_id, stage),
      FOREIGN KEY(card_id) REFERENCES mastery_cards(id) ON DELETE CASCADE,
      FOREIGN KEY(concept_id) REFERENCES mastery_concepts(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS mastery_card_targets_concept_index
      ON mastery_card_targets(concept_id, stage, card_id);

    CREATE TABLE IF NOT EXISTS mastery_weaknesses (
      id INTEGER PRIMARY KEY,
      document_path TEXT NOT NULL,
      stable_key TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      exposed_at INTEGER NOT NULL,
      resolved_at INTEGER,
      resolving_card_id INTEGER,
      resolving_attempt_id INTEGER,
      reopened_count INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      UNIQUE(document_path, stable_key)
    );

    CREATE INDEX IF NOT EXISTS mastery_weaknesses_document_index
      ON mastery_weaknesses(document_path, status, updated_at);

    CREATE TABLE IF NOT EXISTS mastery_weakness_targets (
      weakness_id INTEGER NOT NULL,
      concept_id INTEGER NOT NULL,
      stage INTEGER NOT NULL CHECK(stage BETWEEN 2 AND 6),
      PRIMARY KEY(weakness_id, concept_id, stage),
      FOREIGN KEY(weakness_id) REFERENCES mastery_weaknesses(id) ON DELETE CASCADE,
      FOREIGN KEY(concept_id) REFERENCES mastery_concepts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS mastery_card_weaknesses (
      card_id INTEGER NOT NULL,
      weakness_id INTEGER NOT NULL,
      relationship TEXT NOT NULL,
      PRIMARY KEY(card_id, weakness_id, relationship),
      FOREIGN KEY(card_id) REFERENCES mastery_cards(id) ON DELETE CASCADE,
      FOREIGN KEY(weakness_id) REFERENCES mastery_weaknesses(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS mastery_card_attempts (
      id INTEGER PRIMARY KEY,
      card_id INTEGER NOT NULL,
      answer_markdown TEXT NOT NULL,
      score INTEGER NOT NULL CHECK(score BETWEEN 0 AND 100),
      feedback_markdown TEXT NOT NULL,
      model TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(card_id) REFERENCES mastery_cards(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS mastery_card_attempts_card_index
      ON mastery_card_attempts(card_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS mastery_attempt_weaknesses (
      attempt_id INTEGER NOT NULL,
      weakness_id INTEGER NOT NULL,
      outcome TEXT NOT NULL,
      PRIMARY KEY(attempt_id, weakness_id),
      FOREIGN KEY(attempt_id) REFERENCES mastery_card_attempts(id) ON DELETE CASCADE,
      FOREIGN KEY(weakness_id) REFERENCES mastery_weaknesses(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS mastery_card_messages (
      id INTEGER PRIMARY KEY,
      card_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content_markdown TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(card_id) REFERENCES mastery_cards(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS mastery_card_messages_card_index
      ON mastery_card_messages(card_id, created_at, id);

    CREATE TABLE IF NOT EXISTS mastery_card_preferences (
      document_path TEXT PRIMARY KEY,
      generation_prompt TEXT NOT NULL DEFAULT '',
      target_proficiency TEXT NOT NULL DEFAULT 'proficient'
        CHECK(target_proficiency IN ('familiar', 'developing', 'proficient', 'advanced', 'mastered')),
      updated_at INTEGER NOT NULL
    );
  `);

  const columns = new Set(db.prepare("PRAGMA table_info(mastery_cards)").all().map((column) => column.name));
  const ensureColumn = (name, definition) => {
    if (!columns.has(name)) db.exec(`ALTER TABLE mastery_cards ADD COLUMN ${name} ${definition}`);
  };
  ensureColumn("title", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("context_markdown", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("graph_edge_ids_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn("contract_version", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn("difficulty", "TEXT NOT NULL DEFAULT 'standard'");

  // Old cards were generated without an explicit interaction contract or visible context.
  db
    .prepare(
      `UPDATE mastery_cards
       SET status = 'retired', retry_at = NULL, updated_at = ?
       WHERE contract_version < ? OR kind = 'concept_review' OR answer_mode = 'review'`,
    )
    .run(Date.now(), currentCardContractVersion);

  schemaReady = true;
}

module.exports = {
  answerModes,
  cardDifficulties,
  cardKinds,
  currentCardContractVersion,
  ensureMasteryCardSchema,
  targetProficiencies,
  threeDaysMs,
};
