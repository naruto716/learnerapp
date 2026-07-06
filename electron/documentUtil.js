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
const orderFileName = ".documents-order.json";
const imageFolderName = "images";
const allowedImageExtensions = new Set([".avif", ".gif", ".jpeg", ".jpg", ".png", ".svg", ".webp"]);

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

function getParentPath(relativePath) {
  return path.dirname(relativePath).replace(/\\/g, "/").replace(/^\.$/, "");
}

function getBaseName(relativePath) {
  return path.basename(relativePath);
}

function isReservedImagePath(relativePath) {
  const cleanPath = String(relativePath || "").replace(/^\/+/g, "").replace(/\/+$/g, "");
  return cleanPath === imageFolderName || cleanPath.startsWith(`${imageFolderName}/`);
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
    if (entry.name === orderFileName) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);

    if (dir === rootDir && entry.isDirectory() && entry.name === imageFolderName) {
      continue;
    }

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

  return sortAndNormalizeNodes(dir, nodes);
}

async function readOrder(folderFullPath) {
  try {
    const content = await fs.readFile(path.join(folderFullPath, orderFileName), "utf8");
    const parsed = JSON.parse(content);
    return Array.isArray(parsed.children) ? parsed.children.filter((name) => typeof name === "string") : [];
  } catch {
    return [];
  }
}

async function writeOrder(folderFullPath, children) {
  await fs.writeFile(
    path.join(folderFullPath, orderFileName),
    `${JSON.stringify({ children }, null, 2)}\n`,
    "utf8",
  );
}

async function sortAndNormalizeNodes(folderFullPath, nodes) {
  const existingNames = nodes.map((node) => node.name);
  const order = await readOrder(folderFullPath);
  const normalizedOrder = [
    ...order.filter((name) => existingNames.includes(name)),
    ...existingNames.filter((name) => !order.includes(name)),
  ];
  const orderIndex = new Map(normalizedOrder.map((name, index) => [name, index]));

  await writeOrder(folderFullPath, normalizedOrder);

  return nodes.sort((a, b) => (orderIndex.get(a.name) ?? 0) - (orderIndex.get(b.name) ?? 0));
}

async function appendToFolderOrder(folderFullPath, childName) {
  const order = await readOrder(folderFullPath);
  await writeOrder(folderFullPath, [...order.filter((name) => name !== childName), childName]);
}

async function removeFromFolderOrder(folderFullPath, childName) {
  const order = await readOrder(folderFullPath);
  await writeOrder(folderFullPath, order.filter((name) => name !== childName));
}

async function renameInFolderOrder(folderFullPath, oldName, newName) {
  const order = await readOrder(folderFullPath);
  const nextOrder = order.map((name) => (name === oldName ? newName : name));
  if (!nextOrder.includes(newName)) {
    nextOrder.push(newName);
  }
  await writeOrder(folderFullPath, nextOrder.filter((name, index, array) => array.indexOf(name) === index));
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

  if (isReservedImagePath(folderPath)) {
    throw new Error("The images folder is reserved for document assets.");
  }

  const fullPath = resolveInsideDocumentRoot(folderPath);

  if (path.dirname(fullPath) === getDocumentRoot() && path.basename(fullPath) === imageFolderName) {
    throw new Error("The images folder is reserved for document assets.");
  }

  await fs.mkdir(fullPath, { recursive: true });
  await appendToFolderOrder(path.dirname(fullPath), path.basename(fullPath));
}

async function createDocumentFile(filePath) {
  await ensureDocumentRoot();
  const finalPath = filePath.toLowerCase().endsWith(".json") ? filePath : `${filePath}.json`;

  if (isReservedImagePath(finalPath)) {
    throw new Error("The images folder is reserved for document assets.");
  }

  const fullPath = resolveInsideDocumentRoot(finalPath, { documentOnly: true });

  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, `${JSON.stringify(emptyDocument, null, 2)}\n`, { flag: "wx" });
  await appendToFolderOrder(path.dirname(fullPath), path.basename(fullPath));
}

async function pathExists(fullPath) {
  try {
    await fs.access(fullPath);
    return true;
  } catch {
    return false;
  }
}

async function moveDocumentEntry(sourcePath, targetFolderPath = "") {
  await ensureDocumentRoot();

  const sourceFullPath = resolveInsideDocumentRoot(sourcePath);
  const sourceStat = await fs.stat(sourceFullPath);

  if (sourceStat.isFile() && path.extname(sourceFullPath).toLowerCase() !== ".json") {
    throw new Error("Only Tiptap document files can be moved.");
  }

  const targetFolderFullPath = targetFolderPath
    ? resolveInsideDocumentRoot(targetFolderPath)
    : getDocumentRoot();
  const targetFolderStat = await fs.stat(targetFolderFullPath);

  if (!targetFolderStat.isDirectory()) {
    throw new Error("Target must be a folder.");
  }

  const destinationFullPath = path.join(targetFolderFullPath, path.basename(sourceFullPath));
  const relativeDestination = path.relative(sourceFullPath, destinationFullPath);

  if (sourceStat.isDirectory() && relativeDestination && !relativeDestination.startsWith("..")) {
    throw new Error("A folder cannot be moved into itself.");
  }

  if (sourceFullPath === destinationFullPath) {
    return;
  }

  if (await pathExists(destinationFullPath)) {
    throw new Error("A file or folder with that name already exists.");
  }

  await fs.rename(sourceFullPath, destinationFullPath);
  await removeFromFolderOrder(path.dirname(sourceFullPath), path.basename(sourceFullPath));
  await appendToFolderOrder(targetFolderFullPath, path.basename(destinationFullPath));
}

