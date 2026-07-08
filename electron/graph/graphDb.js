const { app } = require("electron");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const databaseFileName = "learner.sqlite";
let graphDatabase = null;

function getGraphDatabasePath() {
  return path.join(app.getPath("userData"), databaseFileName);
}

function normalizeConceptName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9/+.#-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeRelationName(relation) {
  return String(relation || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_");
}

function hashContent(content) {
  return crypto.createHash("sha256").update(String(content || "")).digest("hex");
}

function clampConfidence(value, fallback = 0.7) {
  const confidence = Number(value);
  if (!Number.isFinite(confidence)) return fallback;
  return Math.min(Math.max(confidence, 0), 1);
}

function getGraphDatabase() {
  if (graphDatabase) return graphDatabase;

  const databasePath = getGraphDatabasePath();
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });

  graphDatabase = new DatabaseSync(databasePath);
  graphDatabase.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS graph_extraction_runs (
      document_path TEXT PRIMARY KEY,
      document_hash TEXT NOT NULL,
      model TEXT NOT NULL,
      extracted_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS concepts (
      id INTEGER PRIMARY KEY,
      normalized_name TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      type TEXT,
      summary TEXT,
      confidence REAL NOT NULL DEFAULT 0.7,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS concept_aliases (
      id INTEGER PRIMARY KEY,
      concept_id INTEGER NOT NULL,
      alias TEXT NOT NULL,
      normalized_alias TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(concept_id) REFERENCES concepts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS concept_mentions (
      id INTEGER PRIMARY KEY,
      concept_id INTEGER NOT NULL,
      document_path TEXT NOT NULL,
      document_hash TEXT NOT NULL,
      section_title TEXT,
      excerpt_markdown TEXT NOT NULL,
      excerpt_hash TEXT NOT NULL,
      mention_type TEXT,
      confidence REAL NOT NULL DEFAULT 0.7,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(concept_id, document_path, excerpt_hash),
      FOREIGN KEY(concept_id) REFERENCES concepts(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS concept_mentions_document_index
      ON concept_mentions(document_path);

    CREATE INDEX IF NOT EXISTS concept_mentions_concept_index
      ON concept_mentions(concept_id);

    CREATE TABLE IF NOT EXISTS concept_relations (
      id INTEGER PRIMARY KEY,
      from_concept_id INTEGER NOT NULL,
      to_concept_id INTEGER NOT NULL,
      relation TEXT NOT NULL,
      normalized_relation TEXT NOT NULL,
      explanation TEXT,
      confidence REAL NOT NULL DEFAULT 0.7,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(from_concept_id, to_concept_id, normalized_relation),
      FOREIGN KEY(from_concept_id) REFERENCES concepts(id) ON DELETE CASCADE,
      FOREIGN KEY(to_concept_id) REFERENCES concepts(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS concept_relations_from_index
      ON concept_relations(from_concept_id);

    CREATE INDEX IF NOT EXISTS concept_relations_to_index
      ON concept_relations(to_concept_id);

    CREATE TABLE IF NOT EXISTS relation_evidence (
      id INTEGER PRIMARY KEY,
      relation_id INTEGER NOT NULL,
      document_path TEXT NOT NULL,
      document_hash TEXT NOT NULL,
      excerpt_markdown TEXT NOT NULL,
      excerpt_hash TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.7,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(relation_id, document_path, excerpt_hash),
      FOREIGN KEY(relation_id) REFERENCES concept_relations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS relation_evidence_document_index
      ON relation_evidence(document_path);
  `);

  return graphDatabase;
}

function closeGraphDatabase() {
  if (!graphDatabase) return;
  graphDatabase.close();
  graphDatabase = null;
}

function getExtractionRun(documentPath) {
  return getGraphDatabase()
    .prepare("SELECT document_path, document_hash, model, extracted_at FROM graph_extraction_runs WHERE document_path = ?")
    .get(documentPath) ?? null;
}

function findConceptByNameOrAlias(name, aliases = []) {
  const db = getGraphDatabase();
  const candidates = [name, ...aliases].map(normalizeConceptName).filter(Boolean);

  for (const normalizedName of candidates) {
    const concept = db.prepare("SELECT * FROM concepts WHERE normalized_name = ?").get(normalizedName);
    if (concept) return concept;

    const alias = db
      .prepare(
        `
          SELECT c.*
          FROM concept_aliases a
          INNER JOIN concepts c ON c.id = a.concept_id
          WHERE a.normalized_alias = ?
        `,
      )
      .get(normalizedName);
    if (alias) return alias;
  }

  return null;
}

function upsertConcept(concept, now) {
  const db = getGraphDatabase();
  const name = String(concept.name || "").trim();
  const normalizedName = normalizeConceptName(name);
  if (!normalizedName) return null;

  const aliases = Array.isArray(concept.aliases) ? concept.aliases.filter((alias) => typeof alias === "string") : [];
  const existingConcept = findConceptByNameOrAlias(name, aliases);
  const confidence = clampConfidence(concept.confidence);

  if (existingConcept) {
    db.prepare(
      `
        UPDATE concepts
        SET type = COALESCE(NULLIF(?, ''), type),
            summary = COALESCE(NULLIF(?, ''), summary),
            confidence = MAX(confidence, ?),
            updated_at = ?
        WHERE id = ?
      `,
    ).run(String(concept.type || ""), String(concept.summary || ""), confidence, now, existingConcept.id);

    insertConceptAliases(existingConcept.id, [name, ...aliases], now);
    return existingConcept.id;
  }

  const result = db.prepare(
    `
      INSERT INTO concepts(normalized_name, name, type, summary, confidence, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    normalizedName,
    name,
    String(concept.type || "").trim() || null,
    String(concept.summary || "").trim() || null,
    confidence,
    now,
    now,
  );

  insertConceptAliases(result.lastInsertRowid, [name, ...aliases], now);
  return result.lastInsertRowid;
}

function insertConceptAliases(conceptId, aliases, now) {
  const db = getGraphDatabase();
  const insertAlias = db.prepare(
    `
      INSERT INTO concept_aliases(concept_id, alias, normalized_alias, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(normalized_alias) DO NOTHING
    `,
  );

  for (const alias of aliases) {
    const cleanAlias = String(alias || "").trim();
    const normalizedAlias = normalizeConceptName(cleanAlias);
    if (!normalizedAlias) continue;
    insertAlias.run(conceptId, cleanAlias, normalizedAlias, now);
  }
}

function insertConceptMention(conceptId, documentPath, documentHash, mention, now) {
  const excerptMarkdown = String(mention.excerptMarkdown || mention.excerpt || "").trim();
  if (!excerptMarkdown) return;

  getGraphDatabase().prepare(
    `
      INSERT INTO concept_mentions(
        concept_id,
        document_path,
        document_hash,
        section_title,
        excerpt_markdown,
        excerpt_hash,
        mention_type,
        confidence,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(concept_id, document_path, excerpt_hash) DO UPDATE SET
        document_hash = excluded.document_hash,
        section_title = excluded.section_title,
        mention_type = excluded.mention_type,
        confidence = excluded.confidence,
        updated_at = excluded.updated_at
    `,
  ).run(
    conceptId,
    documentPath,
    documentHash,
    String(mention.sectionTitle || "").trim() || null,
    excerptMarkdown,
    hashContent(excerptMarkdown),
    String(mention.mentionType || "").trim() || null,
    clampConfidence(mention.confidence),
    now,
    now,
  );
}

function upsertRelation(fromConceptId, toConceptId, relation, now) {
  const db = getGraphDatabase();
  const cleanRelation = String(relation.relation || "").trim() || "related_to";
  const normalizedRelation = normalizeRelationName(cleanRelation) || "related_to";
  const confidence = clampConfidence(relation.confidence);
  const existing = db
    .prepare(
      `
        SELECT id
        FROM concept_relations
        WHERE from_concept_id = ?
          AND to_concept_id = ?
          AND normalized_relation = ?
      `,
    )
    .get(fromConceptId, toConceptId, normalizedRelation);

  if (existing) {
    db.prepare(
      `
        UPDATE concept_relations
        SET relation = ?,
            explanation = COALESCE(NULLIF(?, ''), explanation),
            confidence = MAX(confidence, ?),
            updated_at = ?
        WHERE id = ?
      `,
    ).run(cleanRelation, String(relation.explanation || ""), confidence, now, existing.id);
    return existing.id;
  }

  const result = db.prepare(
    `
      INSERT INTO concept_relations(
        from_concept_id,
        to_concept_id,
        relation,
        normalized_relation,
        explanation,
        confidence,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    fromConceptId,
    toConceptId,
    cleanRelation,
    normalizedRelation,
    String(relation.explanation || "").trim() || null,
    confidence,
    now,
    now,
  );

  return result.lastInsertRowid;
}

function insertRelationEvidence(relationId, documentPath, documentHash, relation, now) {
  const excerptMarkdown = String(relation.excerptMarkdown || relation.excerpt || "").trim();
  if (!excerptMarkdown) return;

  getGraphDatabase().prepare(
    `
      INSERT INTO relation_evidence(
        relation_id,
        document_path,
        document_hash,
        excerpt_markdown,
        excerpt_hash,
        confidence,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(relation_id, document_path, excerpt_hash) DO UPDATE SET
        document_hash = excluded.document_hash,
        confidence = excluded.confidence,
        updated_at = excluded.updated_at
    `,
  ).run(
    relationId,
    documentPath,
    documentHash,
    excerptMarkdown,
    hashContent(excerptMarkdown),
    clampConfidence(relation.confidence),
    now,
    now,
  );
}

function deleteDocumentGraphRows(documentPath) {
  const db = getGraphDatabase();
  db.prepare("DELETE FROM concept_mentions WHERE document_path = ?").run(documentPath);
  db.prepare("DELETE FROM relation_evidence WHERE document_path = ?").run(documentPath);
  db.prepare("DELETE FROM graph_extraction_runs WHERE document_path = ?").run(documentPath);
  db.prepare("DELETE FROM concept_relations WHERE id NOT IN (SELECT DISTINCT relation_id FROM relation_evidence)").run();
  db.prepare(`
    DELETE FROM concepts
    WHERE id NOT IN (SELECT DISTINCT concept_id FROM concept_mentions)
      AND id NOT IN (SELECT DISTINCT from_concept_id FROM concept_relations)
      AND id NOT IN (SELECT DISTINCT to_concept_id FROM concept_relations)
  `).run();
}

function saveExtractedDocumentGraph({ documentHash, documentPath, extraction, model }) {
  const db = getGraphDatabase();
  const now = Date.now();
  const conceptIdByName = new Map();
  const concepts = Array.isArray(extraction?.concepts) ? extraction.concepts : [];
  const relations = Array.isArray(extraction?.relations) ? extraction.relations : [];

  db.exec("BEGIN IMMEDIATE");
  try {
    deleteDocumentGraphRows(documentPath);

    for (const concept of concepts) {
      const conceptId = upsertConcept(concept, now);
      if (!conceptId) continue;

      const names = [concept.name, ...(Array.isArray(concept.aliases) ? concept.aliases : [])];
      names.forEach((name) => {
        const normalizedName = normalizeConceptName(name);
        if (normalizedName) conceptIdByName.set(normalizedName, conceptId);
      });

      insertConceptMention(conceptId, documentPath, documentHash, concept, now);
    }

    for (const relation of relations) {
      const fromConceptId =
        conceptIdByName.get(normalizeConceptName(relation.from)) ??
        upsertConcept({ name: relation.from, confidence: relation.confidence }, now);
      const toConceptId =
        conceptIdByName.get(normalizeConceptName(relation.to)) ??
        upsertConcept({ name: relation.to, confidence: relation.confidence }, now);

      if (!fromConceptId || !toConceptId || fromConceptId === toConceptId) continue;

      const relationId = upsertRelation(fromConceptId, toConceptId, relation, now);
      insertRelationEvidence(relationId, documentPath, documentHash, relation, now);
    }

    db.prepare(
      `
        INSERT INTO graph_extraction_runs(document_path, document_hash, model, extracted_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(document_path) DO UPDATE SET
          document_hash = excluded.document_hash,
          model = excluded.model,
          extracted_at = excluded.extracted_at
      `,
    ).run(documentPath, documentHash, model, now);

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return getDocumentGraph(documentPath);
}

function getConceptMentions(conceptId, currentDocumentPath) {
  return getGraphDatabase()
    .prepare(
      `
        SELECT
          document_path AS documentPath,
          section_title AS sectionTitle,
          excerpt_markdown AS excerptMarkdown,
          mention_type AS mentionType,
          confidence,
          updated_at AS updatedAt
        FROM concept_mentions
        WHERE concept_id = ?
        ORDER BY
          CASE WHEN document_path = ? THEN 0 ELSE 1 END,
          updated_at DESC
      `,
    )
    .all(conceptId, currentDocumentPath);
}

function getRelationEvidence(relationId, currentDocumentPath) {
  return getGraphDatabase()
    .prepare(
      `
        SELECT
          document_path AS documentPath,
          excerpt_markdown AS excerptMarkdown,
          confidence,
          updated_at AS updatedAt
        FROM relation_evidence
        WHERE relation_id = ?
        ORDER BY
          CASE WHEN document_path = ? THEN 0 ELSE 1 END,
          updated_at DESC
      `,
    )
    .all(relationId, currentDocumentPath);
}

function getDocumentGraph(documentPath) {
  const db = getGraphDatabase();
  const run = getExtractionRun(documentPath);
  const currentConceptRows = db
    .prepare(
      `
        SELECT DISTINCT c.*
        FROM concept_mentions m
        INNER JOIN concepts c ON c.id = m.concept_id
        WHERE m.document_path = ?
        ORDER BY c.name
      `,
    )
    .all(documentPath);
  const currentConceptIds = new Set(currentConceptRows.map((concept) => concept.id));
  const graphNodes = new Map(currentConceptRows.map((concept) => [concept.id, concept]));
  const relationRows =
    currentConceptRows.length === 0
      ? []
      : db
          .prepare(
            `
              SELECT
                r.id,
                r.from_concept_id AS fromConceptId,
                r.to_concept_id AS toConceptId,
                r.relation,
                r.explanation,
                r.confidence,
                source.name AS sourceName,
                source.type AS sourceType,
                source.summary AS sourceSummary,
                target.name AS targetName,
                target.type AS targetType,
                target.summary AS targetSummary
              FROM concept_relations r
              INNER JOIN concepts source ON source.id = r.from_concept_id
              INNER JOIN concepts target ON target.id = r.to_concept_id
              WHERE r.from_concept_id IN (${currentConceptRows.map(() => "?").join(",")})
                 OR r.to_concept_id IN (${currentConceptRows.map(() => "?").join(",")})
              ORDER BY r.confidence DESC, r.updated_at DESC
            `,
          )
          .all(...currentConceptRows.map((concept) => concept.id), ...currentConceptRows.map((concept) => concept.id));

  for (const relation of relationRows) {
    if (!graphNodes.has(relation.fromConceptId)) {
      graphNodes.set(relation.fromConceptId, {
        id: relation.fromConceptId,
        name: relation.sourceName,
        type: relation.sourceType,
        summary: relation.sourceSummary,
      });
    }

    if (!graphNodes.has(relation.toConceptId)) {
      graphNodes.set(relation.toConceptId, {
        id: relation.toConceptId,
        name: relation.targetName,
        type: relation.targetType,
        summary: relation.targetSummary,
      });
    }
  }

  return {
    documentHash: run?.document_hash ?? null,
    documentPath,
    extractedAt: run?.extracted_at ?? null,
    model: run?.model ?? null,
    nodes: [...graphNodes.values()].map((concept) => ({
      id: concept.id,
      name: concept.name,
      type: concept.type,
      summary: concept.summary,
      inCurrentDocument: currentConceptIds.has(concept.id),
      mentions: getConceptMentions(concept.id, documentPath),
    })),
    edges: relationRows.map((relation) => ({
      id: relation.id,
      source: relation.fromConceptId,
      target: relation.toConceptId,
      relation: relation.relation,
      explanation: relation.explanation,
      confidence: relation.confidence,
      evidence: getRelationEvidence(relation.id, documentPath),
    })),
  };
}

function deleteDocumentGraph(documentPath) {
  getGraphDatabase().exec("BEGIN IMMEDIATE");
  try {
    deleteDocumentGraphRows(documentPath);
    getGraphDatabase().exec("COMMIT");
  } catch (error) {
    getGraphDatabase().exec("ROLLBACK");
    throw error;
  }
}

function deleteDocumentGraphTree(folderPath) {
  const db = getGraphDatabase();
  const normalizedPath = String(folderPath || "").replace(/\\/g, "/").replace(/\/+$/g, "");
  const prefix = `${normalizedPath}/%`;

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM concept_mentions WHERE document_path LIKE ?").run(prefix);
    db.prepare("DELETE FROM relation_evidence WHERE document_path LIKE ?").run(prefix);
    db.prepare("DELETE FROM graph_extraction_runs WHERE document_path LIKE ?").run(prefix);
    db.prepare("DELETE FROM concept_relations WHERE id NOT IN (SELECT DISTINCT relation_id FROM relation_evidence)").run();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function replaceDocumentGraphPath(oldPath, newPath) {
  const db = getGraphDatabase();
  const normalizedOldPath = String(oldPath || "").replace(/\\/g, "/").replace(/\/+$/g, "");
  const normalizedNewPath = String(newPath || "").replace(/\\/g, "/").replace(/\/+$/g, "");
  const oldPrefix = `${normalizedOldPath}/%`;

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE concept_mentions SET document_path = REPLACE(document_path, ?, ?) WHERE document_path = ? OR document_path LIKE ?")
      .run(normalizedOldPath, normalizedNewPath, normalizedOldPath, oldPrefix);
    db.prepare("UPDATE relation_evidence SET document_path = REPLACE(document_path, ?, ?) WHERE document_path = ? OR document_path LIKE ?")
      .run(normalizedOldPath, normalizedNewPath, normalizedOldPath, oldPrefix);
    db.prepare("UPDATE graph_extraction_runs SET document_path = REPLACE(document_path, ?, ?) WHERE document_path = ? OR document_path LIKE ?")
      .run(normalizedOldPath, normalizedNewPath, normalizedOldPath, oldPrefix);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

module.exports = {
  closeGraphDatabase,
  deleteDocumentGraph,
  deleteDocumentGraphTree,
  getDocumentGraph,
  getExtractionRun,
  hashContent,
  normalizeConceptName,
  replaceDocumentGraphPath,
  saveExtractedDocumentGraph,
};
