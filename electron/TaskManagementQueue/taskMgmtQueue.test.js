const assert = require("node:assert/strict");
const test = require("node:test");
const { TaskQueueError, createTaskManagementQueue } = require("./taskMgmtQueue");

function task({ callback = async () => {}, deps = [], document = "note-a.json", key, type = key }) {
  return { callback, deps, document, key, type };
}

test("atomically rejects invalid batches", () => {
  const queue = createTaskManagementQueue();

  assert.throws(
    () => queue.enqueueTasks([
      task({ key: "concepts" }),
      task({ deps: ["missing"], key: "metaphor" }),
    ]),
    (error) => error instanceof TaskQueueError && error.code === "UNKNOWN_DEPENDENCY",
  );
  assert.deepEqual(queue.getTasksForDocument("note-a.json"), []);
  assert.deepEqual(queue.getRunnableTasks(), []);
});

test("rejects dependency cycles before insertion", () => {
  const queue = createTaskManagementQueue();

  assert.throws(
    () => queue.enqueueTasks([
      task({ deps: ["metaphor"], key: "concepts" }),
      task({ deps: ["concepts"], key: "metaphor" }),
    ]),
    (error) => error instanceof TaskQueueError && error.code === "DEPENDENCY_CYCLE",
  );
  assert.deepEqual(queue.getTasksForDocument("note-a.json"), []);
});

test("processes an atomic batch in dependency order", async () => {
  const queue = createTaskManagementQueue();
  const executionOrder = [];
  const batch = queue.enqueueTasks([
    task({ callback: async () => executionOrder.push("concepts"), key: "concepts" }),
    task({ callback: async () => executionOrder.push("metaphor"), deps: ["concepts"], key: "metaphor" }),
    task({ callback: async () => executionOrder.push("cards"), deps: ["concepts", "metaphor"], key: "cards" }),
  ]);

  assert.deepEqual(queue.getRunnableTasks().map((queuedTask) => queuedTask.key), ["concepts"]);
  assert.equal((await queue.processNextTask()).status, "completed");
  assert.deepEqual(queue.getRunnableTasks().map((queuedTask) => queuedTask.key), ["metaphor"]);
  assert.equal((await queue.processNextTask()).status, "completed");
  assert.deepEqual(queue.getRunnableTasks().map((queuedTask) => queuedTask.key), ["cards"]);
  assert.equal((await queue.processNextTask()).status, "completed");
  assert.deepEqual(executionOrder, ["concepts", "metaphor", "cards"]);
  assert.equal(queue.getWorkflow(batch.workflowId).status, "completed");
});

test("normalizes duplicate dependency keys", async () => {
  const queue = createTaskManagementQueue();
  const batch = queue.enqueueTasks([
    task({ key: "concepts" }),
    task({ deps: ["concepts", "concepts"], key: "metaphor" }),
  ]);

  const metaphor = queue.getTask(batch.taskIds.metaphor);
  assert.deepEqual(metaphor.dependencyKeys, ["concepts"]);
  assert.equal(metaphor.pendingDependencies.length, 1);

  await queue.processNextTask();
  assert.deepEqual(queue.getRunnableTasks().map((queuedTask) => queuedTask.key), ["metaphor"]);
});

test("rejects active duplicates atomically and releases the key after completion", async () => {
  const queue = createTaskManagementQueue();
  queue.enqueueTask(task({ key: "concepts" }));

  assert.throws(
    () => queue.enqueueTasks([
      task({ document: "note-b.json", key: "other" }),
      task({ key: "duplicate-concepts", type: "concepts" }),
    ]),
    (error) => error instanceof TaskQueueError && error.code === "DUPLICATE_TASK",
  );
  assert.deepEqual(queue.getTasksForDocument("note-b.json"), []);

  await queue.processNextTask();
  assert.doesNotThrow(() => queue.enqueueTask(task({ key: "concepts-again", type: "concepts" })));
});

