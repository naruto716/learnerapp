const { randomUUID } = require("crypto");

class TaskDependencyResolutionError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = "TaskDependencyResolutionError";
    this.code = code;
    this.details = details;
  }
}

function createTaskDependencyResolver({ definitions, queue }) {
  if (!queue || typeof queue.enqueueTasks !== "function") {
    throw new TaskDependencyResolutionError("A task management queue is required.", "INVALID_QUEUE");
  }

  const taskDefinitions = definitions instanceof Map ? new Map(definitions) : new Map(Object.entries(definitions || {}));
  const resolutions = new Map();

  function definitionFor(type) {
    const definition = taskDefinitions.get(type);
    if (!definition) {
      throw new TaskDependencyResolutionError(`Unknown task type "${type}".`, "UNKNOWN_TASK_TYPE", { type });
    }
    return definition;
  }

  function taskDependencies(definition, context) {
    const dependencies = typeof definition.dependencies === "function"
      ? definition.dependencies(context)
      : definition.dependencies || [];
    if (!Array.isArray(dependencies) || dependencies.some((dependency) => typeof dependency !== "string")) {
      throw new TaskDependencyResolutionError("Task dependencies must be an array of task type strings.", "INVALID_DEFINITION");
    }
    return [...new Set(dependencies)];
  }

  function taskKey(definition, type, context) {
    const key = typeof definition.key === "function" ? definition.key(context) : type;
    if (typeof key !== "string" || key.trim() === "") {
      throw new TaskDependencyResolutionError(`Task type "${type}" produced an invalid key.`, "INVALID_DEFINITION");
    }
    return key;
  }

  function requiredString(definition, property, type, context, fallback) {
    const value = typeof definition[property] === "function" ? definition[property](context) : definition[property] ?? fallback;
    if (typeof value !== "string" || value.trim() === "") {
      throw new TaskDependencyResolutionError(
        `Task type "${type}" produced an invalid ${property}.`,
        "INVALID_DEFINITION",
        { property, type },
      );
    }
    return value;
  }

  function artifactIsSatisfied(definition, context) {
    if (definition.isSatisfied == null) return false;
    if (typeof definition.isSatisfied !== "function") {
      throw new TaskDependencyResolutionError("Task isSatisfied must be a function.", "INVALID_DEFINITION");
    }
    const satisfied = definition.isSatisfied(context);
    if (satisfied instanceof Promise) {
      throw new TaskDependencyResolutionError(
        "Task isSatisfied must be synchronous so resolution and queue insertion remain atomic.",
        "ASYNC_SATISFACTION_CHECK",
      );
    }
    return satisfied === true;
  }

  function callbackFor(definition, context) {
    if (typeof definition.createCallback !== "function") {
      throw new TaskDependencyResolutionError("Task createCallback must be a function.", "INVALID_DEFINITION");
    }
    const callback = definition.createCallback(context);
    if (typeof callback !== "function") {
      throw new TaskDependencyResolutionError("Task createCallback must return a function.", "INVALID_DEFINITION");
    }
    return callback;
  }

  function normalizedForce(force) {
    if (force == null) return new Set();
    if (!Array.isArray(force) || force.some((type) => typeof type !== "string")) {
      throw new TaskDependencyResolutionError("force must be an array of task type strings.", "INVALID_REQUEST");
    }
    return new Set(force);
  }

  function publicResolution(resolution) {
    if (!resolution) return null;
    return {
      createdAt: resolution.createdAt,
      id: resolution.id,
      nodes: Object.fromEntries(
        [...resolution.nodes].map(([type, node]) => [type, { ...node }]),
      ),
      targets: [...resolution.targets],
      workflowId: resolution.workflowId,
    };
  }

  function resolveAndEnqueue({ context, force, targets }) {
    if (!Array.isArray(targets) || targets.length === 0 || targets.some((type) => typeof type !== "string")) {
      throw new TaskDependencyResolutionError("targets must be a non-empty array of task type strings.", "INVALID_REQUEST");
    }

    const forcedTypes = normalizedForce(force);
    const resolutionId = randomUUID();
    const nodes = new Map();
    const preparedTasks = [];
    const visiting = [];

    function resolveType(type) {
      if (nodes.has(type)) return nodes.get(type);
      if (visiting.includes(type)) {
        const cycleStart = visiting.indexOf(type);
        const cycle = [...visiting.slice(cycleStart), type];
        throw new TaskDependencyResolutionError(
          `Task definitions contain a dependency cycle: ${cycle.join(" -> ")}.`,
          "DEPENDENCY_CYCLE",
          { cycle },
        );
      }

      const definition = definitionFor(type);
      const key = taskKey(definition, type, context);
      const document = requiredString(definition, "document", type, context, context?.document);
      const artifactKey = requiredString(definition, "artifactKey", type, context, `${document}:${type}`);
      const dedupKey = requiredString(definition, "dedupKey", type, context, artifactKey);
      const lockKey = requiredString(definition, "lockKey", type, context, artifactKey);
      const isForced = forcedTypes.has(type);

      if (!isForced) {
        const activeTask = queue.getActiveTaskByDedupKey(dedupKey);
        if (activeTask) {
          const node = { artifactKey, dedupKey, disposition: "joined", lockKey, taskId: activeTask.id };
          nodes.set(type, node);
          return node;
        }
      }

      visiting.push(type);
      const dependencyTypes = taskDependencies(definition, context);
      const dependencyNodes = dependencyTypes.map(resolveType);
      visiting.pop();

      const activeLockTasks = queue.getActiveTasksByLockKey(lockKey);
      const dependenciesArePersisted = dependencyNodes.every((node) => node.disposition === "persisted");
      if (
        !isForced &&
        activeLockTasks.length === 0 &&
        dependenciesArePersisted &&
        artifactIsSatisfied(definition, context)
      ) {
        const node = { artifactKey, dedupKey, disposition: "persisted", lockKey, taskId: null };
        nodes.set(type, node);
        return node;
      }

      const localDependencies = [];
      const externalDependencies = [];
      for (const dependencyNode of dependencyNodes) {
        if (dependencyNode.disposition === "created") localDependencies.push(dependencyNode.taskKey);
        if (dependencyNode.disposition === "joined") externalDependencies.push(dependencyNode.taskId);
      }

      const task = {
        allowDuplicate: isForced,
        artifactKey,
        callback: callbackFor(definition, context),
        dedupKey,
        deps: [...new Set(localDependencies)],
        document,
        externalDeps: [...new Set(externalDependencies)],
        key,
        lockKey,
        type,
      };
      const node = { artifactKey, dedupKey, disposition: "created", lockKey, taskId: null, taskKey: key };
      nodes.set(type, node);
      preparedTasks.push(task);
      return node;
    }

    const uniqueTargets = [...new Set(targets)];
    uniqueTargets.forEach(resolveType);

    let workflowId = null;
    if (preparedTasks.length > 0) {
      const queued = queue.enqueueTasks(preparedTasks);
      workflowId = queued.workflowId;
      for (const node of nodes.values()) {
        if (node.disposition === "created") node.taskId = queued.taskIds[node.taskKey];
      }
    }

    const resolution = {
      createdAt: Date.now(),
      id: resolutionId,
      nodes,
      targets: uniqueTargets,
      workflowId,
    };
    resolutions.set(resolution.id, resolution);
    return publicResolution(resolution);
  }

  function getResolution(resolutionId) {
    return publicResolution(resolutions.get(resolutionId));
  }

  return { getResolution, resolveAndEnqueue };
}

module.exports = { TaskDependencyResolutionError, createTaskDependencyResolver };