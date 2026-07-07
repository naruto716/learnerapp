const { app, BrowserWindow, ipcMain, net, protocol, shell } = require("electron");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const {
  createDocumentFile,
  createDocumentFolder,
  deleteDocumentEntry,
  getDocumentRoot,
  listDocumentTree,
  moveDocumentEntry,
  reorderDocumentEntry,
  renameDocumentFile,
  readDocumentFile,
  resolveDocumentAssetPath,
  saveDocumentImage,
  saveDocumentFile,
} = require("./documentUtil");
const { loadLocalEnv } = require("./localEnv");
const {
  closeSearchDatabase,
  deleteIndexedDocument,
  deleteIndexedDocumentTree,
  getDocumentEmbeddingStatus,
  queueMissingDocumentEmbeddings,
  rebuildDocumentEmbeddings,
  rebuildDocumentSearchIndex,
  searchIndexedDocuments,
  semanticSearchIndexedDocuments,
  upsertIndexedDocument,
} = require("./documentSearchIndex");

loadLocalEnv();

const appProtocol = "learner";
const devServerUrl = process.env.NEXT_DEV_SERVER_URL;

protocol.registerSchemesAsPrivileged([
  {
    scheme: appProtocol,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

function resolveStaticFile(requestUrl) {
  const outDir = path.join(__dirname, "..", "out");
  const url = new URL(requestUrl);
  const decodedPath = decodeURIComponent(url.pathname);
  const requestedPath = decodedPath === "/" ? "/index.html" : decodedPath;
  const filePath = path.normalize(path.join(outDir, requestedPath));

  if (!filePath.startsWith(outDir)) {
    return path.join(outDir, "index.html");
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    return filePath;
  }

  const indexPath = path.join(filePath, "index.html");
  if (fs.existsSync(indexPath)) {
    return indexPath;
  }

  const htmlPath = `${filePath}.html`;
  if (fs.existsSync(htmlPath)) {
    return htmlPath;
  }

  return path.join(outDir, "index.html");
}

function resolveDocumentAsset(requestUrl) {
  const url = new URL(requestUrl);
  return resolveDocumentAssetPath(decodeURIComponent(url.pathname).replace(/^\/+/g, ""));
}

function createWindow() {
  const isMac = process.platform === "darwin";
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "Learner",
    ...(isMac ? { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 14, y: 12 } } : { frame: false }),
    backgroundColor: "#1f1f1f",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (devServerUrl) {
    win.loadURL(devServerUrl);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadURL(`${appProtocol}://app/index.html`);
  }
}

function filePathWithExtension(filePath) {
  return String(filePath || "").toLowerCase().endsWith(".json") ? filePath : `${filePath}.json`;
}

function logSearchIndexError(action, error) {
  console.warn(`Search index ${action} failed:`, error);
}

function updateSearchIndex(action, callback) {
  try {
    callback();
  } catch (error) {
    logSearchIndexError(action, error);
  }
}

async function updateSearchIndexAsync(action, callback) {
  try {
    await callback();
  } catch (error) {
    logSearchIndexError(action, error);
  }
}

async function refreshSearchIndex(action) {
  try {
    await rebuildDocumentSearchIndex(getDocumentRoot());
  } catch (error) {
    logSearchIndexError(action, error);
  }
}

app.whenReady().then(() => {
  protocol.handle(appProtocol, (request) => {
    const url = new URL(request.url);

    if (url.hostname === "documents") {
      try {
        return net.fetch(pathToFileURL(resolveDocumentAsset(request.url)).toString());
      } catch {
        return new Response("Not found", { status: 404 });
      }
    }

    const filePath = resolveStaticFile(request.url);
    return net.fetch(pathToFileURL(filePath).toString());
  });

  createWindow();
  refreshSearchIndex("rebuild").then(() => {
    queueMissingDocumentEmbeddings();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  closeSearchDatabase();
});

ipcMain.handle("document:list", async () => {
  return {
    directory: getDocumentRoot(),
    tree: await listDocumentTree(),
  };
});

ipcMain.handle("document:read", async (_event, filePath) => {
  return readDocumentFile(filePath);
});

ipcMain.handle("document:save", async (_event, filePath, document) => {
  await saveDocumentFile(filePath, document);
  updateSearchIndex("update", () => upsertIndexedDocument(filePath, document));
});

ipcMain.handle("document:createFolder", async (_event, folderPath) => {
  await createDocumentFolder(folderPath);
  return {
    directory: getDocumentRoot(),
    tree: await listDocumentTree(),
  };
});

ipcMain.handle("document:createFile", async (_event, filePath) => {
  await createDocumentFile(filePath);
  const indexedPath = filePathWithExtension(filePath);
  await updateSearchIndexAsync("create", async () => {
    upsertIndexedDocument(indexedPath, await readDocumentFile(indexedPath));
  });
  return {
    directory: getDocumentRoot(),
    tree: await listDocumentTree(),
  };
});

ipcMain.handle("document:move", async (_event, sourcePath, targetFolderPath) => {
  await moveDocumentEntry(sourcePath, targetFolderPath);
  await refreshSearchIndex("rebuild after move");
  return {
    directory: getDocumentRoot(),
    tree: await listDocumentTree(),
  };
});

ipcMain.handle("document:delete", async (_event, entryPath) => {
  const isDocumentFile = String(entryPath || "").toLowerCase().endsWith(".json");
  await deleteDocumentEntry(entryPath);
  if (isDocumentFile) {
    updateSearchIndex("delete", () => deleteIndexedDocument(entryPath));
  } else {
    updateSearchIndex("delete tree", () => deleteIndexedDocumentTree(entryPath));
  }
  return {
    directory: getDocumentRoot(),
    tree: await listDocumentTree(),
  };
});

ipcMain.handle("document:rename", async (_event, filePath, newTitle) => {
  const newPath = await renameDocumentFile(filePath, newTitle);
  await updateSearchIndexAsync("rename", async () => {
    deleteIndexedDocument(filePath);
    upsertIndexedDocument(newPath, await readDocumentFile(newPath));
  });
  return {
    directory: getDocumentRoot(),
    newPath,
    tree: await listDocumentTree(),
  };
});

ipcMain.handle("document:reorder", async (_event, reorderRequest) => {
  await reorderDocumentEntry(reorderRequest);
  return {
    directory: getDocumentRoot(),
    tree: await listDocumentTree(),
  };
});

ipcMain.handle("document:saveImage", async (_event, fileName, data) => {
  return saveDocumentImage(fileName, data);
});

ipcMain.handle("document:search", async (_event, query, limit) => {
  return searchIndexedDocuments(query, limit);
});

ipcMain.handle("document:rebuildSearchIndex", async () => {
  await rebuildDocumentSearchIndex(getDocumentRoot());
});

ipcMain.handle("document:embeddingStatus", async () => {
  return getDocumentEmbeddingStatus();
});

ipcMain.handle("document:rebuildEmbeddings", async () => {
  return rebuildDocumentEmbeddings();
});

ipcMain.handle("document:semanticSearch", async (_event, query, limit) => {
  return semanticSearchIndexedDocuments(query, limit);
});
