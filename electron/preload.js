const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("learner", {
  platform: process.platform,
  listMarkdownFiles: async () => {
    return ipcRenderer.invoke("markdown:list");
  },
  readMarkdownFile: async (fileName) => {
    return ipcRenderer.invoke("markdown:read", fileName);
  }
});
