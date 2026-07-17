const { app } = require("electron");
const crypto = require("crypto");
const fsSync = require("fs");
const fs = require("fs/promises");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { embedTexts } = require("./aiClient");
const { getEmbeddingSettings } = require("./aiSettings");
const { operationLog } = require("./operationLog");

const databaseFileName = "learner.sqlite";
const orderFileName = ".documents-order.json";
const embeddingBatchSize = 64;
const maxChunkCharacters = 2800;
const chunkOverlapCharacters = 250;
let database = null;
let embeddingWorkerRunning = false;
let lastEmbeddingError = null;
let missingEmbeddingKeyWarned = false;
const embeddingQueue = new Set();

function getSearchDatabasePath() {
  return path.join(app.getPath("userData"), databaseFileName);
}

function getSearchDatabase() {
  if (database) return database;

  const databasePath = getSearchDatabasePath();
  fsSync.mkdirSync(path.dirname(databasePath), { recursive: true });

  database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS documents (
      path TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      text TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      content_hash TEXT NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS document_fts USING fts5(
      path UNINDEXED,
      title,
      text,
      tokenize='unicode61'
    );

    CREATE TABLE IF NOT EXISTS document_chunks (
      id INTEGER PRIMARY KEY,
      path TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      text TEXT NOT NULL,
      char_count INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      chunk_hash TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(path, chunk_index)
    );

    CREATE INDEX IF NOT EXISTS document_chunks_path_index
      ON document_chunks(path);

    CREATE INDEX IF NOT EXISTS document_chunks_hash_index
      ON document_chunks(chunk_hash);

    CREATE TABLE IF NOT EXISTS chunk_embeddings (
      chunk_hash TEXT NOT NULL,
      model TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      embedding BLOB NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(chunk_hash, model)
    );
  `);

  return database;
}

function titleFromPath(documentPath) {
  return path.basename(documentPath).replace(/\.json$/i, "");
}

function hashContent(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function hashChunk(text) {
  return hashContent(String(text || "").trim());
}

function appendText(parts, value) {
  const text = String(value || "").trim();
  if (text) parts.push(text);
}

function appendBreak(parts) {
  if (parts.length > 0 && parts[parts.length - 1] !== "\n") {
    parts.push("\n");
  }
}

function extractTextFromNode(node, parts) {
  if (!node || typeof node !== "object") return;

  if (node.type === "text") {
    appendText(parts, node.text);
    return;
  }

  if (node.type === "hardBreak") {
    appendBreak(parts);
    return;
  }

  if (node.attrs?.latex) {
    appendText(parts, node.attrs.latex);
  }

  if (node.attrs?.alt) {
    appendText(parts, node.attrs.alt);
  }

  if (node.attrs?.title) {
    appendText(parts, node.attrs.title);
  }

  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      extractTextFromNode(child, parts);
    }
  }

  if (
    [
      "blockquote",
      "bulletList",
      "codeBlock",
      "heading",
      "horizontalRule",
      "listItem",
      "orderedList",
      "paragraph",
    ].includes(node.type)
  ) {
    appendBreak(parts);
  }
}

function extractDocumentText(document) {
  const parts = [];
  extractTextFromNode(document, parts);

  return parts
    .join(" ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitLongChunk(text) {
  const chunks = [];
  let start = 0;

  while (start < text.length) {
    const maxEnd = Math.min(start + maxChunkCharacters, text.length);
    let end = maxEnd;

    if (maxEnd < text.length) {
      const preferredBreakStart = start + Math.floor(maxChunkCharacters * 0.55);
      const slice = text.slice(preferredBreakStart, maxEnd);
      const sentenceBreak = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("? "), slice.lastIndexOf("! "));
      const whitespaceBreak = slice.lastIndexOf(" ");

      if (sentenceBreak >= 0) {
        end = preferredBreakStart + sentenceBreak + 1;
      } else if (whitespaceBreak >= 0) {
        end = preferredBreakStart + whitespaceBreak;
      }
    }

    chunks.push(text.slice(start, end).trim());

    if (end >= text.length) {
      break;
    }

    start = Math.max(end - chunkOverlapCharacters, start + 1);
  }

  return chunks.filter(Boolean);
}

function chunkDocumentText(text) {
  const normalizedText = String(text || "").trim();
  if (!normalizedText) return [];

  const paragraphs = normalizedText
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const chunks = [];
  let currentChunk = "";

  function flushChunk() {
    const trimmedChunk = currentChunk.trim();
    if (trimmedChunk) {
      chunks.push(trimmedChunk);
    }
    currentChunk = "";
  }

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChunkCharacters) {
      flushChunk();
      chunks.push(...splitLongChunk(paragraph));
      continue;
    }

    const candidate = currentChunk ? `${currentChunk}\n\n${paragraph}` : paragraph;
    if (candidate.length > maxChunkCharacters) {
      flushChunk();
      currentChunk = paragraph;
    } else {
      currentChunk = candidate;
    }
  }

  flushChunk();
  return chunks;
}

function upsertDocumentChunks(db, documentPath, text, contentHash, updatedAt) {
  const chunks = chunkDocumentText(text);
  const deleteChunks = db.prepare("DELETE FROM document_chunks WHERE path = ?");
  const insertChunk = db.prepare(`
    INSERT INTO document_chunks(path, chunk_index, text, char_count, content_hash, chunk_hash, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  deleteChunks.run(documentPath);

  chunks.forEach((chunkText, index) => {
    insertChunk.run(
      documentPath,
      index,
      chunkText,
      chunkText.length,
      contentHash,
      hashChunk(chunkText),
      updatedAt,
    );
  });
}

function upsertIndexedDocument(documentPath, document) {
  const db = getSearchDatabase();
  const normalizedPath = String(documentPath || "").replace(/\\/g, "/");
  const title = titleFromPath(normalizedPath);
  const text = extractDocumentText(document);
  const serializedContent = JSON.stringify(document);
  const contentHash = hashContent(serializedContent);
  const updatedAt = Date.now();

  const insertDocument = db.prepare(`
    INSERT INTO documents(path, title, text, updated_at, content_hash)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET
      title = excluded.title,
      text = excluded.text,
      updated_at = excluded.updated_at,
      content_hash = excluded.content_hash
  `);
  const deleteFts = db.prepare("DELETE FROM document_fts WHERE path = ?");
  const insertFts = db.prepare("INSERT INTO document_fts(path, title, text) VALUES (?, ?, ?)");

  db.exec("BEGIN IMMEDIATE");
  try {
    insertDocument.run(normalizedPath, title, text, updatedAt, contentHash);
    deleteFts.run(normalizedPath);
    insertFts.run(normalizedPath, title, text);
    upsertDocumentChunks(db, normalizedPath, text, contentHash, updatedAt);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  queueDocumentEmbedding(normalizedPath);
}

function deleteIndexedDocument(documentPath) {
  const db = getSearchDatabase();
  const normalizedPath = String(documentPath || "").replace(/\\/g, "/");

  db.prepare("DELETE FROM documents WHERE path = ?").run(normalizedPath);
  db.prepare("DELETE FROM document_fts WHERE path = ?").run(normalizedPath);
  db.prepare("DELETE FROM document_chunks WHERE path = ?").run(normalizedPath);
}

function deleteIndexedDocumentTree(folderPath) {
  const db = getSearchDatabase();
  const normalizedPath = String(folderPath || "").replace(/\\/g, "/").replace(/\/+$/g, "");
  const prefix = `${normalizedPath}/%`;

  db.prepare("DELETE FROM documents WHERE path LIKE ?").run(prefix);
  db.prepare("DELETE FROM document_fts WHERE path LIKE ?").run(prefix);
  db.prepare("DELETE FROM document_chunks WHERE path LIKE ?").run(prefix);
}

async function rebuildDocumentSearchIndex(documentRoot) {
  const db = getSearchDatabase();

  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec("DELETE FROM documents");
    db.exec("DELETE FROM document_fts");
    db.exec("DELETE FROM document_chunks");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  async function walk(dir) {
    let entries;

    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      if (entry.name === orderFileName || !entry.isFile() || !entry.name.toLowerCase().endsWith(".json")) {
        continue;
      }

      try {
        const content = await fs.readFile(fullPath, "utf8");
        const relativePath = path.relative(documentRoot, fullPath).split(path.sep).join("/");
        upsertIndexedDocument(relativePath, JSON.parse(content));
      } catch (error) {
        console.warn(`Failed to index ${fullPath}:`, error);
      }
    }
  }

  await walk(documentRoot);
  queueMissingDocumentEmbeddings();
}

function buildFtsQuery(query) {
  const normalizedQuery = String(query || "").trim().replace(/\s+/g, " ");
  if (!normalizedQuery) return "";

  const tokens = normalizedQuery.match(/[\p{L}\p{N}_]+/gu) ?? [];
  return tokens.map((token) => `"${token.replace(/"/g, '""')}"*`).join(" ");
}

function searchIndexedDocuments(query, limit = 20) {
  const ftsQuery = buildFtsQuery(query);
  if (!ftsQuery) return [];

  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const statement = getSearchDatabase().prepare(`
    SELECT
      path,
      title,
      snippet(document_fts, 2, '<mark>', '</mark>', '…', 24) AS snippet,
      bm25(document_fts) AS rank
    FROM document_fts
    WHERE document_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `);

  try {
    return statement.all(ftsQuery, safeLimit).map((result) => ({
      path: result.path,
      title: result.title,
      snippet: result.snippet,
      rank: result.rank,
    }));
  } catch {
    return [];
  }
}

function getEmbeddingConfig(settings) {
  const embeddingSettings = getEmbeddingSettings(settings);
  return {
    ...embeddingSettings,
    configured: Boolean(embeddingSettings.apiKey),
  };
}

function queueDocumentEmbedding(documentPath) {
  const normalizedPath = String(documentPath || "").replace(/\\/g, "/");
  if (!normalizedPath) return;

  embeddingQueue.add(normalizedPath);
  setTimeout(() => {
    void processEmbeddingQueue();
  }, 0);
}

function queueMissingDocumentEmbeddings() {
  const { model } = getEmbeddingConfig();
  const rows = getSearchDatabase()
    .prepare(
      `
        SELECT DISTINCT c.path
        FROM document_chunks c
        LEFT JOIN chunk_embeddings e
          ON e.chunk_hash = c.chunk_hash
          AND e.model = ?
        WHERE e.chunk_hash IS NULL
      `,
    )
    .all(model);

  rows.forEach((row) => queueDocumentEmbedding(row.path));
}

function queueAllDocumentEmbeddings() {
  const rows = getSearchDatabase().prepare("SELECT DISTINCT path FROM document_chunks").all();
  rows.forEach((row) => queueDocumentEmbedding(row.path));
}

function getPendingEmbeddingChunks(documentPath, settings) {
  const { model } = getEmbeddingConfig(settings);
  return getSearchDatabase()
    .prepare(
      `
        SELECT c.chunk_hash, c.text
        FROM document_chunks c
        LEFT JOIN chunk_embeddings e
          ON e.chunk_hash = c.chunk_hash
          AND e.model = ?
        WHERE c.path = ?
          AND e.chunk_hash IS NULL
        GROUP BY c.chunk_hash
        ORDER BY MIN(c.chunk_index)
        LIMIT ?
      `,
    )
    .all(model, documentPath, embeddingBatchSize);
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

async function requestEmbeddings(input, settings) {
  const config = getEmbeddingConfig(settings);
  const apiKey = config.apiKey;
  if (!apiKey) {
    throw new Error("AI API key is not configured in settings.");
  }

  const { embeddings } = await embedTexts(input, {
    model: config.model,
    settings,
    timeoutMs: 45_000,
  });
  return embeddings;
}

function saveChunkEmbeddings(chunks, embeddings, settings) {
  const db = getSearchDatabase();
  const { model } = getEmbeddingConfig(settings);
  const insertEmbedding = db.prepare(`
    INSERT INTO chunk_embeddings(chunk_hash, model, dimensions, embedding, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(chunk_hash, model) DO UPDATE SET
      dimensions = excluded.dimensions,
      embedding = excluded.embedding,
      updated_at = excluded.updated_at
  `);
  const updatedAt = Date.now();

  db.exec("BEGIN IMMEDIATE");
  try {
    chunks.forEach((chunk, index) => {
      const embedding = embeddings[index];
      if (!Array.isArray(embedding) || embedding.length === 0) return;
      insertEmbedding.run(chunk.chunk_hash, model, embedding.length, vectorToBuffer(embedding), updatedAt);
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

async function embedMissingChunksForDocument(documentPath, settings) {
  while (true) {
    const chunks = getPendingEmbeddingChunks(documentPath, settings);
    if (chunks.length === 0) return;

    const embeddings = await requestEmbeddings(chunks.map((chunk) => chunk.text), settings);
    saveChunkEmbeddings(chunks, embeddings, settings);
  }
}

async function processEmbeddingQueue(settings) {
  if (embeddingWorkerRunning) return;

  const apiKey = getEmbeddingConfig(settings).apiKey;
  if (!apiKey) {
    lastEmbeddingError = "AI API key is not configured in settings.";
    if (!missingEmbeddingKeyWarned && embeddingQueue.size > 0) {
      console.warn("Document embeddings skipped: AI API key is not configured in settings.");
      missingEmbeddingKeyWarned = true;
    }
    embeddingQueue.clear();
    return;
  }

  embeddingWorkerRunning = true;
  lastEmbeddingError = null;

  try {
    while (embeddingQueue.size > 0) {
      const [documentPath] = embeddingQueue;
      embeddingQueue.delete(documentPath);
      await embedMissingChunksForDocument(documentPath, settings);
    }
  } catch (error) {
    lastEmbeddingError = error instanceof Error ? error.message : "Document embedding failed.";
    console.warn("Document embedding failed:", error);
  } finally {
    embeddingWorkerRunning = false;
  }
}

function getDocumentEmbeddingStatus(settings) {
  const db = getSearchDatabase();
  const config = getEmbeddingConfig(settings);
  const chunks = db.prepare("SELECT COUNT(*) AS count FROM document_chunks").get().count;
  const embeddedChunks = db
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM document_chunks c
        INNER JOIN chunk_embeddings e
          ON e.chunk_hash = c.chunk_hash
          AND e.model = ?
      `,
    )
    .get(config.model).count;

  return {
    configured: config.configured,
    model: config.model,
    chunks,
    embeddedChunks,
    lastError: lastEmbeddingError,
    queuedDocuments: embeddingQueue.size,
    running: embeddingWorkerRunning,
  };
}

function rebuildDocumentEmbeddings(settings) {
  const { model } = getEmbeddingConfig(settings);
  getSearchDatabase().prepare("DELETE FROM chunk_embeddings WHERE model = ?").run(model);
  queueAllDocumentEmbeddings();
  return getDocumentEmbeddingStatus(settings);
}

async function semanticSearchIndexedDocuments(query, limit = 10, settings, diagnostics = {}) {
  const normalizedQuery = String(query || "").trim();
  if (!normalizedQuery) return [];

  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 30);
  const config = getEmbeddingConfig(settings);
  const requestId = typeof diagnostics.requestId === "string" ? diagnostics.requestId : null;
  const startedAt = Date.now();
  let stage = "query_embedding";
  operationLog("document.semantic_search.started", {
    limit: safeLimit,
    model: config.model,
    requestId,
  });

  try {
    const [queryEmbedding] = await requestEmbeddings([normalizedQuery], settings);
    operationLog("document.semantic_search.embedding_completed", {
      dimensions: queryEmbedding.length,
      durationMs: Date.now() - startedAt,
      requestId,
    });

    stage = "database_read";
    const rows = getSearchDatabase()
      .prepare(
        `
          SELECT
            c.path,
            d.title,
            c.chunk_index AS chunkIndex,
            c.text,
            e.embedding
          FROM document_chunks c
          INNER JOIN documents d ON d.path = c.path
          INNER JOIN chunk_embeddings e
            ON e.chunk_hash = c.chunk_hash
            AND e.model = ?
        `,
      )
      .all(config.model);
    operationLog("document.semantic_search.rows_loaded", {
      durationMs: Date.now() - startedAt,
      requestId,
      rowCount: rows.length,
    });

    stage = "ranking";
    const results = rows
      .map((row) => ({
        path: row.path,
        title: row.title,
        chunkIndex: row.chunkIndex,
        text: row.text,
        score: cosineSimilarity(queryEmbedding, bufferToVector(row.embedding)),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, safeLimit);
    operationLog("document.semantic_search.completed", {
      durationMs: Date.now() - startedAt,
      requestId,
      resultCount: results.length,
    });
    return results;
  } catch (error) {
    operationLog("document.semantic_search.failed", {
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      requestId,
      stage,
    });
    throw error;
  }
}

function closeSearchDatabase() {
  if (!database) return;

  database.close();
  database = null;
}

module.exports = {
  closeSearchDatabase,
  deleteIndexedDocument,
  deleteIndexedDocumentTree,
  extractDocumentText,
  getDocumentEmbeddingStatus,
  queueMissingDocumentEmbeddings,
  rebuildDocumentEmbeddings,
  rebuildDocumentSearchIndex,
  searchIndexedDocuments,
  semanticSearchIndexedDocuments,
  upsertIndexedDocument,
};
