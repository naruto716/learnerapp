const defaultAiSettings = {
  apiKey: "sk-cliproxy-michael-2026",
  baseUrl: "http://127.0.0.1:8317/v1",
  chatModel: "gpt-5.6-sol",
  graphModel: "gpt-5.3-codex-spark",
  openAiApiKey: String(process.env.OPENAI_API_KEY || process.env.LEARNER_OPENAI_API_KEY || "").trim(),
  embeddingModel: "text-embedding-3-small",
  imageModel: "gpt-image-2",
  imageSize: "1024x1024",
  imageQuality: "low",
  imageBackground: "opaque",
  imageOutputFormat: "png",
  imageConcurrency: "8",
  speechToTextApiKey: String(process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_LABS_API_KEY || "").trim(),
  speechToTextLanguage: "eng",
  speechToTextModel: "scribe_v2",
  userProfile: "",
};

let runtimeAiSettings = { ...defaultAiSettings };

function cleanSetting(value, fallback) {
  return String(value || "").trim() || fallback;
}

function normalizeBaseUrl(baseUrl) {
  return cleanSetting(baseUrl, defaultAiSettings.baseUrl).replace(/\/+$/g, "");
}

function normalizeIntegerSetting(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(value || ""), 10);
  const fallbackValue = Number.parseInt(String(fallback), 10);
  return String(Math.min(maximum, Math.max(minimum, Number.isFinite(parsed) ? parsed : fallbackValue)));
}

function normalizeAiSettings(settings = {}) {
  return {
    apiKey: cleanSetting(settings.apiKey, defaultAiSettings.apiKey),
    baseUrl: normalizeBaseUrl(settings.baseUrl),
    chatModel: cleanSetting(settings.chatModel, defaultAiSettings.chatModel),
    graphModel: cleanSetting(settings.graphModel, defaultAiSettings.graphModel),
    openAiApiKey: cleanSetting(settings.openAiApiKey, defaultAiSettings.openAiApiKey),
    embeddingModel: cleanSetting(settings.embeddingModel, defaultAiSettings.embeddingModel),
    imageModel: cleanSetting(settings.imageModel, defaultAiSettings.imageModel),
    imageSize: cleanSetting(settings.imageSize, defaultAiSettings.imageSize),
    imageQuality: cleanSetting(settings.imageQuality, defaultAiSettings.imageQuality),
    imageBackground: cleanSetting(settings.imageBackground, defaultAiSettings.imageBackground),
    imageOutputFormat: cleanSetting(settings.imageOutputFormat, defaultAiSettings.imageOutputFormat),
    imageConcurrency: normalizeIntegerSetting(settings.imageConcurrency, defaultAiSettings.imageConcurrency, 1, 16),
    speechToTextApiKey: cleanSetting(settings.speechToTextApiKey, defaultAiSettings.speechToTextApiKey),
    speechToTextLanguage: cleanSetting(settings.speechToTextLanguage, defaultAiSettings.speechToTextLanguage),
    speechToTextModel: cleanSetting(settings.speechToTextModel, defaultAiSettings.speechToTextModel),
    userProfile: cleanSetting(settings.userProfile, defaultAiSettings.userProfile),
  };
}

function configureAiSettings(settings = {}) {
  runtimeAiSettings = normalizeAiSettings(settings);
  return runtimeAiSettings;
}

function cleanOverrides(overrides = {}) {
  return Object.fromEntries(
    Object.entries(overrides).filter(([, value]) => String(value || "").trim()),
  );
}

function getAiSettings(overrides = {}) {
  return normalizeAiSettings({
    ...runtimeAiSettings,
    ...cleanOverrides(overrides),
  });
}

function getEmbeddingSettings(overrides = {}) {
  const aiSettings = getAiSettings(overrides);
  return {
    apiKey: aiSettings.openAiApiKey,
    baseUrl: String(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/g, ""),
    model: String(process.env.LEARNER_GRAPH_EMBEDDING_MODEL || aiSettings.embeddingModel).trim(),
  };
}

module.exports = {
  configureAiSettings,
  defaultAiSettings,
  getAiSettings,
  getEmbeddingSettings,
};
