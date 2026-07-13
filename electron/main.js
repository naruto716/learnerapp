const { app, BrowserWindow, ipcMain, net, protocol, shell } = require("electron");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { loadLocalEnv } = require("./localEnv");
const { operationLog } = require("./operationLog");
const { createKeyedOperationLock } = require("./aiOperationLock");

loadLocalEnv();

const dataProfile = process.env.LEARNER_DATA_PROFILE === "development" ? "development" : "production";
const userDataDirectoryName = dataProfile === "development" ? "learnerapp-dev" : "learnerapp";
app.setPath("userData", path.join(app.getPath("appData"), userDataDirectoryName));

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
const { configureAiSettings } = require("./aiSettings");
const { embedTexts } = require("./aiClient");
const { generateImage, listAiModels } = require("./imageGeneration");
const { transcribeSpeech } = require("./speechToText");
const {
  clearDocumentMastery,
  closeMasteryDatabase,
  getDocumentMastery,
  updateMasteryConceptLevel,
  updateMasteryConceptScore,
} = require("./mastery/masteryConcepts");
const {
  clearDocumentMasteryCards,
  continueMasteryCardDiscussion,
  evaluateMasteryCard,
  getDocumentMasteryCards,
} = require("./mastery/masteryCards");
const {
  createPracticeSession,
  createRevisionSession,
  deletePracticeSession,
  getPracticeSession,
  kickRevisionPreparation,
  listPracticeEvidence,
  listPracticeSessions,
  revisionOverview,
  retryPracticeGrading,
  setPracticeCardOutcome,
  submitPracticeAnswer,
} = require("./mastery/masteryPractice");
const { runMasteryMigrations } = require("./mastery/masteryMigrations");
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
const { searchRelatedConcepts } = require("./graph/graphExtraction");
const {
  closeGraphDatabase,
  addConceptMentionToDocument,
  addRelationToDocument,
  deleteConceptFromDocument,
  deleteDocumentGraph,
  deleteDocumentGraphTree,
  getDocumentGraph,
  replaceDocumentGraphPath,
  searchConcepts,
  updateConcept,
  updateRelation,
} = require("./graph/graphDb");
const {
  createLearnerGenerationManager,
  operationLabels: generationOperationLabels,
  taskTypes: generationTaskTypes,
} = require("./TaskManagementQueue/learnerGenerationManager");

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

function notifyFullScreenChange(win) {
  win.webContents.send("window:fullscreen-change", win.isFullScreen());
}

function notifyMaximizedChange(win) {
  win.webContents.send("window:maximized-change", win.isMaximized());
}

function isTrustedAppOrigin(origin) {
  if (!origin) return false;
  if (origin.startsWith(`${appProtocol}://app`)) return true;
  if (!devServerUrl) return false;

  try {
    return new URL(origin).origin === new URL(devServerUrl).origin;
  } catch {
    return false;
  }
}

function configureMediaPermissions(ses) {
  ses.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    return permission === "media" && isTrustedAppOrigin(requestingOrigin);
  });
  ses.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    const mediaTypes = Array.isArray(details.mediaTypes) ? details.mediaTypes : [];
    const audioOnly = mediaTypes.length > 0 && mediaTypes.every((mediaType) => mediaType === "audio");
    const origin = details.securityOrigin || details.requestingUrl || "";
    callback(permission === "media" && audioOnly && isTrustedAppOrigin(origin));
  });
}

function publicAiOperationStatus(status) {
  if (!status) return null;
  const documentPrefix = "document:";
  return {
    ...status,
    documentPath: status.key.startsWith(documentPrefix) ? status.key.slice(documentPrefix.length) : null,
  };
}

function broadcastAiOperationStatus(status) {
  const publicStatus = publicAiOperationStatus(status);
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send("ai:operationStatus", publicStatus);
  }
}

function publicGenerationTaskStatus(task) {
  if (!task || !generationOperationLabels[task.type]) return null;
  return {
    completedAt: task.completedAt,
    documentPath: task.document,
    error: task.error?.message || null,
    key: task.lockKey,
    operation: generationOperationLabels[task.type],
    progress: task.progress,
    startedAt: task.startedAt ?? task.createdAt,
    state: task.status === "completed"
      ? "completed"
      : task.status === "failed" || task.status === "blocked"
        ? "failed"
        : "running",
    updatedAt: task.updatedAt,
  };
}

