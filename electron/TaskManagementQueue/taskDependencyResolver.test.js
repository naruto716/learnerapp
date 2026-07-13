const assert = require("node:assert/strict");
const test = require("node:test");
const { createTaskDependencyResolver, TaskDependencyResolutionError } = require("./taskDependencyResolver");
const { createTaskManagementQueue } = require("./taskMgmtQueue");

function createDefinitions({ executionOrder = [], satisfied = new Set() } = {}) {
  function definition(type, dependencies) {
    return {
      artifactKey: ({ document, hash }) => `${type}:${document}:${hash}`,
      createCallback: () => async () => executionOrder.push(type),
      dedupKey: ({ document, hash }) => `${type}:${document}:${hash}`,
      dependencies,
      document: ({ document }) => document,
      isSatisfied: () => satisfied.has(type),
      key: () => type,
      lockKey: ({ document }) => `${type}:${document}`,
    };
  }

  return {
    cards: definition("cards", ["concepts", "metaphor"]),
    concepts: definition("concepts", []),
    metaphor: definition("metaphor", ["concepts"]),
  };
}

const context = { document: "note-a.json", hash: "hash-1" };

test("creates the missing dependency closure as one atomic workflow", async () => {
  const executionOrder = [];
  const queue = createTaskManagementQueue();
  const resolver = createTaskDependencyResolver({
    definitions: createDefinitions({ executionOrder }),
    queue,
  });

  const resolution = resolver.resolveAndEnqueue({ context, targets: ["cards"] });

  assert.equal(resolution.nodes.concepts.disposition, "created");
  assert.equal(resolution.nodes.metaphor.disposition, "created");
  assert.equal(resolution.nodes.cards.disposition, "created");
  assert.ok(resolution.workflowId);
  assert.deepEqual(queue.getRunnableTasks().map((task) => task.type), ["concepts"]);

  await queue.processNextTask();
  await queue.processNextTask();
  await queue.processNextTask();

  assert.deepEqual(executionOrder, ["concepts", "metaphor", "cards"]);
  assert.equal(queue.getWorkflow(resolution.workflowId).status, "completed");
});

test("fast-forwards a fully satisfied persisted dependency closure", () => {
  const queue = createTaskManagementQueue();
  const resolver = createTaskDependencyResolver({
    definitions: createDefinitions({ satisfied: new Set(["concepts", "metaphor", "cards"]) }),
    queue,
  });

  const resolution = resolver.resolveAndEnqueue({ context, targets: ["cards"] });

  assert.equal(resolution.nodes.concepts.disposition, "persisted");
  assert.equal(resolution.nodes.metaphor.disposition, "persisted");
  assert.equal(resolution.nodes.cards.disposition, "persisted");
  assert.equal(resolution.workflowId, null);
  assert.deepEqual(queue.getTasksForDocument(context.document), []);
  assert.deepEqual(resolver.getResolution(resolution.id), resolution);
});

test("joins an exact active prerequisite by immutable task ID", async () => {
  const queue = createTaskManagementQueue();
  const activeConcepts = queue.enqueueTask({
    artifactKey: "concepts:note-a.json:hash-1",
    callback: async () => {},
    dedupKey: "concepts:note-a.json:hash-1",
    deps: [],
    document: context.document,
    key: "active-concepts",
    lockKey: "concepts:note-a.json",
    type: "concepts",
  });
  const resolver = createTaskDependencyResolver({ definitions: createDefinitions(), queue });

  const resolution = resolver.resolveAndEnqueue({ context, targets: ["metaphor"] });
  const metaphor = queue.getTask(resolution.nodes.metaphor.taskId);

  assert.equal(resolution.nodes.concepts.disposition, "joined");
  assert.equal(resolution.nodes.concepts.taskId, activeConcepts.id);
  assert.equal(resolution.nodes.metaphor.disposition, "created");
  assert.deepEqual(metaphor.externalDependencies, [activeConcepts.id]);
  assert.equal(metaphor.status, "pending");

  await queue.processNextTask();
  assert.deepEqual(queue.getRunnableTasks().map((task) => task.type), ["metaphor"]);
});

