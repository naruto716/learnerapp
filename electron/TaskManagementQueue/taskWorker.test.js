const assert = require("node:assert/strict");
const test = require("node:test");
const { createTaskManagementQueue } = require("./taskMgmtQueue");
const { createTaskWorker } = require("./taskWorker");

function deferred() {
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

test("runs different lock keys concurrently and serializes the same lock key", async () => {
  const queue = createTaskManagementQueue();
  const worker = createTaskWorker({ concurrency: 3, pollIntervalMs: 10, queue });
  const releases = [deferred(), deferred(), deferred()];
  const started = [];

  const first = queue.enqueueTask({
    callback: async () => {
      started.push("first");
      await releases[0].promise;
      return "first-result";
    },
    deps: [],
    document: "note-a.json",
    key: "first",
    lockKey: "document:note-a.json",
    type: "concepts",
  });
  const second = queue.enqueueTask({
    allowDuplicate: true,
    callback: async () => {
      started.push("second");
      await releases[1].promise;
      return "second-result";
    },
    deps: [],
    document: "note-a.json",
    key: "second",
    lockKey: "document:note-a.json",
    type: "metaphor",
  });
  const otherDocument = queue.enqueueTask({
    callback: async () => {
      started.push("other");
      await releases[2].promise;
      return "other-result";
    },
    deps: [],
    document: "note-b.json",
    key: "other",
    lockKey: "document:note-b.json",
    type: "concepts",
  });

  worker.start();
  worker.pump();
  assert.deepEqual(started, ["first", "other"]);
  assert.equal(queue.getTask(second.id).status, "queued");

  releases[0].resolve();
  assert.equal(await queue.waitForTask(first.id), "first-result");
  assert.equal(queue.getTask(second.id).status, "running");

  releases[1].resolve();
  releases[2].resolve();
  assert.equal(await queue.waitForTask(second.id), "second-result");
  assert.equal(await queue.waitForTask(otherDocument.id), "other-result");
  await worker.stop();
});

test("waitForTask preserves the original callback error", async () => {
  const queue = createTaskManagementQueue();
  const worker = createTaskWorker({ queue });
  const expectedError = new Error("provider unavailable");
  const task = queue.enqueueTask({
    callback: async () => {
      throw expectedError;
    },
    deps: [],
    document: "note-a.json",
    key: "concepts",
    type: "concepts",
  });

  worker.start();
  await assert.rejects(queue.waitForTask(task.id), (error) => error === expectedError);
  await worker.stop();
});

test("polling worker picks up tasks added after start", async () => {
  const queue = createTaskManagementQueue();
  const worker = createTaskWorker({ pollIntervalMs: 5, queue });
  worker.start();
  const task = queue.enqueueTask({
    callback: async () => "done",
    deps: [],
    document: "note-a.json",
    key: "concepts",
    type: "concepts",
  });

  assert.equal(await queue.waitForTask(task.id), "done");
  await worker.stop();
});

test("stop with drain completes queued dependent tasks", async () => {
  const queue = createTaskManagementQueue();
  const worker = createTaskWorker({ queue });
  const executionOrder = [];
  const batch = queue.enqueueTasks([
    {
      callback: async () => executionOrder.push("concepts"),
      deps: [],
      document: "note-a.json",
      key: "concepts",
      lockKey: "document:note-a.json",
      type: "concepts",
    },
    {
      callback: async () => executionOrder.push("graph"),
      deps: ["concepts"],
      document: "note-a.json",
      key: "graph",
      lockKey: "document:note-a.json",
      type: "graph",
    },
    {
      callback: async () => executionOrder.push("cards"),
      deps: ["concepts", "graph"],
      document: "note-a.json",
      key: "cards",
      lockKey: "document:note-a.json",
      type: "cards",
    },
  ]);

  worker.start();
  await worker.stop({ drain: true });

  assert.deepEqual(executionOrder, ["concepts", "graph", "cards"]);
  assert.equal(queue.getWorkflow(batch.workflowId).status, "completed");
});