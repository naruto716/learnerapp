const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("learner", {
  platform: process.platform,
  isFullScreen: () => {
    return ipcRenderer.invoke("window:is-fullscreen");
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
  generateImage: (request) => {
    return ipcRenderer.invoke("ai:generateImage", request);
  },
  getDocumentMastery: (filePath, markdown) => {
    return ipcRenderer.invoke("mastery:getDocumentMastery", filePath, markdown);
  },
  generateDocumentMastery: (request) => {
    return ipcRenderer.invoke("mastery:generateDocumentMastery", request);
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
  generateDocumentMasteryCards: (request) => {
    return ipcRenderer.invoke("mastery:generateCards", request);
  },
  onMasteryCardProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("mastery:cardProgress", listener);
    return () => ipcRenderer.removeListener("mastery:cardProgress", listener);
  },
  continueMasteryCardDiscussion: (request) => {
    return ipcRenderer.invoke("mastery:continueCardDiscussion", request);
  },
  evaluateMasteryCard: (request) => {
    return ipcRenderer.invoke("mastery:evaluateCard", request);
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
