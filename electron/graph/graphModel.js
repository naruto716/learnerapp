const { graphError, graphLog, startTimer } = require("./graphLog");
const { getAiSettings } = require("../aiSettings");
const { embedTexts, requestStructuredOutput } = require("../aiClient");

const graphPipelineVersion = "concept-resolver-v6";

function getGraphModelConfig(settings = {}) {
  const aiSettings = getAiSettings(settings);
  const model = aiSettings.graphModel;

  return {
    apiKey: aiSettings.apiKey,
    baseUrl: aiSettings.baseUrl,
    cacheModel: `${model}:${graphPipelineVersion}`,
    model,
  };
}

function getGraphEmbeddingConfig(settings = {}) {
  const aiSettings = getAiSettings(settings);

  return {
    apiKey: aiSettings.apiKey,
    baseUrl: aiSettings.baseUrl,
    model: aiSettings.embeddingModel,
  };
}

async function requestStructuredJson({ jsonSchema, messages, schemaName, settings, temperature = 0.1, timeoutMs = 120_000 }) {
  const config = getGraphModelConfig(settings);

  if (!config.apiKey) {
    throw new Error("Graph extraction API key is not configured.");
  }

  const elapsed = startTimer();
  graphLog("llm.request.start", {
    baseUrl: config.baseUrl,
    messageCount: messages.length,
    model: config.model,
    schemaName,
    temperature,
  });

  try {
    const response = await requestStructuredOutput({
      messages,
      model: config.model,
      modelKey: "graphModel",
      schema: jsonSchema,
      schemaName,
      settings,
      strict: true,
      temperature,
      timeoutMs,
    });
    graphLog("llm.request.done", {
      durationMs: elapsed(),
      model: response.model,
      schemaName,
    });
    return response.data;
  } catch (error) {
    graphError("llm.request.failed", error, {
      durationMs: elapsed(),
      model: config.model,
      schemaName,
    });
    throw error;
  }
}

async function requestConceptEmbeddings(input, settings) {
  const config = getGraphEmbeddingConfig(settings);
  const values = Array.isArray(input) ? input : [input];

  if (!config.apiKey) {
    throw new Error("AI API key is not configured in settings for graph concept embeddings.");
  }

  if (values.length === 0) return [];

  const elapsed = startTimer();
  graphLog("embedding.request.start", {
    count: values.length,
    model: config.model,
  });

  try {
    const { embeddings, model } = await embedTexts(values, {
      model: config.model,
      settings,
      timeoutMs: 45_000,
    });

    graphLog("embedding.request.done", {
      count: embeddings.length,
      dimensions: embeddings[0]?.length ?? 0,
      durationMs: elapsed(),
      model,
    });

    return embeddings;
  } catch (error) {
    graphError("embedding.request.failed", error, {
      count: values.length,
      durationMs: elapsed(),
      model: config.model,
    });
    throw error;
  }
}

module.exports = {
  getGraphEmbeddingConfig,
  getGraphModelConfig,
  requestConceptEmbeddings,
  requestStructuredJson,
};
