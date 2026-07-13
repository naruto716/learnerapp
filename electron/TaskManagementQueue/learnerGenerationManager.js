const crypto = require("crypto");
const { getAiSettings } = require("../aiSettings");
const { operationLog } = require("../operationLog");
const { readDocumentFile } = require("../documentUtil");
const { extractDocumentGraph } = require("../graph/graphExtraction");
const { getDocumentGraph, getExtractionRun, hashContent } = require("../graph/graphDb");
const { getGraphModelConfig } = require("../graph/graphModel");
const {
  generateDocumentMastery,
  generateDocumentMasteryMetaphor,
  getDocumentMastery,
} = require("../mastery/masteryConcepts");
const {
  generateDocumentMasteryCards,
  getDocumentMasteryCards,
} = require("../mastery/masteryCards");
const { createTaskDependencyResolver } = require("./taskDependencyResolver");
const { createTaskManagementQueue } = require("./taskMgmtQueue");
const { createTaskWorker } = require("./taskWorker");

const taskTypes = {
  cards: "mastery.cards",
  concepts: "mastery.concepts",
  graph: "graph.extract",
  metaphor: "mastery.metaphor",
};

const operationLabels = {
  [taskTypes.cards]: "flashcard generation",
  [taskTypes.concepts]: "mastery concept generation",
  [taskTypes.graph]: "knowledge graph generation",
  [taskTypes.metaphor]: "metaphor generation",
};

function latestTasksByType(tasks) {
  const latestByType = new Map();
  for (const task of tasks) {
    const current = latestByType.get(task.type);
    const taskIsActive = ["pending", "queued", "running"].includes(task.status);
    const currentIsActive = current && ["pending", "queued", "running"].includes(current.status);
    if (!current || (taskIsActive && !currentIsActive) || taskIsActive === currentIsActive && task.updatedAt > current.updatedAt) {
      latestByType.set(task.type, task);
    }
  }
  return [...latestByType.values()];
}

