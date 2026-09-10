const { app } = require("electron");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

let database = null;

function normalizeSubjectPath(value) {
  const normalized = String(value || "").trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!normalized || normalized.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("A valid subjectPath is required.");
  }
  return normalized;
}

function getDatabase() {
  if (database) return database;
  const databasePath = path.join(app.getPath("userData"), "learner.sqlite");
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS subject_sources (
      id TEXT PRIMARY KEY,
      subject_path TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('text', 'url', 'note', 'file')),
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      url TEXT,
      note_path TEXT,
      original_path TEXT,
      file_name TEXT,
      media_type TEXT,
      content_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS subject_sources_subject_path_index ON subject_sources(subject_path);
    CREATE INDEX IF NOT EXISTS subject_sources_note_path_index ON subject_sources(note_path);
  `);
  return database;
}

function publicSource(row) {
  return {
    content: row.content,
    contentHash: row.content_hash,
    createdAt: row.created_at,
    fileName: row.file_name,
    id: row.id,
    kind: row.kind,
    mediaType: row.media_type,
    notePath: row.note_path,
    originalPath: row.original_path,
    subjectPath: row.subject_path,
    title: row.title,
    updatedAt: row.updated_at,
    url: row.url,
  };
}

function listSubjectSources(subjectPath) {
  return getDatabase()
    .prepare("SELECT * FROM subject_sources WHERE subject_path = ? ORDER BY created_at, id")
    .all(normalizeSubjectPath(subjectPath))
    .map(publicSource);
}

function addSubjectSource(source) {
  const subjectPath = normalizeSubjectPath(source.subjectPath);
  const content = String(source.content || "").trim();
  const title = String(source.title || "").trim();
  if (!content) throw new Error("Source content is required.");
  if (!title) throw new Error("Source title is required.");
  const now = Date.now();
  const id = source.id || crypto.randomUUID();
  getDatabase().prepare(`
    INSERT INTO subject_sources (
      id, subject_path, kind, title, content, url, note_path, original_path,
      file_name, media_type, content_hash, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, subjectPath, source.kind, title, content, source.url || null, source.notePath || null,
    source.originalPath || null, source.fileName || null, source.mediaType || null,
    crypto.createHash("sha256").update(content).digest("hex"), now, now,
  );
  return publicSource(getDatabase().prepare("SELECT * FROM subject_sources WHERE id = ?").get(id));
}

function getSelectedSources(subjectPath, sourceIds) {
  const selectedIds = [...new Set((Array.isArray(sourceIds) ? sourceIds : []).map(String))];
  if (!selectedIds.length) throw new Error("At least one subject source must be selected.");
  const available = new Map(listSubjectSources(subjectPath).map((source) => [source.id, source]));
  const selected = selectedIds.map((id) => available.get(id));
  if (selected.some((source) => !source)) throw new Error("One or more selected sources do not belong to this subject.");
  return selected;
}

function removeSubjectSource(subjectPath, sourceId) {
  const normalizedPath = normalizeSubjectPath(subjectPath);
  const normalizedId = String(sourceId || "");
  const source = getDatabase().prepare("SELECT original_path FROM subject_sources WHERE subject_path = ? AND id = ?")
    .get(normalizedPath, normalizedId);
  const result = getDatabase().prepare("DELETE FROM subject_sources WHERE subject_path = ? AND id = ?")
    .run(normalizedPath, normalizedId);
  removeArchivedFile(source?.original_path);
  return result.changes > 0;
}

function removeArchivedFile(filePath) {
  if (!filePath) return;
  const archiveRoot = path.join(app.getPath("userData"), "subject-sources");
  const relativePath = path.relative(archiveRoot, filePath);
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) return;
  try {
    fs.rmSync(filePath, { force: true });
  } catch {
    // Source metadata deletion should not fail because an archived copy is already unavailable.
  }
}

function replaceSubjectSourcePaths(oldPath, newPath) {
  const oldValue = normalizeSubjectPath(oldPath);
  const newValue = normalizeSubjectPath(newPath);
  const prefix = `${oldValue}/`;
  const db = getDatabase();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE subject_sources SET subject_path = ? || SUBSTR(subject_path, ?), updated_at = ? WHERE subject_path = ? OR SUBSTR(subject_path, 1, ?) = ?")
      .run(newValue, oldValue.length + 1, Date.now(), oldValue, prefix.length, prefix);
    db.prepare("UPDATE subject_sources SET note_path = ? || SUBSTR(note_path, ?), updated_at = ? WHERE note_path = ? OR SUBSTR(note_path, 1, ?) = ?")
      .run(newValue, oldValue.length + 1, Date.now(), oldValue, prefix.length, prefix);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function deleteSubjectSourcePaths(deletedPath) {
  const value = normalizeSubjectPath(deletedPath);
  const prefix = `${value}/`;
  const db = getDatabase();
  const archivedFiles = db.prepare("SELECT original_path FROM subject_sources WHERE subject_path = ? OR SUBSTR(subject_path, 1, ?) = ? OR note_path = ? OR SUBSTR(note_path, 1, ?) = ?")
    .all(value, prefix.length, prefix, value, prefix.length, prefix);
  db.prepare("DELETE FROM subject_sources WHERE subject_path = ? OR SUBSTR(subject_path, 1, ?) = ? OR note_path = ? OR SUBSTR(note_path, 1, ?) = ?")
    .run(value, prefix.length, prefix, value, prefix.length, prefix);
  archivedFiles.forEach((source) => removeArchivedFile(source.original_path));
}

function closeSubjectSourceDatabase() {
  if (!database) return;
  database.close();
  database = null;
}

module.exports = {
  addSubjectSource,
  closeSubjectSourceDatabase,
  deleteSubjectSourcePaths,
  getSelectedSources,
  listSubjectSources,
  normalizeSubjectPath,
  removeSubjectSource,
  replaceSubjectSourcePaths,
};
