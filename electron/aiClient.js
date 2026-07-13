const { ChatOpenAI, OpenAIEmbeddings } = require("@langchain/openai");
const { getAiSettings, getEmbeddingSettings } = require("./aiSettings");

function modelSettings(settings = {}, modelKey = "chatModel") {
  const aiSettings = getAiSettings(settings);
  const model = aiSettings[modelKey] || aiSettings.chatModel;

  return {
    apiKey: aiSettings.apiKey,
    baseUrl: aiSettings.baseUrl,
    model,
  };
}

function assertConfigured(config, label) {
  if (!config.apiKey) {
    throw new Error(`${label} API key is not configured in settings.`);
  }
  if (!config.baseUrl) {
    throw new Error(`${label} base URL is not configured in settings.`);
  }
}

function openAiClientConfiguration(config) {
  return {
    baseURL: config.baseUrl,
  };
}

function createChatModel({
  modelKey = "chatModel",
  model,
  settings = {},
  temperature = 0.1,
  timeoutMs = 120_000,
} = {}) {
  const config = model
    ? {
        ...modelSettings(settings, modelKey),
        model,
      }
    : modelSettings(settings, modelKey);

  assertConfigured(config, "AI chat model");

  return {
    config,
    model: new ChatOpenAI({
      apiKey: config.apiKey,
      configuration: openAiClientConfiguration(config),
      model: config.model,
      temperature,
      timeout: timeoutMs,
    }),
  };
}

function normalizeMessages(messages = []) {
  return messages.map((message) => {
    const role = message.role === "assistant" ? "assistant" : message.role === "system" ? "system" : "human";
    return [role, String(message.content || "")];
  });
}

async function requestStructuredOutput({
  messages,
  model,
  modelKey = "chatModel",
  schema,
  schemaName,
  settings = {},
  strict = true,
  temperature = 0.1,
  timeoutMs = 120_000,
} = {}) {
  const { config, model: chatModel } = createChatModel({
    model,
    modelKey,
    settings,
    temperature,
    timeoutMs,
  });

  const runnable = chatModel.withStructuredOutput(schema, {
    includeRaw: true,
    method: "jsonSchema",
    name: schemaName,
    strict,
  });
  const response = await runnable.invoke(normalizeMessages(messages));

  return {
    data: response.parsed,
    metadata: response.raw?.response_metadata || response.raw?.usage_metadata || null,
    model: response.raw?.response_metadata?.model_name || config.model,
  };
}

function createEmbeddingModel({ model, settings = {}, timeoutMs = 45_000 } = {}) {
  const config = {
    ...getEmbeddingSettings(settings),
    ...(model ? { model } : {}),
  };

  assertConfigured(config, "AI embedding model");

  return {
    config,
    model: new OpenAIEmbeddings({
      apiKey: config.apiKey,
      configuration: openAiClientConfiguration(config),
      model: config.model,
      timeout: timeoutMs,
    }),
  };
}

async function embedTexts(input, { model, settings = {}, timeoutMs = 45_000 } = {}) {
  const values = Array.isArray(input) ? input : [input];
  if (values.length === 0) return [];

  const { config, model: embeddingModel } = createEmbeddingModel({
    model,
    settings,
    timeoutMs,
  });

  try {
    return {
      embeddings: await embeddingModel.embedDocuments(values),
      model: config.model,
    };
  } catch (error) {
    const status = Number(error?.status || error?.response?.status || 0);
    const reason = error instanceof Error ? error.message : String(error);
    const guidance = status === 404
      ? "The official OpenAI endpoint does not expose the configured embedding model. Check OPENAI_BASE_URL and the embedding model."
      : "Check OPENAI_API_KEY, OPENAI_BASE_URL, the embedding model, and network availability.";
    throw new Error(
      `Embedding request failed for ${config.model} at ${config.baseUrl} (${status || "unknown status"}): ${reason}. ${guidance}`,
      { cause: error },
    );
  }
}

module.exports = {
  createChatModel,
  createEmbeddingModel,
  embedTexts,
  requestStructuredOutput,
};