function generationDependencies(type, context = {}) {
  if (type === taskTypes.concepts) return [];
  if (type === taskTypes.graph) {
    return context.requireConceptsForGraph ? [taskTypes.concepts] : [];
  }
  if (type === taskTypes.metaphor) return [taskTypes.concepts];
  if (type === taskTypes.cards) {
    return [
      taskTypes.concepts,
      taskTypes.graph,
      ...(context.requireMetaphorForCards ? [taskTypes.metaphor] : []),
    ];
  }
  throw new Error(`Unknown generation task type "${type}".`);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function fingerprint(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function createLearnerGenerationManager({ onTaskChange = () => {}, workerConcurrency = 4 } = {}) {
  const queue = createTaskManagementQueue({
    onListenerError: (error) => {
      operationLog("generation.task_listener_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    },
  });
  const worker = createTaskWorker({
    concurrency: workerConcurrency,
    onError: (error, task) => {
      operationLog("generation.worker_failed", {
        error: error instanceof Error ? error.message : String(error),
        taskId: task.id,
        type: task.type,
      });
    },
    queue,
  });

  function documentLockKey(context) {
    return `document:${context.documentPath}`;
  }

  function reportDocumentProgress(updateProgress, documentPath) {
    return (progress) => updateProgress({ ...progress, documentPath });
  }

  function loggedCallback(type, callback) {
    return async (controls) => {
      const startedAt = Date.now();
      operationLog("ai.operation.started", {
        key: controls.task.lockKey,
        operation: operationLabels[type],
        taskId: controls.task.id,
        type,
      });
      try {
        const result = await callback(controls);
        operationLog("ai.operation.completed", {
          durationMs: Date.now() - startedAt,
          key: controls.task.lockKey,
          operation: operationLabels[type],
          taskId: controls.task.id,
          type,
        });
        return result;
      } catch (error) {
        operationLog("ai.operation.failed", {
          durationMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
          key: controls.task.lockKey,
          operation: operationLabels[type],
          taskId: controls.task.id,
          type,
        });
        throw error;
      }
    };
  }

  const definitions = {
    [taskTypes.concepts]: {
      artifactKey: (context) => `${taskTypes.concepts}:${context.documentPath}:${context.documentHash}`,
      createCallback: (context) => loggedCallback(taskTypes.concepts, () =>
        generateDocumentMastery({
          documentPath: context.documentPath,
          force: context.forceConcepts,
          markdown: context.markdown,
          settings: context.settings,
        })),
      dedupKey: (context) => `${taskTypes.concepts}:${context.documentPath}:${fingerprint({
        documentHash: context.documentHash,
        graphModel: context.settings.graphModel,
      })}`,
      dependencies: (context) => generationDependencies(taskTypes.concepts, context),
      document: (context) => context.documentPath,
      isSatisfied: (context) => {
        const mastery = getDocumentMastery(context.documentPath, context.markdown);
        return mastery.concepts.length > 0 && !mastery.stale;
      },
      key: () => taskTypes.concepts,
      lockKey: documentLockKey,
    },
    [taskTypes.graph]: {
      artifactKey: (context) => `${taskTypes.graph}:${context.documentPath}:${context.documentHash}`,
      createCallback: (context) => loggedCallback(taskTypes.graph, async ({ updateProgress }) => {
        updateProgress({ completed: 0, failed: 0, label: "Extracting knowledge graph", total: 1 });
        try {
          const result = await extractDocumentGraph(
            context.documentPath,
            await readDocumentFile(context.documentPath),
            context.markdown,
            context.settings,
          );
          updateProgress({
            completed: 1,
            failed: 0,
            label: result.extracted ? "Graph updated" : "Graph already current",
            total: 1,
          });
          return result;
        } catch (error) {
          updateProgress({ completed: 1, failed: 1, label: "Graph extraction failed", total: 1 });
          throw error;
        }
      }),
      dedupKey: (context) => `${taskTypes.graph}:${context.documentPath}:${fingerprint({
        cacheModel: getGraphModelConfig(context.settings).cacheModel,
        documentHash: context.documentHash,
      })}`,
      dependencies: (context) => generationDependencies(taskTypes.graph, context),
      document: (context) => context.documentPath,
      isSatisfied: (context) => {
        const run = getExtractionRun(context.documentPath);
        const graph = getDocumentGraph(context.documentPath);
        return run?.document_hash === context.documentHash
          && run?.model === getGraphModelConfig(context.settings).cacheModel
          && graph.nodes.length > 0;
      },
      key: () => taskTypes.graph,
      lockKey: documentLockKey,
    },
    [taskTypes.metaphor]: {
      artifactKey: (context) => `${taskTypes.metaphor}:${context.documentPath}:${context.documentHash}`,
      createCallback: (context) => loggedCallback(taskTypes.metaphor, async ({ updateProgress }) => {
        const onProgress = reportDocumentProgress(updateProgress, context.documentPath);
        try {
          return await generateDocumentMasteryMetaphor({
            documentPath: context.documentPath,
            markdown: context.markdown,
            onProgress,
            settings: context.settings,
          });
        } catch (error) {
          onProgress({
            completed: 0,
            failed: 1,
            label: error instanceof Error ? error.message : "Mastery metaphor generation failed.",
            phase: "error",
            total: 1,
          });
          throw error;
        }
      }),
      dedupKey: (context) => `${taskTypes.metaphor}:${context.documentPath}:${fingerprint({
        documentHash: context.documentHash,
        graphModel: context.settings.graphModel,
        imageBackground: context.settings.imageBackground,
        imageModel: context.settings.imageModel,
        imageOutputFormat: context.settings.imageOutputFormat,
        imageQuality: context.settings.imageQuality,
        imageSize: context.settings.imageSize,
      })}`,
      dependencies: (context) => generationDependencies(taskTypes.metaphor, context),
      document: (context) => context.documentPath,
      isSatisfied: (context) => {
        const mastery = getDocumentMastery(context.documentPath, context.markdown);
        return Boolean(mastery.metaphor && !mastery.metaphor.stale);
      },
      key: () => taskTypes.metaphor,
      lockKey: documentLockKey,
    },
    [taskTypes.cards]: {
      artifactKey: (context) => `${taskTypes.cards}:${context.documentPath}:${context.documentHash}`,
      createCallback: (context) => loggedCallback(taskTypes.cards, async ({ updateProgress }) => {
        const onProgress = reportDocumentProgress(updateProgress, context.documentPath);
        try {
          return await generateDocumentMasteryCards({
            ...context.cardRequest,
            documentPath: context.documentPath,
            markdown: context.markdown,
            onProgress,
            settings: context.settings,
          });
        } catch (error) {
          onProgress({
            completed: 0,
            label: error instanceof Error ? error.message : "Flashcard generation failed.",
            phase: "error",
            total: 1,
          });
          throw error;
        }
      }),
      dedupKey: (context) => `${taskTypes.cards}:${context.documentPath}:${fingerprint({
        baseUrl: context.settings.baseUrl,
        chatModel: context.settings.chatModel,
        documentHash: context.documentHash,
        generationPrompt: context.cardRequest.generationPrompt,
        masterySettings: context.cardRequest.masterySettings,
        minimumReadyCards: context.cardRequest.minimumReadyCards,
        targetProficiency: context.cardRequest.targetProficiency,
      })}`,
      dependencies: (context) => generationDependencies(taskTypes.cards, context),
      document: (context) => context.documentPath,
      isSatisfied: (context) => {
        if (!context.allowPersistedCards) return false;
        const state = getDocumentMasteryCards(context.documentPath);
        const readyCardCount = state.cards.filter((card) => card.status === "active").length;
        if (context.cardRequest.minimumReadyCards !== undefined) {
          return readyCardCount >= Math.max(0, Number(context.cardRequest.minimumReadyCards) || 0);
        }
        return state.cards.length > 0;
      },
      key: () => taskTypes.cards,
      lockKey: documentLockKey,
    },
  };

  const resolver = createTaskDependencyResolver({ definitions, queue });
  queue.subscribe(onTaskChange);

  function documentContext({ documentPath, markdown = "", settings = {}, ...rest }) {
    const normalizedMarkdown = String(markdown || "");
    return {
      ...rest,
      document: documentPath,
      documentHash: hashContent(normalizedMarkdown),
      documentPath,
      markdown: normalizedMarkdown,
      settings: getAiSettings(settings),
    };
  }

  function persistedResult(type, context) {
    if (type === taskTypes.concepts) {
      return { generated: false, mastery: getDocumentMastery(context.documentPath, context.markdown) };
    }
    if (type === taskTypes.metaphor) return getDocumentMastery(context.documentPath, context.markdown);
    if (type === taskTypes.graph) return { extracted: false, graph: getDocumentGraph(context.documentPath) };
    if (type === taskTypes.cards) return getDocumentMasteryCards(context.documentPath);
    throw new Error(`Unsupported generation task type "${type}".`);
  }

  function resultFromResolution(resolution, type, context) {
    const node = resolution.nodes[type];
    return node.disposition === "persisted"
      ? Promise.resolve(persistedResult(type, context))
      : queue.waitForTask(node.taskId);
  }

  function resolveResult(type, context, force = []) {
    const resolution = resolver.resolveAndEnqueue({ context, force, targets: [type] });
    worker.pump();
    return resultFromResolution(resolution, type, context);
  }

  function generateConcepts(request) {
    const context = documentContext({ ...request, forceConcepts: request.force === true });
    return resolveResult(taskTypes.concepts, context, request.force === true ? [taskTypes.concepts] : []);
  }

  function generateMetaphor(request) {
    return resolveResult(taskTypes.metaphor, documentContext(request), [taskTypes.metaphor]);
  }

  function generateCards(request) {
    const context = documentContext({
      ...request,
      cardRequest: request,
      requireMetaphorForCards: false,
    });
    return resolveResult(taskTypes.cards, context);
  }

  function extractGraph(documentPath, markdown, settings) {
    return resolveResult(taskTypes.graph, documentContext({ documentPath, markdown, settings }));
  }

  async function generateMasteryAssets(request) {
    const context = documentContext({
      ...request,
      allowPersistedCards: true,
      cardRequest: request.cardRequest,
      forceConcepts: request.force === true,
      requireConceptsForGraph: true,
      requireMetaphorForCards: true,
    });
    const force = request.force === true
      ? [taskTypes.concepts, taskTypes.graph, taskTypes.metaphor, taskTypes.cards]
      : [];
    const resolution = resolver.resolveAndEnqueue({ context, force, targets: [taskTypes.cards] });
    worker.pump();
    return resultFromResolution(resolution, taskTypes.concepts, context);
  }

  function listDocumentTasks(documentPath) {
    return queue.getTasksForDocument(documentPath);
  }

  function latestDocumentTask(documentPath) {
    return listDocumentTasks(documentPath)
      .sort((left, right) => {
        const leftActive = ["pending", "queued", "running"].includes(left.status) ? 1 : 0;
        const rightActive = ["pending", "queued", "running"].includes(right.status) ? 1 : 0;
        return rightActive - leftActive || right.updatedAt - left.updatedAt;
      })[0] || null;
  }

  function latestDocumentTasks(documentPath) {
    return latestTasksByType(listDocumentTasks(documentPath));
  }

  return {
    extractGraph,
    generateCards,
    generateConcepts,
    generateMasteryAssets,
    generateMetaphor,
    latestDocumentTask,
    latestDocumentTasks,
    operationLabels,
    start: () => worker.start(),
    stop: (options) => worker.stop(options),
    taskTypes,
  };
}

module.exports = {
  createLearnerGenerationManager,
  generationDependencies,
  latestTasksByType,
  operationLabels,
  taskTypes,
};