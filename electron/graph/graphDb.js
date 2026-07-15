const { app } = require("electron");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { graphDebug, graphLog, graphWarn, hashPreview, startTimer } = require("./graphLog");

const databaseFileName = "learner.sqlite";
let graphDatabase = null;
let graphDatabaseReadyLogged = false;

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

function vectorToBuffer(vector) {
  return Buffer.from(new Float32Array(vector).buffer);
}

function bufferToVector(buffer) {
  return Array.from(new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / Float32Array.BYTES_PER_ELEMENT));
}

function dotProduct(a, b) {
  const length = Math.min(a.length, b.length);
  let total = 0;

  for (let index = 0; index < length; index += 1) {
    total += a[index] * b[index];
  }

  return total;
}

function vectorMagnitude(vector) {
  return Math.sqrt(dotProduct(vector, vector));
}

function cosineSimilarity(a, b) {
  const denominator = vectorMagnitude(a) * vectorMagnitude(b);
  if (!denominator) return 0;
  return dotProduct(a, b) / denominator;
}

function ensureColumn(db, tableName, columnName, definition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (columns.some((column) => column.name === columnName)) return;
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
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
      explanation TEXT,
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
      contribution TEXT,
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
      source TEXT NOT NULL DEFAULT 'local',
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

    CREATE TABLE IF NOT EXISTS concept_embeddings (
      concept_id INTEGER NOT NULL,
      model TEXT NOT NULL,
      profile_hash TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      embedding BLOB NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(concept_id, model),
      FOREIGN KEY(concept_id) REFERENCES concepts(id) ON DELETE CASCADE
    );
  `);

  ensureColumn(graphDatabase, "concepts", "explanation", "TEXT");
  ensureColumn(graphDatabase, "concept_mentions", "contribution", "TEXT");
  ensureColumn(graphDatabase, "concept_relations", "source", "TEXT NOT NULL DEFAULT 'local'");

  if (!graphDatabaseReadyLogged) {
    graphLog("db.ready", {
      databasePath,
    });
    graphDatabaseReadyLogged = true;
  }

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
        SET name = COALESCE(NULLIF(?, ''), name),
            type = COALESCE(type, NULLIF(?, '')),
            summary = COALESCE(summary, NULLIF(?, '')),
            explanation = COALESCE(explanation, NULLIF(?, '')),
            confidence = MAX(confidence, ?),
            updated_at = ?
        WHERE id = ?
      `,
    ).run(
      name,
      String(concept.type || ""),
      String(concept.summary || ""),
      String(concept.explanation || ""),
      confidence,
      now,
      existingConcept.id,
    );

    insertConceptAliases(existingConcept.id, [name, ...aliases], now);
    return existingConcept.id;
  }

  const result = db.prepare(
    `
      INSERT INTO concepts(normalized_name, name, type, summary, explanation, confidence, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    normalizedName,
    name,
    String(concept.type || "").trim() || null,
    String(concept.summary || "").trim() || null,
    String(concept.explanation || "").trim() || null,
    confidence,
    now,
    now,
  );

  insertConceptAliases(result.lastInsertRowid, [name, ...aliases], now);
  return result.lastInsertRowid;
}

function updateConceptDetails(
  conceptId,
  concept,
  now,
  { allowRename = false, overwriteExistingDetails = false, overwriteExplanation = false } = {},
) {
  const existingConcept = getConceptById(conceptId);
  if (!existingConcept) return null;

  const name = String(concept.name || "").trim();
  const normalizedName = normalizeConceptName(name);
  const conflictingConcept = normalizedName
    ? getGraphDatabase().prepare("SELECT id FROM concepts WHERE normalized_name = ? AND id != ?").get(normalizedName, conceptId)
    : null;
  const shouldRename = allowRename && normalizedName && !conflictingConcept;

  getGraphDatabase().prepare(
    `
      UPDATE concepts
      SET name = CASE WHEN ? THEN ? ELSE name END,
          normalized_name = CASE WHEN ? THEN ? ELSE normalized_name END,
          type = CASE WHEN ? THEN COALESCE(NULLIF(?, ''), type) ELSE COALESCE(type, NULLIF(?, '')) END,
          summary = CASE WHEN ? THEN COALESCE(NULLIF(?, ''), summary) ELSE COALESCE(summary, NULLIF(?, '')) END,
          explanation = CASE WHEN ? THEN COALESCE(NULLIF(?, ''), explanation) ELSE COALESCE(explanation, NULLIF(?, '')) END,
          confidence = MAX(confidence, ?),
          updated_at = ?
      WHERE id = ?
    `,
  ).run(
    shouldRename ? 1 : 0,
    name,
    shouldRename ? 1 : 0,
    normalizedName,
    overwriteExistingDetails ? 1 : 0,
    String(concept.type || ""),
    String(concept.type || ""),
    overwriteExistingDetails ? 1 : 0,
    String(concept.summary || ""),
    String(concept.summary || ""),
    overwriteExistingDetails || overwriteExplanation ? 1 : 0,
    String(concept.explanation || ""),
    String(concept.explanation || ""),
    clampConfidence(concept.confidence),
    now,
    conceptId,
  );

  insertConceptAliases(conceptId, [name, ...(Array.isArray(concept.aliases) ? concept.aliases : [])], now);
  return conceptId;
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
  if (!excerptMarkdown) return false;

  getGraphDatabase()
    .prepare("DELETE FROM concept_mentions WHERE concept_id = ? AND document_path = ?")
    .run(conceptId, documentPath);

  getGraphDatabase().prepare(
    `
      INSERT INTO concept_mentions(
        concept_id,
        document_path,
        document_hash,
        section_title,
        excerpt_markdown,
        excerpt_hash,
        contribution,
        mention_type,
        confidence,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(concept_id, document_path, excerpt_hash) DO UPDATE SET
        document_hash = excluded.document_hash,
        section_title = excluded.section_title,
        contribution = excluded.contribution,
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
    String(mention.contribution || "").trim() || null,
    String(mention.mentionType || "").trim() || null,
    clampConfidence(mention.confidence),
    now,
    now,
  );
  return true;
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
            source = COALESCE(NULLIF(?, ''), source),
            confidence = MAX(confidence, ?),
            updated_at = ?
        WHERE id = ?
      `,
    ).run(cleanRelation, String(relation.explanation || ""), String(relation.source || ""), confidence, now, existing.id);
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
        source,
        confidence,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    fromConceptId,
    toConceptId,
    cleanRelation,
    normalizedRelation,
    String(relation.explanation || "").trim() || null,
    String(relation.source || "").trim() || "local",
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

function getConceptById(conceptId) {
  return getGraphDatabase().prepare("SELECT * FROM concepts WHERE id = ?").get(conceptId) ?? null;
}

function getConceptAliases(conceptId) {
  return getGraphDatabase()
    .prepare("SELECT alias FROM concept_aliases WHERE concept_id = ? ORDER BY alias")
    .all(conceptId)
    .map((row) => row.alias);
}

function getConceptMentionProfiles(conceptId, limit = 6) {
  const rows = getGraphDatabase()
    .prepare(
      `
        SELECT
          document_path AS documentPath,
          contribution,
          excerpt_markdown AS excerptMarkdown,
          updated_at AS updatedAt
        FROM concept_mentions
        WHERE concept_id = ?
        ORDER BY updated_at DESC
      `,
    )
    .all(conceptId);
  const mentionsByDocument = new Map();

  for (const row of rows) {
    if (!mentionsByDocument.has(row.documentPath)) {
      mentionsByDocument.set(row.documentPath, row);
    }
  }

  return [...mentionsByDocument.values()].slice(0, Math.max(1, Number(limit) || 6));
}

function buildConceptProfile(concept, aliases = []) {
  return [
    `Name: ${concept.name}`,
    aliases.length ? `Aliases: ${aliases.join(", ")}` : "",
    concept.type ? `Type: ${concept.type}` : "",
    concept.summary ? `Summary: ${concept.summary}` : "",
    concept.explanation ? `Explanation: ${concept.explanation}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function getConceptProfiles(conceptIds) {
  const ids = [...new Set((conceptIds || []).map(Number).filter(Number.isFinite))];
  return ids
    .map((conceptId) => {
      const concept = getConceptById(conceptId);
      if (!concept) return null;
      const aliases = getConceptAliases(conceptId);

      return {
        aliases,
        confidence: concept.confidence,
        explanation: concept.explanation,
        id: concept.id,
        mentions: getConceptMentionProfiles(concept.id),
        name: concept.name,
        normalizedName: concept.normalized_name,
        profile: buildConceptProfile(concept, aliases),
        summary: concept.summary,
        type: concept.type,
      };
    })
    .filter(Boolean);
}

function findExactConceptCandidates(name, aliases = []) {
  const db = getGraphDatabase();
  const normalizedCandidates = [name, ...(Array.isArray(aliases) ? aliases : [])]
    .map(normalizeConceptName)
    .filter(Boolean);
  const concepts = new Map();

  for (const normalizedName of normalizedCandidates) {
    const concept = db.prepare("SELECT * FROM concepts WHERE normalized_name = ?").get(normalizedName);
    if (concept) concepts.set(concept.id, concept);

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
    if (alias) concepts.set(alias.id, alias);
  }

  return [...concepts.values()];
}

function saveConceptEmbedding({ conceptId, embedding, model, profileHash }) {
  if (!Array.isArray(embedding) || embedding.length === 0) return;

  getGraphDatabase().prepare(
    `
      INSERT INTO concept_embeddings(concept_id, model, profile_hash, dimensions, embedding, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(concept_id, model) DO UPDATE SET
        profile_hash = excluded.profile_hash,
        dimensions = excluded.dimensions,
        embedding = excluded.embedding,
        updated_at = excluded.updated_at
    `,
  ).run(conceptId, model, profileHash, embedding.length, vectorToBuffer(embedding), Date.now());
}

function searchConceptEmbeddings(queryEmbedding, model, limit = 8) {
  if (!Array.isArray(queryEmbedding) || queryEmbedding.length === 0) return [];

  return getGraphDatabase()
    .prepare(
      `
        SELECT
          c.*,
          e.embedding
        FROM concept_embeddings e
        INNER JOIN concepts c ON c.id = e.concept_id
        WHERE e.model = ?
      `,
    )
    .all(model)
    .map((row) => ({
      ...row,
      score: cosineSimilarity(queryEmbedding, bufferToVector(row.embedding)),
    }))
    .filter((row) => row.score > 0)
    .sort((first, second) => second.score - first.score)
    .slice(0, Math.min(Math.max(Number(limit) || 8, 1), 20));
}

function findConceptResolutionCandidates({ aliases = [], embedding, embeddingModel, limit = 8, name }) {
  const elapsed = startTimer();
  const exactCandidates = findExactConceptCandidates(name, aliases).map((concept) => ({
    ...concept,
    matchReason: "exact_or_alias",
    score: 1,
  }));
  const vectorCandidates = searchConceptEmbeddings(embedding, embeddingModel, limit).map((concept) => ({
    ...concept,
    matchReason: "summary_embedding",
  }));
  const candidates = new Map();

  for (const concept of [...exactCandidates, ...vectorCandidates]) {
    if (!candidates.has(concept.id)) {
      candidates.set(concept.id, concept);
      continue;
    }

    const existing = candidates.get(concept.id);
    if ((concept.score ?? 0) > (existing.score ?? 0)) {
      candidates.set(concept.id, concept);
    }
  }

  const profiles = getConceptProfiles([...candidates.keys()]).map((profile) => {
    const candidate = candidates.get(profile.id);
    return {
      ...profile,
      matchReason: candidate.matchReason,
      score: candidate.score,
    };
  });

  graphDebug("db.concept_candidates", {
    candidateName: name,
    durationMs: elapsed(),
    exactCount: exactCandidates.length,
    resultCount: profiles.length,
    vectorCount: vectorCandidates.length,
    results: profiles.map((profile) => ({
      id: profile.id,
      matchReason: profile.matchReason,
      name: profile.name,
      score: Number(profile.score ?? 0).toFixed(3),
    })),
  });

  return profiles;
}

function insertConceptMentionRow(conceptId, row, now) {
  getGraphDatabase().prepare(
    `
      INSERT INTO concept_mentions(
        concept_id,
        document_path,
        document_hash,
        section_title,
        excerpt_markdown,
        excerpt_hash,
        contribution,
        mention_type,
        confidence,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(concept_id, document_path, excerpt_hash) DO UPDATE SET
        document_hash = excluded.document_hash,
        section_title = excluded.section_title,
        contribution = excluded.contribution,
        mention_type = excluded.mention_type,
        confidence = excluded.confidence,
        updated_at = excluded.updated_at
    `,
  ).run(
    conceptId,
    row.document_path,
    row.document_hash,
    row.section_title,
    row.excerpt_markdown,
    row.excerpt_hash,
    row.contribution,
    row.mention_type,
    clampConfidence(row.confidence),
    now,
    now,
  );
}

function insertRelationEvidenceRow(relationId, row, now) {
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
    row.document_path,
    row.document_hash,
    row.excerpt_markdown,
    row.excerpt_hash,
    clampConfidence(row.confidence),
    now,
    now,
  );
}

