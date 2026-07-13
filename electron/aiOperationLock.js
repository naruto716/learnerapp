function createKeyedOperationLock() {
  const activeOperations = new Map();

  async function run(key, label, operation) {
    const activeOperation = activeOperations.get(key);
    if (activeOperation) {
      const error = new Error(`${activeOperation} is already running for this note. Wait for it to finish before starting ${label}.`);
      error.activeOperation = activeOperation;
      throw error;
    }

    activeOperations.set(key, label);
    try {
      return await operation();
    } finally {
      activeOperations.delete(key);
    }
  }

  return { run };
}

module.exports = { createKeyedOperationLock };