async function renameDocumentFile(filePath, newTitle) {
  await ensureDocumentRoot();

  const cleanTitle = String(newTitle || "").trim();
  if (!cleanTitle) {
    throw new Error("Document title is required.");
  }

  if (cleanTitle.includes("/") || cleanTitle.includes("\\")) {
    throw new Error("Document title cannot contain path separators.");
  }

  const sourceFullPath = resolveInsideDocumentRoot(filePath, { documentOnly: true });
  const finalName = cleanTitle.toLowerCase().endsWith(".json") ? cleanTitle : `${cleanTitle}.json`;
  const destinationFullPath = path.join(path.dirname(sourceFullPath), finalName);
  const documentRoot = getDocumentRoot();
  const relativeDestination = path.relative(documentRoot, destinationFullPath);

  if (relativeDestination.startsWith("..") || path.isAbsolute(relativeDestination)) {
    throw new Error("Path must stay inside the documents folder.");
  }

  if (sourceFullPath === destinationFullPath) {
    return toAppPath(documentRoot, destinationFullPath);
  }

  if (await pathExists(destinationFullPath)) {
    throw new Error("A document with that name already exists.");
  }

  await fs.rename(sourceFullPath, destinationFullPath);
  await renameInFolderOrder(path.dirname(sourceFullPath), path.basename(sourceFullPath), path.basename(destinationFullPath));
  return toAppPath(documentRoot, destinationFullPath);
}

async function reorderDocumentEntry({ sourcePath, targetPath, position }) {
  await ensureDocumentRoot();

  if (!["before", "after"].includes(position)) {
    throw new Error("Invalid reorder position.");
  }

  const targetFullPath = resolveInsideDocumentRoot(targetPath);
  const sourceParentPath = getParentPath(sourcePath);
  const targetParentPath = getParentPath(targetPath);

  if (sourcePath === targetPath) {
    return;
  }

  if (sourceParentPath !== targetParentPath) {
    await moveDocumentEntry(sourcePath, targetParentPath);
  }

  const folderFullPath = path.dirname(targetFullPath);
  const sourceName = getBaseName(sourcePath);
  const targetName = getBaseName(targetPath);
  const entries = await fs.readdir(folderFullPath, { withFileTypes: true });
  const existingNames = entries
    .map((entry) => entry.name)
    .filter((name) => name !== orderFileName);
  const order = await readOrder(folderFullPath);
  const normalizedOrder = [
    ...order.filter((name) => existingNames.includes(name)),
    ...existingNames.filter((name) => !order.includes(name)),
  ].filter((name) => name !== sourceName);

  const targetIndex = normalizedOrder.indexOf(targetName);
  const insertIndex = targetIndex === -1 ? normalizedOrder.length : targetIndex + (position === "after" ? 1 : 0);
  normalizedOrder.splice(insertIndex, 0, sourceName);

  await writeOrder(folderFullPath, normalizedOrder);
}

function cleanImageFileName(fileName) {
  const extension = path.extname(fileName).toLowerCase();
  const baseName = path.basename(fileName, path.extname(fileName));
  const cleanBaseName = baseName
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${cleanBaseName || "image"}${extension}`;
}

async function writeImageFile(fileName, data) {
  await ensureDocumentRoot();

  const extension = path.extname(fileName).toLowerCase();

  if (!allowedImageExtensions.has(extension)) {
    throw new Error("Unsupported image type.");
  }

  const imageFolderPath = path.join(getDocumentRoot(), imageFolderName);
  await fs.mkdir(imageFolderPath, { recursive: true });

  const cleanName = cleanImageFileName(path.basename(fileName));
  const baseName = path.basename(cleanName, extension);
  let destinationName = cleanName;
  let destinationPath = path.join(imageFolderPath, destinationName);
  let index = 1;

  while (await pathExists(destinationPath)) {
    destinationName = `${baseName}-${index}${extension}`;
    destinationPath = path.join(imageFolderPath, destinationName);
    index += 1;
  }

  await fs.writeFile(destinationPath, data);

  return `${imageFolderName}/${destinationName}`;
}

async function saveDocumentImage(fileName, data) {
  return writeImageFile(fileName, Buffer.from(data));
}

function resolveDocumentAssetPath(relativePath) {
  const cleanPath = String(relativePath || "").replace(/^\/+/g, "");

  if (!cleanPath.startsWith(`${imageFolderName}/`)) {
    throw new Error("Only document images can be loaded.");
  }

  const fullPath = resolveInsideDocumentRoot(cleanPath);
  const extension = path.extname(fullPath).toLowerCase();

  if (!allowedImageExtensions.has(extension)) {
    throw new Error("Unsupported image type.");
  }

  return fullPath;
}

module.exports = {
  getDocumentRoot,
  listDocumentTree,
  readDocumentFile,
  resolveDocumentAssetPath,
  saveDocumentImage,
  saveDocumentFile,
  createDocumentFolder,
  createDocumentFile,
  moveDocumentEntry,
  renameDocumentFile,
  reorderDocumentEntry,
};
