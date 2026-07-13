const disabledValues = new Set(["0", "false", "off", "no"]);
const { operationLog } = require("../operationLog");

function graphLoggingEnabled() {
  return !disabledValues.has(String(process.env.LEARNER_GRAPH_LOG || "1").trim().toLowerCase());
}

function graphDebugEnabled() {
  return ["1", "true", "on", "yes"].includes(String(process.env.LEARNER_GRAPH_DEBUG || "").trim().toLowerCase());
}

function sanitizeDetails(details) {
  if (!details || typeof details !== "object") return details;

  return Object.fromEntries(
    Object.entries(details).filter(([key]) => !/api[-_]?key|authorization|token|secret/i.test(key)),
  );
}

function graphLog(event, details = {}) {
  if (!graphLoggingEnabled()) return;
  const sanitizedDetails = sanitizeDetails(details);
  console.info(`[graph] ${event}`, sanitizedDetails);
  operationLog(`graph.${event}`, sanitizedDetails);
}

function graphDebug(event, details = {}) {
  if (!graphLoggingEnabled() || !graphDebugEnabled()) return;
  console.debug(`[graph:debug] ${event}`, sanitizeDetails(details));
}

function graphWarn(event, details = {}) {
  if (!graphLoggingEnabled()) return;
  const sanitizedDetails = sanitizeDetails(details);
  console.warn(`[graph] ${event}`, sanitizedDetails);
  operationLog(`graph.${event}`, { level: "warning", ...sanitizedDetails });
}

function graphError(event, error, details = {}) {
  if (!graphLoggingEnabled()) return;
  const errorDetails = {
    ...sanitizeDetails(details),
    error: error instanceof Error ? error.message : String(error),
  };
  console.error(`[graph] ${event}`, errorDetails);
  operationLog(`graph.${event}`, { level: "error", ...errorDetails });
}

function startTimer() {
  const startedAt = performance.now();
  return () => Math.round(performance.now() - startedAt);
}

function hashPreview(hash) {
  return String(hash || "").slice(0, 12);
}

module.exports = {
  graphDebug,
  graphError,
  graphLog,
  graphWarn,
  hashPreview,
  startTimer,
};
