const { app } = require("electron");
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { ensureMasteryCardSchema } = require("./masteryCardSchema");
const { getMasteryDatabase, getMasteryDatabasePath } = require("./masteryConcepts");
const { backfillLegacyRevisionSchedules } = require("./masteryRevision");

const component = "mastery";
const latestVersion = 5;
let migrationsReady = false;

function tableHasColumn(db, tableName, columnName) {
  return db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all()
    .some((column) => column.name === columnName);
}

function ensureMigrationLedger(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS learner_schema_migrations (
      component TEXT NOT NULL,
      version INTEGER NOT NULL,
      applied_at INTEGER NOT NULL,
      app_version TEXT,
      PRIMARY KEY(component, version)
    )
  `);
}

function migrationVersion(db) {
  const ledgerExists = db
    .prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'learner_schema_migrations'")
    .get();
  if (!ledgerExists) return 0;
  return Number(
    db.prepare("SELECT MAX(version) AS version FROM learner_schema_migrations WHERE component = ?")
      .get(component)?.version || 0,
  );
}

function verifyBackup(backupPath) {
  const backup = new DatabaseSync(backupPath, { readOnly: true });
  const check = backup.prepare("PRAGMA quick_check").all();
  backup.close();
  if (check.length !== 1 || check[0].quick_check !== "ok") {
    fs.rmSync(backupPath, { force: true });
    throw new Error(`Mastery migration backup failed integrity check: ${JSON.stringify(check)}`);
  }
}

function backupDatabase(databasePath, version) {
  if (!fs.existsSync(databasePath) || fs.statSync(databasePath).size === 0) return null;
  const backupDirectory = path.join(path.dirname(databasePath), "backups");
  fs.mkdirSync(backupDirectory, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDirectory, `learner-before-mastery-v${version}-${timestamp}.sqlite`);
  const quotedBackupPath = `'${backupPath.replaceAll("'", "''")}'`;
  const source = new DatabaseSync(databasePath);
  source.exec("PRAGMA busy_timeout = 10000");
  source.exec("PRAGMA wal_checkpoint(PASSIVE)");
  source.exec(`VACUUM INTO ${quotedBackupPath}`);
  source.close();
  verifyBackup(backupPath);
  return backupPath;
}

function applyMigration(db, version, migrate) {
  db.exec("BEGIN IMMEDIATE");
  try {
    ensureMigrationLedger(db);
    migrate(db);
    db.prepare(
      "INSERT INTO learner_schema_migrations(component, version, applied_at, app_version) VALUES (?, ?, ?, ?)",
    ).run(component, version, Date.now(), app.getVersion?.() || null);
    const foreignKeyViolations = db.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeyViolations.length > 0) {
      throw new Error(`Foreign-key validation failed: ${JSON.stringify(foreignKeyViolations.slice(0, 10))}`);
    }
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Preserve the migration error.
    }
    throw error;
  }
}

function migrateCrossNoteSessions(db) {
  if (!tableHasColumn(db, "mastery_practice_sessions", "session_kind")) {
    db.exec("ALTER TABLE mastery_practice_sessions ADD COLUMN session_kind TEXT NOT NULL DEFAULT 'practice'");
  }
  if (!tableHasColumn(db, "mastery_practice_sessions", "scope")) {
    db.exec("ALTER TABLE mastery_practice_sessions ADD COLUMN scope TEXT NOT NULL DEFAULT 'document'");
  }
  if (!tableHasColumn(db, "mastery_practice_session_cards", "source_document_path")) {
    db.exec("ALTER TABLE mastery_practice_session_cards ADD COLUMN source_document_path TEXT");
  }
  db.exec(`
    UPDATE mastery_practice_session_cards
    SET source_document_path = (
      SELECT sessions.document_path
      FROM mastery_practice_sessions sessions
      WHERE sessions.id = mastery_practice_session_cards.session_id
    )
    WHERE source_document_path IS NULL OR source_document_path = '';

    CREATE INDEX IF NOT EXISTS mastery_practice_session_cards_document_index
      ON mastery_practice_session_cards(source_document_path, session_id, sort_order);
  `);
}