test("joins equivalent downstream work once its prerequisites have completed", async () => {
  const queue = createTaskManagementQueue();
  const batch = queue.enqueueTasks([
    {
      artifactKey: "concepts:note-a.json:hash-1",
      callback: async () => {},
      dedupKey: "concepts:note-a.json:hash-1",
      deps: [],
      document: context.document,
      key: "concepts",
      lockKey: "document:note-a.json",
      type: "concepts",
    },
    {
      artifactKey: "metaphor:note-a.json:hash-1",
      callback: async () => {},
      dedupKey: "metaphor:note-a.json:hash-1",
      deps: ["concepts"],
      document: context.document,
      key: "metaphor",
      lockKey: "document:note-a.json",
      type: "metaphor",
    },
  ]);
  await queue.processNextTask();
  const definitions = createDefinitions();
  const resolver = createTaskDependencyResolver({ definitions, queue });

  const resolution = resolver.resolveAndEnqueue({ context, targets: ["metaphor"] });

  assert.equal(resolution.nodes.metaphor.disposition, "joined");
  assert.equal(resolution.nodes.metaphor.taskId, batch.taskIds.metaphor);
  assert.equal(resolution.workflowId, null);
});

test("joins pending downstream work when only completed prerequisites are omitted", async () => {
  const queue = createTaskManagementQueue();
  const batch = queue.enqueueTasks([
    {
      artifactKey: "concepts:note-a.json:hash-1",
      callback: async () => {},
      dedupKey: "concepts:note-a.json:hash-1",
      deps: [],
      document: context.document,
      key: "concepts",
      lockKey: "document:note-a.json",
      type: "concepts",
    },
    {
      artifactKey: "metaphor:note-a.json:hash-1",
      callback: async () => {},
      dedupKey: "metaphor:note-a.json:hash-1",
      deps: ["concepts"],
      document: context.document,
      key: "metaphor",
      lockKey: "document:note-a.json",
      type: "metaphor",
    },
    {
      artifactKey: "cards:note-a.json:hash-1",
      callback: async () => {},
      dedupKey: "cards:note-a.json:hash-1",
      deps: ["concepts", "metaphor"],
      document: context.document,
      key: "cards",
      lockKey: "document:note-a.json",
      type: "cards",
    },
  ]);
  await queue.processNextTask();
  const resolver = createTaskDependencyResolver({
    definitions: createDefinitions({ satisfied: new Set(["concepts"]) }),
    queue,
  });

  const resolution = resolver.resolveAndEnqueue({ context, targets: ["cards"] });

  assert.equal(resolution.nodes.concepts.disposition, "persisted");
  assert.equal(resolution.nodes.metaphor.disposition, "joined");
  assert.equal(resolution.nodes.cards.disposition, "joined");
  assert.equal(resolution.nodes.cards.taskId, batch.taskIds.cards);
  assert.equal(resolution.workflowId, null);
});

test("does not join downstream work tied to a different active prerequisite", () => {
  const queue = createTaskManagementQueue();
  const oldConcepts = queue.enqueueTask({
    artifactKey: "concepts:note-a.json:hash-1",
    callback: async () => {},
    dedupKey: "concepts:note-a.json:hash-1",
    deps: [],
    document: context.document,
    key: "old-concepts",
    lockKey: "concepts:note-a.json",
    type: "concepts",
  });
  queue.enqueueTask({
    artifactKey: "metaphor:note-a.json:hash-1",
    callback: async () => {},
    dedupKey: "metaphor:note-a.json:hash-1",
    deps: [],
    document: context.document,
    externalDeps: [oldConcepts.id],
    key: "old-metaphor",
    lockKey: "metaphor:note-a.json",
    type: "metaphor",
  });
  const definitions = createDefinitions();
  definitions.concepts.dedupKey = () => "concepts:note-a.json:hash-2";
  definitions.concepts.artifactKey = () => "concepts:note-a.json:hash-2";
  const resolver = createTaskDependencyResolver({ definitions, queue });

  const resolution = resolver.resolveAndEnqueue({ context, targets: ["metaphor"] });

  assert.equal(resolution.nodes.concepts.disposition, "created");
  assert.equal(resolution.nodes.metaphor.disposition, "created");
  assert.equal(queue.getTask(resolution.nodes.metaphor.taskId).allowDuplicate, true);
  assert.deepEqual(
    queue.getTask(resolution.nodes.metaphor.taskId).dependencies,
    [resolution.nodes.concepts.taskId],
  );
});

