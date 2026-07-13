const { ChatOpenAI, OpenAIEmbeddings } = require("@langchain/openai");
const { getAiSettings, getEmbeddingSettings } = require("./aiSettings");
const { operationLog } = require("./operationLog");

const diagnosticTextLimit = 16_000;

function serializeDiagnosticValue(value, maxLength = diagnosticTextLimit) {
  if (value === undefined) return null;

  let serialized;
  try {
    serialized = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    serialized = String(value);
  }

  return serialized.length <= maxLength
    ? serialized
    : `${serialized.slice(0, maxLength)}\n[truncated ${serialized.length - maxLength} characters]`;
}

function summarizeToolCall(toolCall = {}) {
  return {
    args: serializeDiagnosticValue(toolCall.args, 12_000),
    error: serializeDiagnosticValue(toolCall.error, 4_000),
    id: toolCall.id || null,
    name: toolCall.name || null,
    type: toolCall.type || null,
  };
}

function summarizeStructuredOutputRaw(raw) {
  if (!raw) return null;

  return {
    additionalKwargs: serializeDiagnosticValue(raw.additional_kwargs, 12_000),
    content: serializeDiagnosticValue(raw.content),
    id: raw.id || null,
    invalidToolCalls: Array.isArray(raw.invalid_tool_calls)
      ? raw.invalid_tool_calls.map(summarizeToolCall)
      : [],
    responseMetadata: raw.response_metadata || null,
    toolCalls: Array.isArray(raw.tool_calls) ? raw.tool_calls.map(summarizeToolCall) : [],
    usageMetadata: raw.usage_metadata || null,
  };
}

function rawMessageText(raw) {
  if (typeof raw?.content === "string") return raw.content.trim();
  if (!Array.isArray(raw?.content)) return "";

  return raw.content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function jsonTextFromRawMessage(raw) {
  const content = rawMessageText(raw);
  if (!content) return "";

  const fencedMatch = content.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fencedMatch ? fencedMatch[1].trim() : content;
}

async function parseRawStructuredOutput(raw, schema) {
  const jsonText = jsonTextFromRawMessage(raw);
  if (!jsonText) return null;

  let value;
  try {
    value = JSON.parse(jsonText);
  } catch {
    return null;
  }

  const result = await schema.safeParseAsync(value);
  return result.success ? result.data : null;
}

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
  let data = response.parsed;

  if (data == null) {
    data = await parseRawStructuredOutput(response.raw, schema);
    operationLog("ai.structured_output.unparsed", {
      fallbackAccepted: data !== null,
      model: response.raw?.response_metadata?.model_name || config.model,
      raw: summarizeStructuredOutputRaw(response.raw),
      schemaName: schemaName || null,
    });
  }

  return {
    data,
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
  parseRawStructuredOutput,
  requestStructuredOutput,
  summarizeStructuredOutputRaw,
};