function migrateRevisionScheduling(db) {
  const stageColumns = [
    ["fsrs_state", "INTEGER NOT NULL DEFAULT 0"],
    ["fsrs_scheduled_days", "INTEGER NOT NULL DEFAULT 0"],
    ["fsrs_learning_steps", "INTEGER NOT NULL DEFAULT 0"],
  ];
  stageColumns.forEach(([name, definition]) => {
    if (!tableHasColumn(db, "mastery_stage_states", name)) {
      db.exec(`ALTER TABLE mastery_stage_states ADD COLUMN ${name} ${definition}`);
    }
  });

  db.exec(`
    CREATE TABLE IF NOT EXISTS mastery_revision_events (
      id INTEGER PRIMARY KEY,
      event_kind TEXT NOT NULL CHECK(event_kind IN ('graded', 'manual_outcome')),
      document_path TEXT NOT NULL,
      concept_id INTEGER,
      concept_name TEXT NOT NULL,
      stage INTEGER NOT NULL CHECK(stage BETWEEN 2 AND 6),
      session_id INTEGER,
      session_card_id INTEGER,
      submission_id INTEGER,
      grading_run_id INTEGER,
      source_card_id INTEGER,
      score INTEGER,
      outcome TEXT NOT NULL CHECK(outcome IN ('passed', 'review')),
      rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 4),
      reviewed_at INTEGER NOT NULL,
      previous_due_at INTEGER,
      next_due_at INTEGER NOT NULL,
      previous_stability REAL,
      next_stability REAL,
      previous_difficulty REAL,
      next_difficulty REAL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      dedupe_key TEXT NOT NULL UNIQUE,
      FOREIGN KEY(concept_id) REFERENCES mastery_concepts(id) ON DELETE SET NULL,
      FOREIGN KEY(session_id) REFERENCES mastery_practice_sessions(id) ON DELETE SET NULL,
      FOREIGN KEY(session_card_id) REFERENCES mastery_practice_session_cards(id) ON DELETE SET NULL,
      FOREIGN KEY(submission_id) REFERENCES mastery_practice_submissions(id) ON DELETE SET NULL,
      FOREIGN KEY(grading_run_id) REFERENCES mastery_practice_grading_runs(id) ON DELETE SET NULL,
      FOREIGN KEY(source_card_id) REFERENCES mastery_cards(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS mastery_revision_events_due_index
      ON mastery_revision_events(next_due_at, document_path);
    CREATE INDEX IF NOT EXISTS mastery_revision_events_concept_index
      ON mastery_revision_events(concept_id, stage, reviewed_at DESC);
    CREATE INDEX IF NOT EXISTS mastery_revision_events_session_index
      ON mastery_revision_events(session_id, session_card_id);
  `);
}

function migrateLegacyRevisionSchedules(db) {
  backfillLegacyRevisionSchedules(db);
}

function migrateSessionCardDocumentSnapshots(db) {
  if (!tableHasColumn(db, "mastery_practice_session_cards", "source_document_markdown")) {
    db.exec("ALTER TABLE mastery_practice_session_cards ADD COLUMN source_document_markdown TEXT");
  }
  db.exec(`
    UPDATE mastery_practice_session_cards
    SET source_document_markdown = (
      SELECT sessions.document_markdown
      FROM mastery_practice_sessions sessions
      WHERE sessions.id = mastery_practice_session_cards.session_id
    )
    WHERE source_document_markdown IS NULL;
  `);
}

function migrateBootstrapRevisionEnrollment(db) {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  db.prepare(
    `INSERT OR IGNORE INTO mastery_stage_states(
       concept_id, stage, score, attempt_count, last_reviewed_at, next_due_at,
       fsrs_state, fsrs_scheduled_days, fsrs_learning_steps,
       lapse_count, status, updated_at
     )
     SELECT id, 2, 0, 0, NULL, created_at + ?, 0, 0, 0, 0, 'active', ?
     FROM mastery_concepts
     WHERE status = 'active'`,
  ).run(dayMs, now);
  db.prepare(
    `UPDATE mastery_stage_states
     SET next_due_at = (
       SELECT concepts.created_at + ?
       FROM mastery_concepts concepts
       WHERE concepts.id = mastery_stage_states.concept_id
     ), updated_at = ?
     WHERE stage = 2 AND attempt_count = 0 AND next_due_at IS NULL AND fsrs_state = 0
       AND concept_id IN (SELECT id FROM mastery_concepts WHERE status = 'active')`,
  ).run(dayMs, now);
}

function runMasteryMigrations() {
  if (migrationsReady) return;
  const databasePath = getMasteryDatabasePath();
  const probe = fs.existsSync(databasePath) ? new DatabaseSync(databasePath) : null;
  let currentVersion = 0;
  if (probe) {
    currentVersion = migrationVersion(probe);
    probe.close();
  }
  if (currentVersion < latestVersion) {
    const backupPath = backupDatabase(databasePath, latestVersion);
    if (backupPath) console.info("Mastery migration backup created:", backupPath);
  }

  const db = getMasteryDatabase();
  ensureMasteryCardSchema();
  currentVersion = migrationVersion(db);
  if (currentVersion < 1) applyMigration(db, 1, migrateCrossNoteSessions);
  if (currentVersion < 2) applyMigration(db, 2, migrateRevisionScheduling);
  if (currentVersion < 3) applyMigration(db, 3, migrateLegacyRevisionSchedules);
  if (currentVersion < 4) applyMigration(db, 4, migrateSessionCardDocumentSnapshots);
  if (currentVersion < 5) applyMigration(db, 5, migrateBootstrapRevisionEnrollment);
  migrationsReady = true;
}

module.exports = {
  latestVersion,
  runMasteryMigrations,
};
