const { app } = require("electron");
const fs = require("fs/promises");
const path = require("path");

function getMarkdownRoot() {
  return path.join(app.getPath("userData"), "markdown");
}

async function ensureMarkdownRoot() {
  const markdownRoot = getMarkdownRoot();
  await fs.mkdir(markdownRoot, { recursive: true });
  return markdownRoot;
}

function toAppPath(rootDir, fullPath) {
  return path.relative(rootDir, fullPath).split(path.sep).join("/");
}

function resolveInsideMarkdownRoot(relativePath, options = {}) {
  const markdownRoot = getMarkdownRoot();
  const normalizedPath = String(relativePath || "").trim();

  if (!normalizedPath) {
    throw new Error("Path is required.");
  }

  const fullPath = path.resolve(markdownRoot, normalizedPath);
  const relativeToRoot = path.relative(markdownRoot, fullPath);

  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    throw new Error("Path must stay inside the markdown folder.");
  }

  if (options.markdownOnly && path.extname(fullPath).toLowerCase() !== ".md") {
    throw new Error("Only markdown files are allowed.");
  }

  return fullPath;
}

async function listMarkdownTree(dir = getMarkdownRoot(), rootDir = getMarkdownRoot()) {
  await ensureMarkdownRoot();

  const entries = await fs.readdir(dir, { withFileTypes: true });
  const nodes = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      nodes.push({
        name: entry.name,
        path: toAppPath(rootDir, fullPath),
        type: "folder",
        children: await listMarkdownTree(fullPath, rootDir),
      });
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
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

async function readMarkdownFile(filePath) {
  await ensureMarkdownRoot();
  return fs.readFile(resolveInsideMarkdownRoot(filePath, { markdownOnly: true }), "utf8");
}

async function createMarkdownFolder(folderPath) {
  await ensureMarkdownRoot();
  const fullPath = resolveInsideMarkdownRoot(folderPath);
  await fs.mkdir(fullPath, { recursive: true });
}

async function createMarkdownFile(filePath) {
  await ensureMarkdownRoot();
  const finalPath = filePath.toLowerCase().endsWith(".md") ? filePath : `${filePath}.md`;
  const fullPath = resolveInsideMarkdownRoot(finalPath, { markdownOnly: true });

  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, "", { flag: "wx" });
}

module.exports = {
  getMarkdownRoot,
  listMarkdownTree,
  readMarkdownFile,
  createMarkdownFolder,
  createMarkdownFile,
};
