function createKeyedOperationLock(onStatusChange = () => {}) {
  const activeOperations = new Map();
  const operationStatuses = new Map();

  function saveStatus(key, status) {
    operationStatuses.set(key, status);
    onStatusChange(status);
    return status;
  }

  async function run(key, label, operation) {
    const activeOperation = activeOperations.get(key);
    if (activeOperation) {
      const error = new Error(`${activeOperation} is already running for this note. Wait for it to finish before starting ${label}.`);
      error.activeOperation = activeOperation;
      throw error;
    }

    activeOperations.set(key, label);
    const startedAt = Date.now();
    saveStatus(key, {
      completedAt: null,
      error: null,
      key,
      operation: label,
      progress: null,
      startedAt,
      state: "running",
      updatedAt: startedAt,
    });
    try {
      const result = await operation();
      const completedAt = Date.now();
      saveStatus(key, {
        ...operationStatuses.get(key),
        completedAt,
        state: "completed",
        updatedAt: completedAt,
      });
      return result;
    } catch (error) {
      const completedAt = Date.now();
      saveStatus(key, {
        ...operationStatuses.get(key),
        completedAt,
        error: error instanceof Error ? error.message : String(error),
        state: "failed",
        updatedAt: completedAt,
      });
      throw error;
    } finally {
      activeOperations.delete(key);
    }
  }

  function getStatus(key) {
    return operationStatuses.get(key) ?? null;
  }

  function updateProgress(key, progress) {
    const status = operationStatuses.get(key);
    if (!status || status.state !== "running") return status ?? null;
    return saveStatus(key, {
      ...status,
      progress: { ...progress },
      updatedAt: Date.now(),
    });
  }

  return { getStatus, run, updateProgress };
}

module.exports = { createKeyedOperationLock };