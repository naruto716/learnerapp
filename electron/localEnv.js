/* Minimal dotenv loader for packaged Electron startup. Files are read in order
 * and never override environment variables already supplied by the process. */
const fs = require("fs");
const path = require("path");

const envFileNames = [".env.local", ".env"];

function stripQuotes(value) {
  const trimmed = value.trim();

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith("#")) continue;

    const separatorIndex = trimmedLine.indexOf("=");
    if (separatorIndex < 1) continue;

    const key = trimmedLine.slice(0, separatorIndex).trim();
    const value = stripQuotes(trimmedLine.slice(separatorIndex + 1));

    // The process environment has precedence over local convenience files.
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function loadLocalEnv(rootDir = path.join(__dirname, "..")) {
  for (const fileName of envFileNames) {
    loadEnvFile(path.join(rootDir, fileName));
  }
}

module.exports = {
  loadLocalEnv,
};
