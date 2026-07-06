const { app, BrowserWindow, ipcMain, net, protocol, shell } = require("electron");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const {
  createDocumentFile,
  createDocumentFolder,
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
  return {
    directory: getDocumentRoot(),
    tree: await listDocumentTree(),
  };
});

ipcMain.handle("document:move", async (_event, sourcePath, targetFolderPath) => {
  await moveDocumentEntry(sourcePath, targetFolderPath);
  return {
    directory: getDocumentRoot(),
    tree: await listDocumentTree(),
  };
});

ipcMain.handle("document:rename", async (_event, filePath, newTitle) => {
  const newPath = await renameDocumentFile(filePath, newTitle);
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
