const { app } = require("electron");
const crypto = require("crypto");
const fsSync = require("fs");
const fs = require("fs/promises");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const databaseFileName = "learner.sqlite";
let database = null;

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
  `);

  return database;
}

function titleFromPath(documentPath) {
  return path.basename(documentPath).replace(/\.json$/i, "");
}

function hashContent(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
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
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function deleteIndexedDocument(documentPath) {
  const db = getSearchDatabase();
  const normalizedPath = String(documentPath || "").replace(/\\/g, "/");

  db.prepare("DELETE FROM documents WHERE path = ?").run(normalizedPath);
  db.prepare("DELETE FROM document_fts WHERE path = ?").run(normalizedPath);
}

function deleteIndexedDocumentTree(folderPath) {
  const db = getSearchDatabase();
  const normalizedPath = String(folderPath || "").replace(/\\/g, "/").replace(/\/+$/g, "");
  const prefix = `${normalizedPath}/%`;

  db.prepare("DELETE FROM documents WHERE path LIKE ?").run(prefix);
  db.prepare("DELETE FROM document_fts WHERE path LIKE ?").run(prefix);
}

async function rebuildDocumentSearchIndex(documentRoot) {
  const db = getSearchDatabase();

  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec("DELETE FROM documents");
    db.exec("DELETE FROM document_fts");
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

      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".json")) {
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
  rebuildDocumentSearchIndex,
  searchIndexedDocuments,
  upsertIndexedDocument,
};
