const { app, ipcMain } = require("electron");
const fs = require("fs/promises");
const path = require("path");

function getMarkdownRoot() {
    return path.join(app.getPath("userData"), "markdown");
}

async function listMarkdownFiles(dir, rootDir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    const files = [];

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            const subFiles = await listMarkdownFiles(fullPath, rootDir);
            files.push(...subFiles);
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
            const relativePath = path.relative(rootDir, fullPath);
            files.push(relativePath);
        }
    }
    return files;
}

async function resolveMarkdownPath(fileName) {
    const markdownRoot = getMarkdownRoot();
    const filePath = path.join(markdownRoot, fileName);

    if (!filePath.startsWith(markdownRoot)) {
        throw new Error("Invalid file path");
    }
    
    if (!filePath.endsWith(".md")) {
        throw new Error("Invalid file type");
    }
    
    return filePath;
}