function mergeConceptInto(targetConceptId, sourceConceptId, now) {
  if (!targetConceptId || !sourceConceptId || targetConceptId === sourceConceptId) return;

  const db = getGraphDatabase();
  const sourceConcept = getConceptById(sourceConceptId);
  if (!sourceConcept) {
    graphWarn("db.merge.skipped_missing_source", {
      sourceConceptId,
      targetConceptId,
    });
    return;
  }
  const targetConcept = getConceptById(targetConceptId);
  const elapsed = startTimer();
  graphLog("db.merge.start", {
    sourceConceptId,
    sourceName: sourceConcept.name,
    targetConceptId,
    targetName: targetConcept?.name ?? null,
  });

  const sourceAliases = getConceptAliases(sourceConceptId);
  db.prepare("DELETE FROM concept_aliases WHERE concept_id = ?").run(sourceConceptId);
  insertConceptAliases(targetConceptId, [sourceConcept.name, ...sourceAliases], now);

  const mentionRows = db.prepare("SELECT * FROM concept_mentions WHERE concept_id = ?").all(sourceConceptId);
  for (const mentionRow of mentionRows) {
    insertConceptMentionRow(targetConceptId, mentionRow, now);
  }

  const relationRows = db.prepare("SELECT * FROM concept_relations WHERE from_concept_id = ? OR to_concept_id = ?").all(
    sourceConceptId,
    sourceConceptId,
  );
  for (const relationRow of relationRows) {
    const fromConceptId = relationRow.from_concept_id === sourceConceptId ? targetConceptId : relationRow.from_concept_id;
    const toConceptId = relationRow.to_concept_id === sourceConceptId ? targetConceptId : relationRow.to_concept_id;
    const evidenceRows = db.prepare("SELECT * FROM relation_evidence WHERE relation_id = ?").all(relationRow.id);

    if (fromConceptId !== toConceptId) {
      const mergedRelationId = upsertRelation(
        fromConceptId,
        toConceptId,
        {
          confidence: relationRow.confidence,
          explanation: relationRow.explanation,
          relation: relationRow.relation,
          source: relationRow.source,
        },
        now,
      );

      for (const evidenceRow of evidenceRows) {
        insertRelationEvidenceRow(mergedRelationId, evidenceRow, now);
      }
    }

    db.prepare("DELETE FROM concept_relations WHERE id = ?").run(relationRow.id);
  }

  db.prepare("DELETE FROM concept_mentions WHERE concept_id = ?").run(sourceConceptId);
  db.prepare("DELETE FROM concept_embeddings WHERE concept_id = ?").run(sourceConceptId);
  db.prepare("DELETE FROM concepts WHERE id = ?").run(sourceConceptId);

  graphLog("db.merge.done", {
    aliasCount: sourceAliases.length + 1,
    durationMs: elapsed(),
    movedMentionCount: mentionRows.length,
    movedRelationCount: relationRows.length,
    sourceConceptId,
    targetConceptId,
  });
}

