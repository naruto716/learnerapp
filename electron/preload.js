const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("learner", {
  platform: process.platform,
});
