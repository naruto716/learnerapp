const { graphError, graphLog, startTimer } = require("./graphLog");
const { getAiSettings } = require("../aiSettings");

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
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: schemaName,
            strict: true,
            schema: jsonSchema,
          },
        },
        temperature,
        messages,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Graph model request failed (${response.status}): ${errorText.slice(0, 500)}`);
    }

    const body = await response.json();
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("Graph model returned an empty response.");
    }

    try {
      const parsed = JSON.parse(content);
      graphLog("llm.request.done", {
        durationMs: elapsed(),
        model: body?.model || config.model,
        promptTokens: body?.usage?.prompt_tokens,
        completionTokens: body?.usage?.completion_tokens,
        reasoningTokens: body?.usage?.completion_tokens_details?.reasoning_tokens,
        schemaName,
        totalTokens: body?.usage?.total_tokens,
      });
      return parsed;
    } catch {
      throw new Error("Graph model response was not valid JSON.");
    }
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
    const response = await fetch(`${config.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: values,
        model: config.model,
      }),
      signal: AbortSignal.timeout(45_000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Graph embedding request failed (${response.status}): ${errorText.slice(0, 300)}`);
    }

    const body = await response.json();
    if (!Array.isArray(body.data)) {
      throw new Error("Graph embedding response did not include a data array.");
    }

    const embeddings = body.data
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((item) => item.embedding);

    graphLog("embedding.request.done", {
      count: embeddings.length,
      dimensions: embeddings[0]?.length ?? 0,
      durationMs: elapsed(),
      model: config.model,
      promptTokens: body?.usage?.prompt_tokens,
      totalTokens: body?.usage?.total_tokens,
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
