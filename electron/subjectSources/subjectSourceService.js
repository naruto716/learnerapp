const { app } = require("electron");
const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const { readDocumentFile, resolveInsideDocumentRoot } = require("../documentUtil");
const { fetchPublicSource, normalizeText, parseSourceFile, tiptapToText } = require("./sourceParsing");
const { addSubjectSource, normalizeSubjectPath } = require("./sourceStore");

async function assertSubjectFolder(subjectPath) {
  const normalized = normalizeSubjectPath(subjectPath);
  const fullPath = resolveInsideDocumentRoot(normalized);
  const stat = await require("fs/promises").stat(fullPath);
  if (!stat.isDirectory()) throw new Error("subjectPath must identify an existing subject folder.");
  return normalized;
}

async function addSubjectTextSource(request) {
  const subjectPath = await assertSubjectFolder(request?.subjectPath);
  const content = normalizeText(request?.text ?? request?.content);
  return addSubjectSource({
    content,
    kind: "text",
    subjectPath,
    title: String(request?.title || "Pasted text").trim(),
  });
}

async function addSubjectUrlSource(request) {
  const subjectPath = await assertSubjectFolder(request?.subjectPath);
  const fetched = await fetchPublicSource(request?.url);
  return addSubjectSource({
    content: fetched.text,
    kind: "url",
    mediaType: fetched.contentType,
    subjectPath,
    title: String(request?.title || new URL(fetched.finalUrl).hostname).trim(),
    url: fetched.finalUrl,
  });
}

async function addSubjectNoteSource(request) {
  const subjectPath = await assertSubjectFolder(request?.subjectPath);
  const notePath = String(request?.notePath || request?.documentPath || "").trim().replace(/\\/g, "/");
  const document = await readDocumentFile(notePath);
  return addSubjectSource({
    content: tiptapToText(document),
    kind: "note",
    notePath,
    subjectPath,
    title: String(request?.title || path.basename(notePath, ".json")).trim(),
  });
}

async function importSubjectFiles(subjectPath, filePaths) {
  const normalizedPath = await assertSubjectFolder(subjectPath);
  const imported = [];
  for (const filePath of filePaths) {
    const parsed = await parseSourceFile(filePath);
    const id = crypto.randomUUID();
    const archiveRoot = path.join(app.getPath("userData"), "subject-sources");
    await fs.mkdir(archiveRoot, { recursive: true });
    const archivedPath = path.join(archiveRoot, `${id}${path.extname(filePath).toLowerCase()}`);
    await fs.copyFile(filePath, archivedPath);
    try {
      imported.push(addSubjectSource({
        content: parsed.text,
        fileName: path.basename(filePath),
        id,
        kind: "file",
        mediaType: parsed.extension,
        originalPath: archivedPath,
        subjectPath: normalizedPath,
        title: path.basename(filePath, path.extname(filePath)),
      }));
    } catch (error) {
      await fs.rm(archivedPath, { force: true });
      throw error;
    }
  }
  return imported;
}

module.exports = {
  addSubjectNoteSource,
  addSubjectTextSource,
  addSubjectUrlSource,
  assertSubjectFolder,
  importSubjectFiles,
};
