const disabledValues = new Set(["0", "false", "off", "no"]);

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
  console.info(`[graph] ${event}`, sanitizeDetails(details));
}

function graphDebug(event, details = {}) {
  if (!graphLoggingEnabled() || !graphDebugEnabled()) return;
  console.debug(`[graph:debug] ${event}`, sanitizeDetails(details));
}

function graphWarn(event, details = {}) {
  if (!graphLoggingEnabled()) return;
  console.warn(`[graph] ${event}`, sanitizeDetails(details));
}

function graphError(event, error, details = {}) {
  if (!graphLoggingEnabled()) return;
  console.error(`[graph] ${event}`, {
    ...sanitizeDetails(details),
    error: error instanceof Error ? error.message : String(error),
  });
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
