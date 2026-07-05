const { app, BrowserWindow, net, protocol, shell } = require("electron");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

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

ipcMain.handle("markdown:list", async () => {
  const markdownRoot = getMarkdownRoot();
  const files = await listMarkdownFiles(markdownRoot, markdownRoot);
  return { directory: markdownRoot, files };
})

ipcMain.handle("markdown:read", async (event, fileName) => {
  const filePath = await resolveMarkdownPath(fileName);
  const content = await fs.readFile(filePath, "utf-8");
  return content;
});