test("marks transitive dependents blocked when a task fails", async () => {
  const queue = createTaskManagementQueue();
  let dependentCallbackRan = false;
  const batch = queue.enqueueTasks([
    task({
      callback: async () => {
        const error = new Error("provider unavailable");
        error.code = "PROVIDER_UNAVAILABLE";
        error.retryable = true;
        throw error;
      },
      key: "concepts",
    }),
    task({ callback: async () => { dependentCallbackRan = true; }, deps: ["concepts"], key: "metaphor" }),
    task({ callback: async () => { dependentCallbackRan = true; }, deps: ["metaphor"], key: "cards" }),
  ]);

  const failed = await queue.processNextTask();
  assert.equal(failed.status, "failed");
  assert.equal(failed.error.code, "PROVIDER_UNAVAILABLE");
  assert.equal(failed.error.retryable, true);
  assert.equal(queue.getTask(batch.taskIds.metaphor).status, "blocked");
  assert.equal(queue.getTask(batch.taskIds.metaphor).blockedBy, batch.taskIds.concepts);
  assert.equal(queue.getTask(batch.taskIds.cards).status, "blocked");
  assert.equal(queue.getTask(batch.taskIds.cards).blockedBy, batch.taskIds.concepts);
  assert.equal(dependentCallbackRan, false);
  assert.equal(await queue.processNextTask(), null);
  assert.equal(queue.getWorkflow(batch.workflowId).status, "failed");
});

test("single-task enqueue uses the same queue and reports progress", async () => {
  const events = [];
  const queue = createTaskManagementQueue();
  queue.subscribe((changedTask) => events.push(changedTask));
  const queuedTask = queue.enqueueTask(task({
    callback: async ({ updateProgress }) => {
      updateProgress({ completed: 1, total: 2 });
    },
    key: "concepts",
  }));

  assert.equal(queuedTask.status, "queued");
  const completedTask = await queue.processNextTask();
  assert.equal(completedTask.status, "completed");
  assert.deepEqual(completedTask.progress, { completed: 1, total: 2 });
  assert.ok(events.some((event) => event.status === "running"));
  assert.ok(events.some((event) => event.progress?.completed === 1));
  assert.ok(events.some((event) => event.status === "completed"));
});

test("returned task snapshots cannot mutate queue state", () => {
  const queue = createTaskManagementQueue();
  const queuedTask = queue.enqueueTask(task({ key: "concepts" }));

  queuedTask.dependencies.push("external-mutation");
  queuedTask.progress = { external: true };

  const storedTask = queue.getTask(queuedTask.id);
  assert.deepEqual(storedTask.dependencies, []);
  assert.equal(storedTask.progress, null);
});

test("joins a newly submitted task to an exact active task ID", async () => {
  const queue = createTaskManagementQueue();
  const concepts = queue.enqueueTask({
    ...task({ key: "concepts" }),
    dedupKey: "concepts:note-a:hash-1",
    lockKey: "concepts:note-a",
  });
  const batch = queue.enqueueTasks([{
    ...task({ key: "metaphor" }),
    externalDeps: [concepts.id],
  }]);

  assert.equal(queue.getActiveTaskByDedupKey("concepts:note-a:hash-1").id, concepts.id);
  assert.deepEqual(queue.getActiveTasksByLockKey("concepts:note-a").map((activeTask) => activeTask.id), [concepts.id]);
  assert.equal(queue.getTask(batch.taskIds.metaphor).status, "pending");
  assert.deepEqual(queue.getTask(batch.taskIds.metaphor).pendingDependencies, [concepts.id]);

  await queue.processNextTask();
  assert.equal(queue.getActiveTaskByDedupKey("concepts:note-a:hash-1"), null);
  assert.deepEqual(queue.getActiveTasksByLockKey("concepts:note-a"), []);
  assert.deepEqual(queue.getRunnableTasks().map((queuedTask) => queuedTask.key), ["metaphor"]);
});

test("allows forced duplicates while normal lookup returns the newest active task", async () => {
  const queue = createTaskManagementQueue();
  const first = queue.enqueueTask({
    ...task({ key: "concepts" }),
    dedupKey: "concepts:note-a:hash-1",
    lockKey: "concepts:note-a",
  });
  const forced = queue.enqueueTask({
    ...task({ key: "forced-concepts" }),
    allowDuplicate: true,
    dedupKey: "concepts:note-a:hash-1",
    lockKey: "concepts:note-a",
    type: "concepts",
  });

  assert.deepEqual(
    queue.getActiveTasksByDedupKey("concepts:note-a:hash-1").map((activeTask) => activeTask.id),
    [first.id, forced.id],
  );
  assert.equal(queue.getActiveTaskByDedupKey("concepts:note-a:hash-1").id, forced.id);

  await queue.processNextTask();
  assert.equal(queue.getActiveTaskByDedupKey("concepts:note-a:hash-1").id, forced.id);
  await queue.processNextTask();
  assert.equal(queue.getActiveTaskByDedupKey("concepts:note-a:hash-1"), null);
});