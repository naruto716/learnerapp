const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("learner", {
  platform: process.platform,
  listMarkdownFiles: () => {
    return ipcRenderer.invoke("markdown:list");
  },
  readMarkdownFile: (filePath) => {
    return ipcRenderer.invoke("markdown:read", filePath);
  },
  createMarkdownFolder: (folderPath) => {
    return ipcRenderer.invoke("markdown:createFolder", folderPath);
  },
  createMarkdownFile: (filePath) => {
    return ipcRenderer.invoke("markdown:createFile", filePath);
  },
});
