const { randomUUID } = require("crypto");

const terminalStatuses = new Set(["blocked", "completed", "failed"]);

class TaskQueueError extends Error {
    constructor(message, code, details = {}) {
        super(message);
        this.name = "TaskQueueError";
        this.code = code;
        this.details = details;
    }
}

function createTaskManagementQueue({ onListenerError = () => {} } = {}) {
    const tasks = new Map();
    const workflows = new Map();
    const runnableQueue = [];
    const dependents = new Map();
    const activeTaskIdsByDedupKey = new Map();
    const activeTaskIdsByLockKey = new Map();
    const listeners = new Set();

    function deduplicationKey(document, type) {
        return JSON.stringify([document, type]);
    }

    function serializeError(error) {
        if (error instanceof Error) {
            return {
                code: typeof error.code === "string" ? error.code : "TASK_FAILED",
                message: error.message,
                name: error.name,
                retryable: error.retryable === true,
                stack: error.stack || null,
            };
        }

        return {
            code: "TASK_FAILED",
            message: String(error),
            name: "Error",
            retryable: false,
            stack: null,
        };
    }

    function publicTask(task) {
        if (!task) return null;
        return {
            artifactKey: task.artifactKey,
            allowDuplicate: task.allowDuplicate,
            blockedBy: task.blockedBy,
            completedAt: task.completedAt,
            createdAt: task.createdAt,
            dedupKey: task.deduplicationKey,
            dependencies: [...task.dependencies],
            dependencyKeys: [...task.dependencyKeys],
            document: task.document,
            error: task.error ? { ...task.error } : null,
            externalDependencies: [...task.externalDependencies],
            id: task.id,
            key: task.key,
            lockKey: task.lockKey,
            pendingDependencies: [...task.pendingDependencies],
            progress: task.progress == null ? null : structuredClone(task.progress),
            startedAt: task.startedAt,
            status: task.status,
            type: task.type,
            updatedAt: task.updatedAt,
            workflowId: task.workflowId,
        };
    }

    function workflowStatus(taskIds) {
        const statuses = taskIds.map((taskId) => tasks.get(taskId)?.status);
        if (statuses.some((status) => status === "failed")) return "failed";
        if (statuses.every((status) => status === "completed")) return "completed";
        if (statuses.some((status) => status === "running")) return "running";
        if (statuses.some((status) => status === "queued")) return "queued";
        if (statuses.some((status) => status === "blocked")) return "blocked";
        return "pending";
    }

    function publicWorkflow(workflow) {
        if (!workflow) return null;
        return {
            createdAt: workflow.createdAt,
            id: workflow.id,
            status: workflowStatus(workflow.taskIds),
            taskIds: [...workflow.taskIds],
            tasks: workflow.taskIds.map((taskId) => publicTask(tasks.get(taskId))),
        };
    }

    function emitTaskChange(task) {
        const snapshot = publicTask(task);
        for (const listener of listeners) {
            try {
                listener(snapshot);
            } catch (error) {
                onListenerError(error);
            }
        }
    }

    function validateTaskShape(task, index) {
        if (!task || typeof task !== "object") {
            throw new TaskQueueError(`Task at index ${index} must be an object.`, "INVALID_TASK");
        }
        if (typeof task.key !== "string" || task.key.trim() === "") {
            throw new TaskQueueError(`Task at index ${index} must have a non-empty key.`, "INVALID_TASK");
        }
        if (typeof task.document !== "string" || task.document.trim() === "") {
            throw new TaskQueueError(`Task "${task.key}" must have a non-empty document.`, "INVALID_TASK");
        }
        if (typeof task.type !== "string" || task.type.trim() === "") {
            throw new TaskQueueError(`Task "${task.key}" must have a non-empty type.`, "INVALID_TASK");
        }
        if (!Array.isArray(task.deps)) {
            throw new TaskQueueError(`Task "${task.key}" must have a deps array.`, "INVALID_TASK");
        }
        if (task.externalDeps != null && !Array.isArray(task.externalDeps)) {
            throw new TaskQueueError(`Task "${task.key}" must have an externalDeps array.`, "INVALID_TASK");
        }
        if (task.allowDuplicate != null && typeof task.allowDuplicate !== "boolean") {
            throw new TaskQueueError(`Task "${task.key}" must have a boolean allowDuplicate.`, "INVALID_TASK");
        }
        for (const property of ["artifactKey", "dedupKey", "lockKey"]) {
            if (task[property] != null && (typeof task[property] !== "string" || task[property].trim() === "")) {
                throw new TaskQueueError(`Task "${task.key}" must have a non-empty ${property}.`, "INVALID_TASK");
            }
        }
        if (typeof task.callback !== "function") {
            throw new TaskQueueError(`Task "${task.key}" must have a callback.`, "INVALID_TASK");
        }
    }

    function assertAcyclic(preparedTasks) {
        const indegrees = new Map();
        const dependentKeys = new Map();

        for (const task of preparedTasks) {
            indegrees.set(task.key, task.dependencyKeys.length);
            dependentKeys.set(task.key, []);
        }

        for (const task of preparedTasks) {
            for (const dependencyKey of task.dependencyKeys) {
                dependentKeys.get(dependencyKey).push(task.key);
            }
        }

        const readyKeys = preparedTasks
            .filter((task) => indegrees.get(task.key) === 0)
            .map((task) => task.key);
        let visitedCount = 0;

        while (readyKeys.length > 0) {
            const taskKey = readyKeys.shift();
            visitedCount += 1;

            for (const dependentKey of dependentKeys.get(taskKey)) {
                const nextIndegree = indegrees.get(dependentKey) - 1;
                indegrees.set(dependentKey, nextIndegree);
                if (nextIndegree === 0) readyKeys.push(dependentKey);
            }
        }

        if (visitedCount !== preparedTasks.length) {
            throw new TaskQueueError("Task batch contains a dependency cycle.", "DEPENDENCY_CYCLE");
        }
    }

    function prepareBatch(submittedTasks) {
        if (!Array.isArray(submittedTasks) || submittedTasks.length === 0) {
            throw new TaskQueueError("enqueueTasks requires a non-empty task array.", "INVALID_BATCH");
        }

        const workflowId = randomUUID();
        const createdAt = Date.now();
        const taskIdsByKey = new Map();
        const batchDeduplicationKeys = new Set();

        submittedTasks.forEach((task, index) => {
            validateTaskShape(task, index);
            if (taskIdsByKey.has(task.key)) {
                throw new TaskQueueError(`Task key "${task.key}" is duplicated in the batch.`, "DUPLICATE_TASK_KEY", {
                    key: task.key,
                });
            }
            taskIdsByKey.set(task.key, randomUUID());
        });

        const preparedTasks = submittedTasks.map((task) => {
            const dependencyKeys = [...new Set(task.deps)];
            for (const dependencyKey of dependencyKeys) {
                if (!taskIdsByKey.has(dependencyKey)) {
                    throw new TaskQueueError(
                        `Task "${task.key}" has unknown dependency "${dependencyKey}".`,
                        "UNKNOWN_DEPENDENCY",
                        { dependencyKey, taskKey: task.key },
                    );
                }
                if (dependencyKey === task.key) {
                    throw new TaskQueueError(`Task "${task.key}" cannot depend on itself.`, "SELF_DEPENDENCY", {
                        taskKey: task.key,
                    });
                }
            }

            const externalDependencies = [];
            for (const dependencyId of new Set(task.externalDeps || [])) {
                const dependencyTask = tasks.get(dependencyId);
                if (!dependencyTask) {
                    throw new TaskQueueError(
                        `Task "${task.key}" has unknown external dependency "${dependencyId}".`,
                        "UNKNOWN_DEPENDENCY",
                        { dependencyId, taskKey: task.key },
                    );
                }
                if (dependencyTask.status === "failed" || dependencyTask.status === "blocked") {
                    throw new TaskQueueError(
                        `Task "${task.key}" depends on unsuccessful task "${dependencyId}".`,
                        "DEPENDENCY_FAILED",
                        { dependencyId, taskKey: task.key },
                    );
                }
                if (dependencyTask.status !== "completed") externalDependencies.push(dependencyId);
            }

            const taskDeduplicationKey = task.dedupKey || deduplicationKey(task.document, task.type);
            if (batchDeduplicationKeys.has(taskDeduplicationKey)) {
                throw new TaskQueueError(
                    `Task "${task.key}" has a duplicate deduplication key in the batch.`,
                    "DUPLICATE_TASK",
                    { dedupKey: taskDeduplicationKey, document: task.document, type: task.type },
                );
            }
            batchDeduplicationKeys.add(taskDeduplicationKey);

            const activeTaskIds = activeTaskIdsByDedupKey.get(taskDeduplicationKey);
            const activeTaskId = activeTaskIds ? [...activeTaskIds].at(-1) : null;
            if (activeTaskId && task.allowDuplicate !== true) {
                throw new TaskQueueError(
                    `Task type "${task.type}" is already queued or running for document "${task.document}".`,
                    "DUPLICATE_TASK",
                    { activeTaskId, dedupKey: taskDeduplicationKey, document: task.document, type: task.type },
                );
            }

            const dependencies = [
                ...dependencyKeys.map((dependencyKey) => taskIdsByKey.get(dependencyKey)),
                ...externalDependencies,
            ];
            return {
                allowDuplicate: task.allowDuplicate === true,
                artifactKey: task.artifactKey || taskDeduplicationKey,
                blockedBy: null,
                callback: task.callback,
                completedAt: null,
                createdAt,
                deduplicationKey: taskDeduplicationKey,
                dependencies,
                dependencyKeys,
                document: task.document,
                error: null,
                externalDependencies,
                id: taskIdsByKey.get(task.key),
                key: task.key,
                lockKey: task.lockKey || taskDeduplicationKey,
                pendingDependencies: new Set(dependencies),
                progress: null,
                result: undefined,
                startedAt: null,
                status: dependencies.length === 0 ? "queued" : "pending",
                type: task.type,
                updatedAt: createdAt,
                workflowId,
            };
        });

        assertAcyclic(preparedTasks);
        return { createdAt, preparedTasks, taskIdsByKey, workflowId };
    }

    function enqueueTasks(submittedTasks) {
        const preparedBatch = prepareBatch(submittedTasks);
        const workflow = {
            createdAt: preparedBatch.createdAt,
            id: preparedBatch.workflowId,
            taskIds: preparedBatch.preparedTasks.map((task) => task.id),
        };

        workflows.set(workflow.id, workflow);
        for (const task of preparedBatch.preparedTasks) {
            tasks.set(task.id, task);
            if (!activeTaskIdsByDedupKey.has(task.deduplicationKey)) {
                activeTaskIdsByDedupKey.set(task.deduplicationKey, new Set());
            }
            activeTaskIdsByDedupKey.get(task.deduplicationKey).add(task.id);
            if (!activeTaskIdsByLockKey.has(task.lockKey)) activeTaskIdsByLockKey.set(task.lockKey, new Set());
            activeTaskIdsByLockKey.get(task.lockKey).add(task.id);
            if (task.status === "queued") runnableQueue.push(task.id);

            for (const dependencyId of task.dependencies) {
                if (!dependents.has(dependencyId)) dependents.set(dependencyId, new Set());
                dependents.get(dependencyId).add(task.id);
            }
        }

        for (const task of preparedBatch.preparedTasks) emitTaskChange(task);

        return {
            taskIds: Object.fromEntries(preparedBatch.taskIdsByKey),
            workflow: publicWorkflow(workflow),
            workflowId: workflow.id,
        };
    }

    function enqueueTask(task) {
        const key = typeof task?.key === "string" && task.key.trim() !== "" ? task.key : task?.type;
        const result = enqueueTasks([{ ...task, key }]);
        return publicTask(tasks.get(result.taskIds[key]));
    }

    function releaseDeduplicationKey(task) {
        const deduplicatedTaskIds = activeTaskIdsByDedupKey.get(task.deduplicationKey);
        if (deduplicatedTaskIds) {
            deduplicatedTaskIds.delete(task.id);
            if (deduplicatedTaskIds.size === 0) activeTaskIdsByDedupKey.delete(task.deduplicationKey);
        }
        const lockTaskIds = activeTaskIdsByLockKey.get(task.lockKey);
        if (lockTaskIds) {
            lockTaskIds.delete(task.id);
            if (lockTaskIds.size === 0) activeTaskIdsByLockKey.delete(task.lockKey);
        }
    }

    function removeRunnableTask(taskId) {
        let taskIndex = runnableQueue.indexOf(taskId);
        while (taskIndex !== -1) {
            runnableQueue.splice(taskIndex, 1);
            taskIndex = runnableQueue.indexOf(taskId);
        }
    }

    function detachFromDependencies(task) {
        for (const dependencyId of task.dependencies) {
            const dependencyDependents = dependents.get(dependencyId);
            if (!dependencyDependents) continue;
            dependencyDependents.delete(task.id);
            if (dependencyDependents.size === 0) dependents.delete(dependencyId);
        }
    }

    function blockDependents(taskId, failedTaskId) {
        const dependentTaskIds = [...(dependents.get(taskId) || [])];
        dependents.delete(taskId);

        for (const dependentTaskId of dependentTaskIds) {
            const dependentTask = tasks.get(dependentTaskId);
            if (!dependentTask || terminalStatuses.has(dependentTask.status)) continue;

            removeRunnableTask(dependentTask.id);
            dependentTask.status = "blocked";
            dependentTask.blockedBy = failedTaskId;
            dependentTask.error = {
                code: "DEPENDENCY_FAILED",
                message: `Dependency task "${failedTaskId}" failed.`,
                name: "TaskDependencyError",
                retryable: true,
                stack: null,
            };
            dependentTask.completedAt = Date.now();
            dependentTask.updatedAt = dependentTask.completedAt;
            releaseDeduplicationKey(dependentTask);
            blockDependents(dependentTask.id, failedTaskId);
            detachFromDependencies(dependentTask);
            emitTaskChange(dependentTask);
        }
    }

    function resolveDependents(task) {
        const dependentTaskIds = [...(dependents.get(task.id) || [])];
        dependents.delete(task.id);

        for (const dependentTaskId of dependentTaskIds) {
            const dependentTask = tasks.get(dependentTaskId);
            if (!dependentTask || dependentTask.status !== "pending") continue;

            dependentTask.pendingDependencies.delete(task.id);
            dependentTask.updatedAt = Date.now();
            if (dependentTask.pendingDependencies.size === 0) {
                dependentTask.status = "queued";
                runnableQueue.push(dependentTask.id);
            }
            emitTaskChange(dependentTask);
        }
    }

    function nextRunnableTask() {
        while (runnableQueue.length > 0) {
            const task = tasks.get(runnableQueue.shift());
            if (task?.status === "queued") return task;
        }
        return null;
    }

    async function processNextTask() {
        const task = nextRunnableTask();
        if (!task) return null;

        task.status = "running";
        task.startedAt = Date.now();
        task.updatedAt = task.startedAt;
        emitTaskChange(task);

        try {
            task.result = await task.callback({
                task: publicTask(task),
                updateProgress: (progress) => updateTaskProgress(task.id, progress),
            });
            task.status = "completed";
            task.completedAt = Date.now();
            task.updatedAt = task.completedAt;
            releaseDeduplicationKey(task);
            resolveDependents(task);
        } catch (error) {
            task.status = "failed";
            task.error = serializeError(error);
            task.completedAt = Date.now();
            task.updatedAt = task.completedAt;
            releaseDeduplicationKey(task);
            blockDependents(task.id, task.id);
        }

        emitTaskChange(task);
        return publicTask(task);
    }

    function updateTaskProgress(taskId, progress) {
        const task = tasks.get(taskId);
        if (!task) {
            throw new TaskQueueError(`Unknown task "${taskId}".`, "UNKNOWN_TASK", { taskId });
        }
        if (task.status !== "running") {
            throw new TaskQueueError(`Task "${taskId}" is not running.`, "TASK_NOT_RUNNING", { taskId });
        }

        task.progress = structuredClone(progress);
        task.updatedAt = Date.now();
        emitTaskChange(task);
        return publicTask(task);
    }

    function getTask(taskId) {
        return publicTask(tasks.get(taskId));
    }

    function getActiveTaskByDedupKey(dedupKey) {
        const taskIds = activeTaskIdsByDedupKey.get(dedupKey);
        const taskId = taskIds ? [...taskIds].at(-1) : null;
        const task = taskId ? tasks.get(taskId) : null;
        return task && !terminalStatuses.has(task.status) ? publicTask(task) : null;
    }

    function getActiveTasksByDedupKey(dedupKey) {
        return [...(activeTaskIdsByDedupKey.get(dedupKey) || [])]
            .map((taskId) => tasks.get(taskId))
            .filter((task) => task && !terminalStatuses.has(task.status))
            .map(publicTask);
    }

    function getActiveTasksByLockKey(lockKey) {
        return [...(activeTaskIdsByLockKey.get(lockKey) || [])]
            .map((taskId) => tasks.get(taskId))
            .filter((task) => task && !terminalStatuses.has(task.status))
            .map(publicTask);
    }

    function getWorkflow(workflowId) {
        return publicWorkflow(workflows.get(workflowId));
    }

    function getTasksForDocument(document) {
        return [...tasks.values()]
            .filter((task) => task.document === document)
            .map(publicTask);
    }

    function getRunnableTasks() {
        return runnableQueue
            .map((taskId) => tasks.get(taskId))
            .filter((task) => task?.status === "queued")
            .map(publicTask);
    }

    function subscribe(listener) {
        if (typeof listener !== "function") {
            throw new TaskQueueError("Task queue listener must be a function.", "INVALID_LISTENER");
        }
        listeners.add(listener);
        return () => listeners.delete(listener);
    }

    return {
        enqueueTask,
        enqueueTasks,
        getActiveTaskByDedupKey,
        getActiveTasksByDedupKey,
        getActiveTasksByLockKey,
        getRunnableTasks,
        getTask,
        getTasksForDocument,
        getWorkflow,
        processNextTask,
        subscribe,
        updateTaskProgress,
    };
}

module.exports = { TaskQueueError, createTaskManagementQueue };