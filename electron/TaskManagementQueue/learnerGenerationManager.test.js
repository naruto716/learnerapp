const assert = require("node:assert/strict");
const test = require("node:test");
const {
  generationDependencies,
  latestTasksByType,
  taskTypes,
} = require("./learnerGenerationManager");

test("defines the production four-stage Mastery workflow", () => {
  const context = {
    requireConceptsForGraph: true,
    requireMetaphorForCards: true,
  };

  assert.deepEqual(generationDependencies(taskTypes.concepts, context), []);
  assert.deepEqual(generationDependencies(taskTypes.graph, context), [taskTypes.concepts]);
  assert.deepEqual(generationDependencies(taskTypes.metaphor, context), [taskTypes.concepts]);
  assert.deepEqual(generationDependencies(taskTypes.cards, context), [
    taskTypes.concepts,
    taskTypes.graph,
    taskTypes.metaphor,
  ]);
});

test("keeps manual graph and card requests scoped to their required prerequisites", () => {
  assert.deepEqual(generationDependencies(taskTypes.graph), []);
  assert.deepEqual(generationDependencies(taskTypes.cards), [taskTypes.concepts, taskTypes.graph]);
});

test("restores the latest active task for every document workflow type", () => {
  const tasks = [
    { id: "old-metaphor", status: "failed", type: taskTypes.metaphor, updatedAt: 30 },
    { id: "running-metaphor", status: "running", type: taskTypes.metaphor, updatedAt: 20 },
    { id: "completed-concepts", status: "completed", type: taskTypes.concepts, updatedAt: 10 },
    { id: "queued-cards", status: "queued", type: taskTypes.cards, updatedAt: 40 },
  ];

  assert.deepEqual(
    latestTasksByType(tasks).map((task) => task.id).sort(),
    ["completed-concepts", "queued-cards", "running-metaphor"],
  );
});