test("does not fast-forward downstream persisted state when a prerequisite is created", () => {
  const queue = createTaskManagementQueue();
  const resolver = createTaskDependencyResolver({
    definitions: createDefinitions({ satisfied: new Set(["metaphor"]) }),
    queue,
  });

  const resolution = resolver.resolveAndEnqueue({ context, targets: ["metaphor"] });

  assert.equal(resolution.nodes.concepts.disposition, "created");
  assert.equal(resolution.nodes.metaphor.disposition, "created");
  assert.deepEqual(
    queue.getTask(resolution.nodes.metaphor.taskId).dependencies,
    [resolution.nodes.concepts.taskId],
  );
});

test("creates fresh work instead of fast-forwarding while a conflicting lock is active", () => {
  const queue = createTaskManagementQueue();
  const oldTask = queue.enqueueTask({
    callback: async () => {},
    dedupKey: "concepts:note-a.json:old-hash",
    deps: [],
    document: context.document,
    key: "old-concepts",
    lockKey: "concepts:note-a.json",
    type: "concepts",
  });
  const resolver = createTaskDependencyResolver({
    definitions: createDefinitions({ satisfied: new Set(["concepts"]) }),
    queue,
  });

  const resolution = resolver.resolveAndEnqueue({ context, targets: ["concepts"] });

  assert.equal(resolution.nodes.concepts.disposition, "created");
  assert.notEqual(resolution.nodes.concepts.taskId, oldTask.id);
  assert.deepEqual(
    queue.getActiveTasksByLockKey("concepts:note-a.json").map((task) => task.id),
    [oldTask.id, resolution.nodes.concepts.taskId],
  );
});

test("force bypasses persistence and exact active-task joining", () => {
  const queue = createTaskManagementQueue();
  const activeTask = queue.enqueueTask({
    callback: async () => {},
    dedupKey: "concepts:note-a.json:hash-1",
    deps: [],
    document: context.document,
    key: "active-concepts",
    lockKey: "concepts:note-a.json",
    type: "concepts",
  });
  const resolver = createTaskDependencyResolver({
    definitions: createDefinitions({ satisfied: new Set(["concepts"]) }),
    queue,
  });

  const resolution = resolver.resolveAndEnqueue({ context, force: ["concepts"], targets: ["concepts"] });
  const forcedTask = queue.getTask(resolution.nodes.concepts.taskId);

  assert.equal(resolution.nodes.concepts.disposition, "created");
  assert.notEqual(forcedTask.id, activeTask.id);
  assert.equal(forcedTask.allowDuplicate, true);
  assert.deepEqual(forcedTask.externalDependencies, []);
});

test("rejects definition cycles without inserting tasks", () => {
  const queue = createTaskManagementQueue();
  const resolver = createTaskDependencyResolver({
    definitions: {
      alpha: {
        callback: async () => {},
        createCallback: () => async () => {},
        dependencies: ["beta"],
        document: () => context.document,
      },
      beta: {
        createCallback: () => async () => {},
        dependencies: ["alpha"],
        document: () => context.document,
      },
    },
    queue,
  });

  assert.throws(
    () => resolver.resolveAndEnqueue({ context, targets: ["alpha"] }),
    (error) => error instanceof TaskDependencyResolutionError && error.code === "DEPENDENCY_CYCLE",
  );
  assert.deepEqual(queue.getTasksForDocument(context.document), []);
});

test("requires synchronous persisted-state checks", () => {
  const queue = createTaskManagementQueue();
  const definitions = createDefinitions();
  definitions.concepts.isSatisfied = async () => true;
  const resolver = createTaskDependencyResolver({ definitions, queue });

  assert.throws(
    () => resolver.resolveAndEnqueue({ context, targets: ["concepts"] }),
    (error) => error instanceof TaskDependencyResolutionError && error.code === "ASYNC_SATISFACTION_CHECK",
  );
  assert.deepEqual(queue.getTasksForDocument(context.document), []);
});

test("queue rejection leaves no partial resolver workflow", () => {
  const queue = createTaskManagementQueue();
  const definitions = createDefinitions();
  definitions.metaphor.key = () => "concepts";
  const resolver = createTaskDependencyResolver({ definitions, queue });

  assert.throws(() => resolver.resolveAndEnqueue({ context, targets: ["metaphor"] }));
  assert.deepEqual(queue.getTasksForDocument(context.document), []);
});