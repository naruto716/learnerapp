const { app } = require("electron");
const fs = require("fs");
const path = require("path");

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !/api[-_]?key|authorization|token|secret|prompt|markdown/i.test(key))
      .map(([key, entry]) => [key, sanitize(entry)]),
  );
}

function operationLog(event, details = {}) {
  const record = {
    at: new Date().toISOString(),
    event,
    ...sanitize(details),
  };

  try {
    const logDirectory = path.join(app.getPath("logs"), "Learner");
    fs.mkdirSync(logDirectory, { recursive: true });
    fs.appendFileSync(path.join(logDirectory, "operations.jsonl"), `${JSON.stringify(record)}\n`, "utf8");
  } catch (error) {
    console.warn("[operations] Could not write operation log:", error instanceof Error ? error.message : error);
  }
}

module.exports = {
  operationLog,
};