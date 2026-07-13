function createTaskWorker({ concurrency = 4, onError = () => {}, pollIntervalMs = 50, queue }) {
  if (!queue || typeof queue.claimNextTask !== "function" || typeof queue.runTask !== "function") {
    throw new Error("A compatible task management queue is required.");
  }
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("Task worker concurrency must be a positive integer.");
  }
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 1) {
    throw new Error("Task worker pollIntervalMs must be a positive integer.");
  }

  const activeLockKeys = new Set();
  const activeTasks = new Map();
  let pollTimer = null;
  let running = false;

  function executeClaimedTask(task) {
    activeLockKeys.add(task.lockKey);
    const completion = queue.runTask(task.id, { settleWaiters: false })
      .catch((error) => {
        onError(error, task);
      })
      .finally(() => {
        activeTasks.delete(task.id);
        activeLockKeys.delete(task.lockKey);
        if (running) queueMicrotask(pump);
        queue.settleTask(task.id);
      });
    activeTasks.set(task.id, completion);
  }

  function pump() {
    if (!running) return 0;

    let startedCount = 0;
    while (activeTasks.size < concurrency) {
      const task = queue.claimNextTask({ excludedLockKeys: activeLockKeys });
      if (!task) break;
      executeClaimedTask(task);
      startedCount += 1;
    }
    return startedCount;
  }

  function start() {
    if (running) return;
    running = true;
    pollTimer = setInterval(pump, pollIntervalMs);
    pollTimer.unref?.();
    pump();
  }

  async function stop({ drain = true } = {}) {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    if (!drain) {
      running = false;
      return;
    }

    running = true;
    while (true) {
      pump();
      if (activeTasks.size === 0) break;
      await Promise.allSettled([...activeTasks.values()]);
    }
    running = false;
  }

  function getStatus() {
    return {
      activeTaskIds: [...activeTasks.keys()],
      concurrency,
      running,
    };
  }

  return { getStatus, pump, start, stop };
}

module.exports = { createTaskWorker };