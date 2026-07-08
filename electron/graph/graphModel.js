const { graphError, graphLog, startTimer } = require("./graphLog");

const graphPipelineVersion = "concept-resolver-v6";
const defaultGraphModel = "gpt-5.3-codex-spark";
const defaultGraphBaseUrl = "http://127.0.0.1:8317/v1";
const defaultProxyApiKey = "sk-cliproxy-michael-2026";
const defaultEmbeddingModel = "text-embedding-3-small";

function isLocalProxyBaseUrl(baseUrl) {
  return /^https?:\/\/(127\.0\.0\.1|localhost):8317(\/|$)/i.test(baseUrl);
}

function getGraphModelConfig() {
  const baseUrl = String(
    process.env.LEARNER_GRAPH_BASE_URL ||
      process.env.LEARNER_AI_BASE_URL ||
      process.env.OPENAI_BASE_URL ||
      defaultGraphBaseUrl,
  ).replace(/\/+$/g, "");
  const apiKey = isLocalProxyBaseUrl(baseUrl)
    ? process.env.LEARNER_GRAPH_API_KEY || process.env.LEARNER_AI_API_KEY || defaultProxyApiKey
    : process.env.LEARNER_GRAPH_API_KEY ||
      process.env.LEARNER_AI_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.LEARNER_OPENAI_API_KEY ||
      defaultProxyApiKey;

  return {
    apiKey: String(apiKey || "").trim(),
    baseUrl,
    cacheModel: `${String(process.env.LEARNER_GRAPH_MODEL || process.env.LEARNER_AI_MODEL || defaultGraphModel).trim()}:${graphPipelineVersion}`,
    model: String(process.env.LEARNER_GRAPH_MODEL || process.env.LEARNER_AI_MODEL || defaultGraphModel).trim(),
  };
}

function getGraphEmbeddingConfig() {
  return {
    apiKey: String(process.env.OPENAI_API_KEY || process.env.LEARNER_OPENAI_API_KEY || "").trim(),
    baseUrl: String(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/g, ""),
    model: String(process.env.LEARNER_GRAPH_EMBEDDING_MODEL || defaultEmbeddingModel).trim(),
  };
}

async function requestStructuredJson({ jsonSchema, messages, schemaName, temperature = 0.1, timeoutMs = 120_000 }) {
  const config = getGraphModelConfig();

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

async function requestConceptEmbeddings(input) {
  const config = getGraphEmbeddingConfig();
  const values = Array.isArray(input) ? input : [input];

  if (!config.apiKey) {
    throw new Error("OPENAI_API_KEY is not set for graph concept embeddings.");
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