function broadcastGenerationTask(task) {
  const status = publicGenerationTaskStatus(task);
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    if (status) window.webContents.send("ai:operationStatus", status);
    if (task.type === generationTaskTypes.metaphor && task.progress) {
      window.webContents.send("mastery:metaphorProgress", task.progress);
    }
    if (task.type === generationTaskTypes.cards && task.progress) {
      window.webContents.send("mastery:cardProgress", task.progress);
    }
  }
}

const aiOperationLock = createKeyedOperationLock(broadcastAiOperationStatus);
const learnerGenerationManager = createLearnerGenerationManager({ onTaskChange: broadcastGenerationTask });

async function runExclusiveAiOperation(key, label, operation) {
  try {
    return await aiOperationLock.run(key, label, async () => {
      const startedAt = Date.now();
      operationLog("ai.operation.started", { key, operation: label });
      try {
        const result = await operation();
        operationLog("ai.operation.completed", { durationMs: Date.now() - startedAt, key, operation: label });
        return result;
      } catch (error) {
        operationLog("ai.operation.failed", {
          durationMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
          key,
          operation: label,
        });
        throw error;
      }
    });
  } catch (error) {
    if (error?.activeOperation) {
      operationLog("ai.operation.rejected", {
        activeOperation: error.activeOperation,
        key,
        requestedOperation: label,
      });
    }
    throw error;
  }
}

ipcMain.handle("window:is-fullscreen", (event) => {
  return BrowserWindow.fromWebContents(event.sender)?.isFullScreen() ?? false;
});

ipcMain.handle("window:minimize", (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize();
});

ipcMain.handle("window:toggle-maximize", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return false;
  if (win.isMaximized()) {
    win.unmaximize();
  } else {
    win.maximize();
  }
  return win.isMaximized();
});

ipcMain.handle("window:close", (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});

function createWindow() {
  const isMac = process.platform === "darwin";
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 600,
    minHeight: 400,
    title: "Learner",
    ...(isMac ? { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 14, y: 12 } } : { frame: false }),
    backgroundColor: "#1f1f1f",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  configureMediaPermissions(win.webContents.session);

  win.on("enter-full-screen", () => notifyFullScreenChange(win));
  win.on("leave-full-screen", () => notifyFullScreenChange(win));
  win.on("maximize", () => notifyMaximizedChange(win));
  win.on("unmaximize", () => notifyMaximizedChange(win));

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
  runMasteryMigrations();
  learnerGenerationManager.start();
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

let generationShutdownPromise = null;
let generationShutdownComplete = false;

