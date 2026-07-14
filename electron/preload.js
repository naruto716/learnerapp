const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("learner", {
  platform: process.platform,
  isFullScreen: () => {
    return ipcRenderer.invoke("window:is-fullscreen");
  },
  minimizeWindow: () => {
    return ipcRenderer.invoke("window:minimize");
  },
  toggleMaximizeWindow: () => {
    return ipcRenderer.invoke("window:toggle-maximize");
  },
  onMaximizedChange: (callback) => {
    const listener = (_event, isMaximized) => callback(isMaximized);
    ipcRenderer.on("window:maximized-change", listener);
    return () => ipcRenderer.removeListener("window:maximized-change", listener);
  },
  closeWindow: () => {
    return ipcRenderer.invoke("window:close");
  },
  onFullScreenChange: (callback) => {
    const listener = (_event, isFullScreen) => callback(isFullScreen);
    ipcRenderer.on("window:fullscreen-change", listener);
    return () => ipcRenderer.removeListener("window:fullscreen-change", listener);
  },
  listDocuments: () => {
    return ipcRenderer.invoke("document:list");
  },
  readDocument: (filePath) => {
    return ipcRenderer.invoke("document:read", filePath);
  },
  saveDocument: (filePath, document) => {
    return ipcRenderer.invoke("document:save", filePath, document);
  },
  createDocumentFolder: (folderPath) => {
    return ipcRenderer.invoke("document:createFolder", folderPath);
  },
  createDocumentFile: (filePath) => {
    return ipcRenderer.invoke("document:createFile", filePath);
  },
  moveDocumentEntry: (sourcePath, targetFolderPath) => {
    return ipcRenderer.invoke("document:move", sourcePath, targetFolderPath);
  },
  deleteDocumentEntry: (entryPath) => {
    return ipcRenderer.invoke("document:delete", entryPath);
  },
  renameDocumentFile: (filePath, newTitle) => {
    return ipcRenderer.invoke("document:rename", filePath, newTitle);
  },
  reorderDocumentEntry: (reorderRequest) => {
    return ipcRenderer.invoke("document:reorder", reorderRequest);
  },
  saveDocumentImage: (fileName, data) => {
    return ipcRenderer.invoke("document:saveImage", fileName, data);
  },
  searchDocuments: (query, limit) => {
    return ipcRenderer.invoke("document:search", query, limit);
  },
  rebuildDocumentSearchIndex: () => {
    return ipcRenderer.invoke("document:rebuildSearchIndex");
  },
  configureAi: (settings) => {
    return ipcRenderer.invoke("ai:configure", settings);
  },
  listAiModels: (settings) => {
    return ipcRenderer.invoke("ai:listModels", settings);
  },
  testAiEmbedding: (settings) => {
    return ipcRenderer.invoke("ai:testEmbedding", settings);
  },
  generateImage: (request) => {
    return ipcRenderer.invoke("ai:generateImage", request);
  },
  transcribeSpeech: (request) => {
    return ipcRenderer.invoke("speech:transcribe", request);
  },
  getDocumentMastery: (filePath, markdown, options) => {
    return ipcRenderer.invoke("mastery:getDocumentMastery", filePath, markdown, options);
  },
  generateDocumentMastery: (request) => {
    return ipcRenderer.invoke("mastery:generateDocumentMastery", request);
  },
  generateDocumentMasteryAssets: (request) => {
    return ipcRenderer.invoke("mastery:generateAssets", request);
  },
  updateDocumentMasteryConceptLevel: (request) => {
    return ipcRenderer.invoke("mastery:updateConceptLevel", request);
  },
  updateDocumentMasteryConceptScore: (request) => {
    return ipcRenderer.invoke("mastery:updateConceptScore", request);
  },
  generateDocumentMasteryMetaphor: (request) => {
    return ipcRenderer.invoke("mastery:generateMetaphor", request);
  },
  onMasteryMetaphorProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("mastery:metaphorProgress", listener);
    return () => ipcRenderer.removeListener("mastery:metaphorProgress", listener);
  },
  clearDocumentMastery: (request) => {
    return ipcRenderer.invoke("mastery:clearDocumentMastery", request);
  },
  getDocumentMasteryCards: (documentPath) => {
    return ipcRenderer.invoke("mastery:getCards", documentPath);
  },
  getDocumentMasteryGenerationStatus: (documentPath) => {
    return ipcRenderer.invoke("mastery:getGenerationStatus", documentPath);
  },
  getDocumentMasteryGenerationStatuses: (documentPath) => {
    return ipcRenderer.invoke("mastery:getGenerationStatuses", documentPath);
  },
  generateDocumentMasteryCards: (request) => {
    return ipcRenderer.invoke("mastery:generateCards", request);
  },
  onMasteryCardProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("mastery:cardProgress", listener);
    return () => ipcRenderer.removeListener("mastery:cardProgress", listener);
  },
  onAiOperationStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("ai:operationStatus", listener);
    return () => ipcRenderer.removeListener("ai:operationStatus", listener);
  },
  continueMasteryCardDiscussion: (request) => {
    return ipcRenderer.invoke("mastery:continueCardDiscussion", request);
  },
  evaluateMasteryCard: (request) => {
    return ipcRenderer.invoke("mastery:evaluateCard", request);
  },
  createMasteryPracticeSession: (request) => {
    return ipcRenderer.invoke("mastery:createPracticeSession", request);
  },
  getMasteryRevisionOverview: (request) => {
    return ipcRenderer.invoke("mastery:getRevisionOverview", request);
  },
  createMasteryRevisionSession: (request) => {
    return ipcRenderer.invoke("mastery:createRevisionSession", request);
  },
  getMasteryPracticeSession: (sessionId, settings, options) => {
    return ipcRenderer.invoke("mastery:getPracticeSession", sessionId, settings, options);
  },
  listMasteryPracticeSessions: (documentPath) => {
    return ipcRenderer.invoke("mastery:listPracticeSessions", documentPath);
  },
  deleteMasteryPracticeSession: (request) => {
    return ipcRenderer.invoke("mastery:deletePracticeSession", request);
  },
  listMasteryPracticeEvidence: (request) => {
    return ipcRenderer.invoke("mastery:listPracticeEvidence", request);
  },
  submitMasteryPracticeAnswer: (request) => {
    return ipcRenderer.invoke("mastery:submitPracticeAnswer", request);
  },
  retryMasteryPracticeGrading: (request) => {
    return ipcRenderer.invoke("mastery:retryPracticeGrading", request);
  },
  setMasteryPracticeCardOutcome: (request) => {
    return ipcRenderer.invoke("mastery:setPracticeCardOutcome", request);
  },
  clearDocumentMasteryCards: (request) => {
    return ipcRenderer.invoke("mastery:clearCards", request);
  },
  getDocumentEmbeddingStatus: (settings) => {
    return ipcRenderer.invoke("document:embeddingStatus", settings);
  },
  rebuildDocumentEmbeddings: (settings) => {
    return ipcRenderer.invoke("document:rebuildEmbeddings", settings);
  },
  semanticSearchDocuments: (query, limit, settings) => {
    return ipcRenderer.invoke("document:semanticSearch", query, limit, settings);
  },
  extractDocumentGraph: (filePath, markdown, settings) => {
    return ipcRenderer.invoke("graph:extractDocumentGraph", filePath, markdown, settings);
  },
  getDocumentGraph: (filePath) => {
    return ipcRenderer.invoke("graph:getDocumentGraph", filePath);
  },
  getDocumentGraphStatus: (filePath, markdown) => {
    return ipcRenderer.invoke("graph:getDocumentGraphStatus", filePath, markdown);
  },
  deleteDocumentGraph: (filePath) => {
    return ipcRenderer.invoke("graph:deleteDocumentGraph", filePath);
  },
  searchGraphConcepts: (query, limit) => {
    return ipcRenderer.invoke("graph:searchConcepts", query, limit);
  },
  searchRelatedGraphConcepts: (concept, limit, settings) => {
    return ipcRenderer.invoke("graph:searchRelatedConcepts", concept, limit, settings);
  },
  updateGraphConcept: (filePath, conceptUpdate) => {
    return ipcRenderer.invoke("graph:updateConcept", filePath, conceptUpdate);
  },
  addGraphConceptMention: (filePath, mentionRequest) => {
    return ipcRenderer.invoke("graph:addConceptMention", filePath, mentionRequest);
  },
  deleteGraphConceptFromDocument: (filePath, conceptId) => {
    return ipcRenderer.invoke("graph:deleteConceptFromDocument", filePath, conceptId);
  },
  updateGraphRelation: (filePath, relationUpdate) => {
    return ipcRenderer.invoke("graph:updateRelation", filePath, relationUpdate);
  },
  addGraphRelation: (filePath, relationRequest) => {
    return ipcRenderer.invoke("graph:addRelation", filePath, relationRequest);
  },
});
