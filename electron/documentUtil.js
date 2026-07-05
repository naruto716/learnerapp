const { app } = require("electron");
const fs = require("fs/promises");
const path = require("path");

const emptyDocument = {
  type: "doc",
  content: [
    {
      type: "paragraph",
    },
  ],
};

function getDocumentRoot() {
  return path.join(app.getPath("userData"), "documents");
}

async function ensureDocumentRoot() {
  const documentRoot = getDocumentRoot();
  await fs.mkdir(documentRoot, { recursive: true });
  return documentRoot;
}

function toAppPath(rootDir, fullPath) {
  return path.relative(rootDir, fullPath).split(path.sep).join("/");
}

function resolveInsideDocumentRoot(relativePath, options = {}) {
  const documentRoot = getDocumentRoot();
  const normalizedPath = String(relativePath || "").trim();

  if (!normalizedPath) {
    throw new Error("Path is required.");
  }

  const fullPath = path.resolve(documentRoot, normalizedPath);
  const relativeToRoot = path.relative(documentRoot, fullPath);

  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    throw new Error("Path must stay inside the documents folder.");
  }

  if (options.documentOnly && path.extname(fullPath).toLowerCase() !== ".json") {
    throw new Error("Only Tiptap document files are allowed.");
  }

  return fullPath;
}

async function listDocumentTree(dir = getDocumentRoot(), rootDir = getDocumentRoot()) {
  await ensureDocumentRoot();

  const entries = await fs.readdir(dir, { withFileTypes: true });
  const nodes = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      nodes.push({
        name: entry.name,
        path: toAppPath(rootDir, fullPath),
        type: "folder",
        children: await listDocumentTree(fullPath, rootDir),
      });
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) {
      nodes.push({
        name: entry.name,
        path: toAppPath(rootDir, fullPath),
        type: "file",
      });
    }
  }

  return nodes.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === "folder" ? -1 : 1;
    }

    return a.name.localeCompare(b.name);
  });
}

async function readDocumentFile(filePath) {
  await ensureDocumentRoot();
  const content = await fs.readFile(resolveInsideDocumentRoot(filePath, { documentOnly: true }), "utf8");
  return JSON.parse(content);
}

async function saveDocumentFile(filePath, document) {
  await ensureDocumentRoot();
  const fullPath = resolveInsideDocumentRoot(filePath, { documentOnly: true });
  await fs.writeFile(fullPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
}

async function createDocumentFolder(folderPath) {
  await ensureDocumentRoot();
  const fullPath = resolveInsideDocumentRoot(folderPath);
  await fs.mkdir(fullPath, { recursive: true });
}

async function createDocumentFile(filePath) {
  await ensureDocumentRoot();
  const finalPath = filePath.toLowerCase().endsWith(".json") ? filePath : `${filePath}.json`;
  const fullPath = resolveInsideDocumentRoot(finalPath, { documentOnly: true });

  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, `${JSON.stringify(emptyDocument, null, 2)}\n`, { flag: "wx" });
}

module.exports = {
  getDocumentRoot,
  listDocumentTree,
  readDocumentFile,
  saveDocumentFile,
  createDocumentFolder,
  createDocumentFile,
};