app.on("before-quit", (event) => {
  if (generationShutdownComplete) return;
  event.preventDefault();
  if (generationShutdownPromise) return;

  generationShutdownPromise = learnerGenerationManager.stop({ drain: true }).finally(() => {
    closeSearchDatabase();
    closeGraphDatabase();
    closeMasteryDatabase();
    generationShutdownComplete = true;
    app.quit();
  });
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
  replaceDocumentGraphPath(
    sourcePath,
    targetFolderPath
      ? `${String(targetFolderPath).replace(/\/+$/g, "")}/${path.basename(sourcePath)}`
      : path.basename(sourcePath),
  );
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
    deleteDocumentGraph(entryPath);
  } else {
    updateSearchIndex("delete tree", () => deleteIndexedDocumentTree(entryPath));
    deleteDocumentGraphTree(entryPath);
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
  replaceDocumentGraphPath(filePath, newPath);
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

ipcMain.handle("document:embeddingStatus", async (_event, settings) => {
  configureAiSettings(settings);
  return getDocumentEmbeddingStatus(settings);
});

ipcMain.handle("document:rebuildEmbeddings", async (_event, settings) => {
  configureAiSettings(settings);
  return rebuildDocumentEmbeddings(settings);
});

ipcMain.handle("document:semanticSearch", async (_event, query, limit, settings) => {
  return semanticSearchIndexedDocuments(query, limit, settings);
});

ipcMain.handle("ai:configure", async (_event, settings) => {
  return configureAiSettings(settings);
});

ipcMain.handle("ai:listModels", async (_event, settings) => {
  configureAiSettings(settings);
  return listAiModels(settings);
});

ipcMain.handle("ai:testEmbedding", async (_event, settings) => {
  configureAiSettings(settings);
  const { embeddings, model } = await embedTexts(["Learner embedding capability check"], { settings });
  const dimensions = embeddings[0]?.length ?? 0;
  if (dimensions === 0) throw new Error("Embedding provider returned an empty vector.");
  return { dimensions, model };
});

ipcMain.handle("ai:generateImage", async (_event, request) => {
  configureAiSettings(request?.settings);
  return runExclusiveAiOperation("standalone:image", "image generation", () => generateImage(request));
});

ipcMain.handle("speech:transcribe", async (_event, request) => {
  configureAiSettings(request?.settings);
  return transcribeSpeech(request);
});

ipcMain.handle("mastery:getDocumentMastery", async (_event, filePath, markdown, options) => {
  return getDocumentMastery(filePathWithExtension(filePath), markdown, options);
});

ipcMain.handle("mastery:generateDocumentMastery", async (_event, request) => {
  if (!request?.documentPath) {
    throw new Error("Document path is required.");
  }

  const documentPath = filePathWithExtension(request.documentPath);
  configureAiSettings(request?.settings);
  return learnerGenerationManager.generateConcepts({
    ...request,
    documentPath,
  });
});

ipcMain.handle("mastery:generateAssets", async (_event, request) => {
  if (!request?.documentPath) {
    throw new Error("Document path is required.");
  }
  if (!request?.cardRequest) {
    throw new Error("Flashcard generation settings are required.");
  }

  const documentPath = filePathWithExtension(request.documentPath);
  configureAiSettings(request?.settings);
  return learnerGenerationManager.generateMasteryAssets({
    ...request,
    cardRequest: {
      ...request.cardRequest,
      documentPath,
    },
    documentPath,
  });
});

ipcMain.handle("mastery:updateConceptLevel", async (_event, request) => {
  if (!request?.documentPath) {
    throw new Error("Document path is required.");
  }

  return updateMasteryConceptLevel({
    ...request,
    documentPath: filePathWithExtension(request.documentPath),
  });
});

ipcMain.handle("mastery:updateConceptScore", async (_event, request) => {
  if (!request?.documentPath) {
    throw new Error("Document path is required.");
  }

  return updateMasteryConceptScore({
    ...request,
    documentPath: filePathWithExtension(request.documentPath),
  });
});

ipcMain.handle("mastery:generateMetaphor", async (_event, request) => {
  if (!request?.documentPath) {
    throw new Error("Document path is required.");
  }

  const documentPath = filePathWithExtension(request.documentPath);
  configureAiSettings(request?.settings);
  return learnerGenerationManager.generateMetaphor({
    ...request,
    documentPath,
  });
});

ipcMain.handle("mastery:clearDocumentMastery", async (_event, request) => {
  if (!request?.documentPath) {
    throw new Error("Document path is required.");
  }

  return clearDocumentMastery({
    ...request,
    documentPath: filePathWithExtension(request.documentPath),
  });
});

ipcMain.handle("mastery:getCards", async (_event, documentPath) => {
  return getDocumentMasteryCards(filePathWithExtension(documentPath));
});

ipcMain.handle("mastery:getGenerationStatus", async (_event, documentPath) => {
  const normalizedPath = filePathWithExtension(documentPath);
  return publicGenerationTaskStatus(learnerGenerationManager.latestDocumentTask(normalizedPath));
});

ipcMain.handle("mastery:getGenerationStatuses", async (_event, documentPath) => {
  const normalizedPath = filePathWithExtension(documentPath);
  return learnerGenerationManager.latestDocumentTasks(normalizedPath)
    .map(publicGenerationTaskStatus)
    .filter(Boolean);
});

ipcMain.handle("mastery:generateCards", async (_event, request) => {
  if (!request?.documentPath) {
    throw new Error("Document path is required.");
  }

  const documentPath = filePathWithExtension(request.documentPath);
  configureAiSettings(request?.settings);
  return learnerGenerationManager.generateCards({
    ...request,
    documentPath,
  });
});

ipcMain.handle("mastery:continueCardDiscussion", async (_event, request) => {
  if (!request?.documentPath) throw new Error("Document path is required.");
  configureAiSettings(request?.settings);
  return continueMasteryCardDiscussion({
    ...request,
    documentPath: filePathWithExtension(request.documentPath),
  });
});

ipcMain.handle("mastery:evaluateCard", async (_event, request) => {
  if (!request?.documentPath) throw new Error("Document path is required.");
  configureAiSettings(request?.settings);
  return evaluateMasteryCard({
    ...request,
    documentPath: filePathWithExtension(request.documentPath),
  });
});

ipcMain.handle("mastery:createPracticeSession", async (_event, request) => {
  if (!request?.documentPath) throw new Error("Document path is required.");
  return createPracticeSession({
    ...request,
    documentPath: filePathWithExtension(request.documentPath),
  });
});

ipcMain.handle("mastery:getRevisionOverview", async (_event, request) => {
  const overview = revisionOverview(request);
  if (request?.prepare !== false) kickRevisionPreparation(request);
  return overview;
});

ipcMain.handle("mastery:createRevisionSession", async (_event, request) => {
  return createRevisionSession(request);
});

ipcMain.handle("mastery:getPracticeSession", async (_event, sessionId, settings, options) => {
  configureAiSettings(settings);
  return getPracticeSession(sessionId, options);
});

ipcMain.handle("mastery:listPracticeSessions", async (_event, documentPath) => {
  return listPracticeSessions(filePathWithExtension(documentPath));
});

ipcMain.handle("mastery:deletePracticeSession", async (_event, request) => {
  if (!request?.documentPath) throw new Error("Document path is required.");
  return deletePracticeSession({
    ...request,
    documentPath: filePathWithExtension(request.documentPath),
  });
});

ipcMain.handle("mastery:listPracticeEvidence", async (_event, request) => {
  if (!request?.documentPath) throw new Error("Document path is required.");
  return listPracticeEvidence({
    ...request,
    documentPath: filePathWithExtension(request.documentPath),
  });
});

ipcMain.handle("mastery:submitPracticeAnswer", async (_event, request) => {
  configureAiSettings(request?.settings);
  return submitPracticeAnswer(request);
});

ipcMain.handle("mastery:retryPracticeGrading", async (_event, request) => {
  configureAiSettings(request?.settings);
  return retryPracticeGrading(request);
});

ipcMain.handle("mastery:setPracticeCardOutcome", async (_event, request) => {
  return setPracticeCardOutcome(request);
});

ipcMain.handle("mastery:clearCards", async (_event, request) => {
  if (!request?.documentPath) throw new Error("Document path is required.");
  return clearDocumentMasteryCards({
    ...request,
    documentPath: filePathWithExtension(request.documentPath),
  });
});

ipcMain.handle("graph:extractDocumentGraph", async (_event, filePath, markdown, settings) => {
  const documentPath = filePathWithExtension(filePath);
  configureAiSettings(settings);
  return learnerGenerationManager.extractGraph(documentPath, markdown, settings);
});

ipcMain.handle("graph:getDocumentGraph", async (_event, filePath) => {
  return getDocumentGraph(filePathWithExtension(filePath));
});

ipcMain.handle("graph:deleteDocumentGraph", async (_event, filePath) => {
  const documentPath = filePathWithExtension(filePath);
  deleteDocumentGraph(documentPath);
  return getDocumentGraph(documentPath);
});

ipcMain.handle("graph:searchConcepts", async (_event, query, limit) => {
  return searchConcepts(query, limit);
});

ipcMain.handle("graph:searchRelatedConcepts", async (_event, concept, limit, settings) => {
  return searchRelatedConcepts(concept, limit, settings);
});

ipcMain.handle("graph:updateConcept", async (_event, filePath, conceptUpdate) => {
  const documentPath = filePathWithExtension(filePath);
  updateConcept(conceptUpdate);
  return getDocumentGraph(documentPath);
});

ipcMain.handle("graph:addConceptMention", async (_event, filePath, mentionRequest) => {
  const documentPath = filePathWithExtension(filePath);
  return addConceptMentionToDocument({
    ...mentionRequest,
    documentPath,
  });
});

ipcMain.handle("graph:deleteConceptFromDocument", async (_event, filePath, conceptId) => {
  const documentPath = filePathWithExtension(filePath);
  return deleteConceptFromDocument(documentPath, conceptId);
});

ipcMain.handle("graph:updateRelation", async (_event, filePath, relationUpdate) => {
  const documentPath = filePathWithExtension(filePath);
  updateRelation(relationUpdate);
  return getDocumentGraph(documentPath);
});

ipcMain.handle("graph:addRelation", async (_event, filePath, relationRequest) => {
  const documentPath = filePathWithExtension(filePath);
  return addRelationToDocument({
    ...relationRequest,
    documentPath,
  });
});