function mergeConcepts(targetConceptId, sourceConceptIds, now) {
  for (const sourceConceptId of [...new Set((sourceConceptIds || []).map(Number).filter(Number.isFinite))]) {
    mergeConceptInto(targetConceptId, sourceConceptId, now);
  }
}

function pruneGraphOrphans(db) {
  db.prepare("DELETE FROM concept_relations WHERE id NOT IN (SELECT DISTINCT relation_id FROM relation_evidence)").run();
  db.prepare(`
    DELETE FROM concepts
    WHERE id NOT IN (SELECT DISTINCT concept_id FROM concept_mentions)
      AND id NOT IN (SELECT DISTINCT from_concept_id FROM concept_relations)
      AND id NOT IN (SELECT DISTINCT to_concept_id FROM concept_relations)
  `).run();
  db.prepare("DELETE FROM concept_embeddings WHERE concept_id NOT IN (SELECT id FROM concepts)").run();
}

function deleteDocumentGraphRows(documentPath) {
  const db = getGraphDatabase();
  const existingConceptMentions = db.prepare("SELECT COUNT(*) AS count FROM concept_mentions WHERE document_path = ?").get(documentPath).count;
  const existingRelationEvidence = db.prepare("SELECT COUNT(*) AS count FROM relation_evidence WHERE document_path = ?").get(documentPath).count;
  db.prepare("DELETE FROM concept_mentions WHERE document_path = ?").run(documentPath);
  db.prepare("DELETE FROM relation_evidence WHERE document_path = ?").run(documentPath);
  db.prepare("DELETE FROM graph_extraction_runs WHERE document_path = ?").run(documentPath);
  pruneGraphOrphans(db);
  graphDebug("db.delete_document_rows", {
    documentPath,
    removedConceptMentions: existingConceptMentions,
    removedRelationEvidence: existingRelationEvidence,
  });
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

function saveResolvedDocumentGraph({ documentHash, documentPath, graphBuild, model }) {
  const db = getGraphDatabase();
  const now = Date.now();
  const elapsed = startTimer();
  const conceptIdByKey = new Map();
  const touchedConceptIds = new Set();
  const concepts = Array.isArray(graphBuild?.concepts) ? graphBuild.concepts : [];
  const relations = Array.isArray(graphBuild?.relations) ? graphBuild.relations : [];
  let insertedMentionCount = 0;
  let skippedRelationCount = 0;

  graphLog("db.save_resolved.start", {
    conceptCount: concepts.length,
    documentHash: hashPreview(documentHash),
    documentPath,
    model,
    relationCount: relations.length,
  });

  db.exec("BEGIN IMMEDIATE");
  try {
    deleteDocumentGraphRows(documentPath);

    for (const concept of concepts) {
      const absorbedConceptIds = [...new Set((concept.absorbConceptIds || []).map(Number).filter(Number.isFinite))];
      const existingConcept =
        Number.isFinite(Number(concept.conceptId)) && getConceptById(Number(concept.conceptId))
          ? getConceptById(Number(concept.conceptId))
          : null;
      const exactConcept = findConceptByNameOrAlias(concept.name, concept.aliases || []);
      const absorbedConcept = absorbedConceptIds.map(getConceptById).find(Boolean) ?? null;
      const usesExistingConcept = Boolean(existingConcept || exactConcept);
      const targetConceptId =
        existingConcept?.id ?? exactConcept?.id ?? absorbedConcept?.id ?? upsertConcept(concept, now);

      if (!targetConceptId) continue;

      updateConceptDetails(targetConceptId, concept, now, {
        allowRename: !usesExistingConcept,
        overwriteExistingDetails: !usesExistingConcept,
        overwriteExplanation: usesExistingConcept,
      });
      mergeConcepts(
        targetConceptId,
        absorbedConceptIds.filter((conceptId) => conceptId !== targetConceptId),
        now,
      );

      if (insertConceptMention(targetConceptId, documentPath, documentHash, concept, now)) {
        insertedMentionCount += 1;
      }
      touchedConceptIds.add(targetConceptId);

      const keys = [
        concept.key,
        concept.candidateKey,
        ...(Array.isArray(concept.candidateKeys) ? concept.candidateKeys : []),
        concept.name,
        ...(Array.isArray(concept.aliases) ? concept.aliases : []),
      ];
      for (const key of keys) {
        const normalizedKey = normalizeConceptName(key);
        if (normalizedKey) conceptIdByKey.set(normalizedKey, targetConceptId);
      }
    }

    for (const relation of relations) {
      const fromConceptId =
        conceptIdByKey.get(normalizeConceptName(relation.fromKey || relation.from)) ?? Number(relation.fromConceptId);
      const toConceptId =
        conceptIdByKey.get(normalizeConceptName(relation.toKey || relation.to)) ?? Number(relation.toConceptId);

      if (!getConceptById(fromConceptId) || !getConceptById(toConceptId) || fromConceptId === toConceptId) {
        skippedRelationCount += 1;
        graphWarn("db.save_resolved.skipped_relation", {
          documentPath,
          fromKey: relation.fromKey || relation.from,
          fromConceptId,
          relation: relation.relation,
          toKey: relation.toKey || relation.to,
          toConceptId,
        });
        continue;
      }

      const relationId = upsertRelation(
        fromConceptId,
        toConceptId,
        {
          ...relation,
          source: relation.source || "local",
        },
        now,
      );
      insertRelationEvidence(relationId, documentPath, documentHash, relation, now);
    }

    if (concepts.length > 0 && insertedMentionCount === 0) {
      throw new Error("Graph save produced no concept mentions; refusing to cache an empty graph.");
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
    graphWarn("db.save_resolved.rollback", {
      documentPath,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  const conceptProfiles = getConceptProfiles([...touchedConceptIds]);
  const graph = getDocumentGraph(documentPath);
  graphLog("db.save_resolved.done", {
    conceptProfiles: conceptProfiles.length,
    documentPath,
    durationMs: elapsed(),
    graphEdges: graph.edges.length,
    graphNodes: graph.nodes.length,
    insertedMentionCount,
    skippedRelationCount,
    touchedConceptIds: [...touchedConceptIds],
  });
  return {
    conceptProfiles,
    graph,
  };
}

function getConceptMentions(conceptId, currentDocumentPath) {
  return getGraphDatabase()
    .prepare(
      `
        SELECT
          document_path AS documentPath,
          section_title AS sectionTitle,
          excerpt_markdown AS excerptMarkdown,
          contribution,
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
                r.source,
                r.confidence,
                source.name AS sourceName,
                source.type AS sourceType,
                source.summary AS sourceSummary,
                source.explanation AS sourceExplanation,
                target.name AS targetName,
                target.type AS targetType,
                target.summary AS targetSummary,
                target.explanation AS targetExplanation
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
        explanation: relation.sourceExplanation,
      });
    }

    if (!graphNodes.has(relation.toConceptId)) {
      graphNodes.set(relation.toConceptId, {
        id: relation.toConceptId,
        name: relation.targetName,
        type: relation.targetType,
        summary: relation.targetSummary,
        explanation: relation.targetExplanation,
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
      explanation: concept.explanation,
      inCurrentDocument: currentConceptIds.has(concept.id),
      mentions: getConceptMentions(concept.id, documentPath),
    })),
    edges: relationRows.map((relation) => ({
      id: relation.id,
      source: relation.fromConceptId,
      target: relation.toConceptId,
      relation: relation.relation,
      explanation: relation.explanation,
      sourceType: relation.source,
      confidence: relation.confidence,
      evidence: getRelationEvidence(relation.id, documentPath),
    })),
  };
}

function searchConcepts(query, limit = 12) {
  const normalizedLimit = Math.min(Math.max(Number(limit) || 12, 1), 50);
  const cleanQuery = String(query || "").trim();
  const likeQuery = `%${cleanQuery.replace(/[%_]/g, "\\$&")}%`;

  if (!cleanQuery) {
    return getGraphDatabase()
      .prepare(
        `
          SELECT id, name, type, summary, explanation
          FROM concepts
          ORDER BY updated_at DESC, name
          LIMIT ?
        `,
      )
      .all(normalizedLimit);
  }

  return getGraphDatabase()
    .prepare(
      `
        SELECT DISTINCT c.id, c.name, c.type, c.summary, c.explanation
        FROM concepts c
        LEFT JOIN concept_aliases a ON a.concept_id = c.id
        WHERE c.name LIKE ? ESCAPE '\\'
           OR c.type LIKE ? ESCAPE '\\'
           OR c.summary LIKE ? ESCAPE '\\'
           OR c.explanation LIKE ? ESCAPE '\\'
           OR a.alias LIKE ? ESCAPE '\\'
        ORDER BY
          CASE WHEN c.name LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END,
          c.updated_at DESC,
          c.name
        LIMIT ?
      `,
    )
    .all(likeQuery, likeQuery, likeQuery, likeQuery, likeQuery, `${cleanQuery.replace(/[%_]/g, "\\$&")}%`, normalizedLimit);
}

function updateConcept({ conceptId, explanation, name, summary, type }) {
  const id = Number(conceptId);
  if (!Number.isFinite(id) || !getConceptById(id)) {
    throw new Error("Concept not found.");
  }

  const cleanName = String(name || "").trim();
  if (!cleanName) {
    throw new Error("Concept name cannot be empty.");
  }

  const normalizedName = normalizeConceptName(cleanName);
  const conflictingConcept = getGraphDatabase()
    .prepare("SELECT id FROM concepts WHERE normalized_name = ? AND id != ?")
    .get(normalizedName, id);

  if (conflictingConcept) {
    throw new Error("Another concept already uses that name.");
  }

  getGraphDatabase().prepare(
    `
      UPDATE concepts
      SET normalized_name = ?,
          name = ?,
          type = NULLIF(?, ''),
          summary = NULLIF(?, ''),
          explanation = NULLIF(?, ''),
          updated_at = ?
      WHERE id = ?
    `,
  ).run(
    normalizedName,
    cleanName,
    String(type || "").trim(),
    String(summary || "").trim(),
    String(explanation || "").trim(),
    Date.now(),
    id,
  );
  getGraphDatabase().prepare("DELETE FROM concept_embeddings WHERE concept_id = ?").run(id);
  insertConceptAliases(id, [cleanName], Date.now());
}

function addConceptMentionToDocument({ conceptId, concept, contribution, documentHash, documentPath, excerptMarkdown, mentionType, sectionTitle }) {
  const db = getGraphDatabase();
  const now = Date.now();
  const cleanExcerpt = String(excerptMarkdown || "").trim();
  if (!cleanExcerpt) {
    throw new Error("Cannot attach an empty note excerpt to a concept.");
  }

  let targetConceptId = Number(conceptId);

  db.exec("BEGIN IMMEDIATE");
  try {
    if (!Number.isFinite(targetConceptId) || !getConceptById(targetConceptId)) {
      targetConceptId = upsertConcept(
        {
          confidence: 1,
          explanation: concept?.explanation,
          name: concept?.name,
          summary: concept?.summary,
          type: concept?.type,
        },
        now,
      );
    }

    if (!targetConceptId) {
      throw new Error("Choose an existing concept or provide a new concept name.");
    }

    insertConceptMention(
      targetConceptId,
      documentPath,
      documentHash || hashContent(cleanExcerpt),
      {
        confidence: 1,
        contribution,
        excerptMarkdown: cleanExcerpt,
        mentionType: mentionType || "application",
        sectionTitle,
      },
      now,
    );
    db.prepare("DELETE FROM concept_embeddings WHERE concept_id = ?").run(targetConceptId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return getDocumentGraph(documentPath);
}

function deleteConceptFromDocument(documentPath, conceptId) {
  const id = Number(conceptId);
  if (!Number.isFinite(id) || !getConceptById(id)) {
    throw new Error("Concept not found.");
  }

  const db = getGraphDatabase();
  const elapsed = startTimer();
  graphLog("db.delete_concept_from_document.start", {
    conceptId: id,
    documentPath,
  });

  db.exec("BEGIN IMMEDIATE");
  try {
    const removedRelationEvidence = db
      .prepare(
        `
          DELETE FROM relation_evidence
          WHERE document_path = ?
            AND relation_id IN (
              SELECT id
              FROM concept_relations
              WHERE from_concept_id = ? OR to_concept_id = ?
            )
        `,
      )
      .run(documentPath, id, id).changes;
    const removedConceptMentions = db
      .prepare("DELETE FROM concept_mentions WHERE document_path = ? AND concept_id = ?")
      .run(documentPath, id).changes;

    pruneGraphOrphans(db);
    db.exec("COMMIT");

    graphLog("db.delete_concept_from_document.done", {
      conceptId: id,
      documentPath,
      durationMs: elapsed(),
      removedConceptMentions,
      removedRelationEvidence,
    });
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return getDocumentGraph(documentPath);
}

function updateRelation({ explanation, relation, relationId }) {
  const id = Number(relationId);
  const cleanRelation = String(relation || "").trim();
  if (!Number.isFinite(id)) {
    throw new Error("Relation not found.");
  }
  if (!cleanRelation) {
    throw new Error("Relation label cannot be empty.");
  }

  const existingRelation = getGraphDatabase().prepare("SELECT id FROM concept_relations WHERE id = ?").get(id);
  if (!existingRelation) {
    throw new Error("Relation not found.");
  }

  getGraphDatabase().prepare(
    `
      UPDATE concept_relations
      SET relation = ?,
          normalized_relation = ?,
          explanation = NULLIF(?, ''),
          updated_at = ?
      WHERE id = ?
    `,
  ).run(cleanRelation, normalizeRelationName(cleanRelation) || "related_to", String(explanation || "").trim(), Date.now(), id);
}

function addRelationToDocument({
  documentHash,
  documentPath,
  evidenceMarkdown,
  explanation,
  fromConceptId,
  relation,
  targetConcept,
  toConceptId,
}) {
  const fromId = Number(fromConceptId);
  let toId = Number(toConceptId);
  const cleanRelation = String(relation || "").trim();
  if (!getConceptById(fromId)) {
    throw new Error("Source concept not found.");
  }
  if (!cleanRelation) {
    throw new Error("Relation label cannot be empty.");
  }

  const now = Date.now();

  const db = getGraphDatabase();
  db.exec("BEGIN IMMEDIATE");
  try {
    if (!Number.isFinite(toId) || !getConceptById(toId)) {
      toId = upsertConcept(
        {
          confidence: 1,
          explanation: targetConcept?.explanation,
          name: targetConcept?.name,
          summary: targetConcept?.summary,
          type: targetConcept?.type,
        },
        now,
      );
    }

    if (!toId) {
      throw new Error("Choose an existing target concept or provide a new concept name.");
    }
    if (fromId === toId) {
      throw new Error("Choose two different concepts.");
    }

    const relationId = upsertRelation(
      fromId,
      toId,
      {
        confidence: 1,
        explanation,
        relation: cleanRelation,
        source: "manual",
      },
      now,
    );

    const cleanEvidence = String(evidenceMarkdown || "").trim();
    if (cleanEvidence) {
      insertRelationEvidence(
        relationId,
        documentPath,
        documentHash || hashContent(cleanEvidence),
        {
          confidence: 1,
          excerptMarkdown: cleanEvidence,
        },
        now,
      );
    }

    db.prepare("DELETE FROM concept_embeddings WHERE concept_id IN (?, ?)").run(fromId, toId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return getDocumentGraph(documentPath);
}

function deleteDocumentGraph(documentPath) {
  graphLog("db.delete_graph.start", { documentPath });
  const elapsed = startTimer();
  getGraphDatabase().exec("BEGIN IMMEDIATE");
  try {
    deleteDocumentGraphRows(documentPath);
    getGraphDatabase().exec("COMMIT");
    graphLog("db.delete_graph.done", {
      documentPath,
      durationMs: elapsed(),
    });
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
    pruneGraphOrphans(db);
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
  deleteConceptFromDocument,
  deleteDocumentGraph,
  deleteDocumentGraphTree,
  getDocumentGraph,
  getExtractionRun,
  findConceptResolutionCandidates,
  getConceptProfiles,
  hashContent,
  addConceptMentionToDocument,
  addRelationToDocument,
  normalizeConceptName,
  replaceDocumentGraphPath,
  saveConceptEmbedding,
  saveExtractedDocumentGraph,
  saveResolvedDocumentGraph,
  searchConcepts,
  updateConcept,
  updateRelation,
};
