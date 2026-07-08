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
  getDocumentEmbeddingStatus: () => {
    return ipcRenderer.invoke("document:embeddingStatus");
  },
  rebuildDocumentEmbeddings: () => {
    return ipcRenderer.invoke("document:rebuildEmbeddings");
  },
  semanticSearchDocuments: (query, limit) => {
    return ipcRenderer.invoke("document:semanticSearch", query, limit);
  },
});
