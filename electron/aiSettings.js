const defaultAiSettings = {
  apiKey: "sk-cliproxy-michael-2026",
  baseUrl: "http://127.0.0.1:8317/v1",
  chatModel: "gpt-5.6-sol",
  graphModel: "gpt-5.3-codex-spark",
  embeddingModel: "text-embedding-3-small",
  imageModel: "gpt-image-2",
  imageSize: "1024x1024",
  imageQuality: "low",
  imageBackground: "opaque",
  imageOutputFormat: "png",
};

let runtimeAiSettings = { ...defaultAiSettings };

function cleanSetting(value, fallback) {
  return String(value || "").trim() || fallback;
}

function normalizeBaseUrl(baseUrl) {
  return cleanSetting(baseUrl, defaultAiSettings.baseUrl).replace(/\/+$/g, "");
}

function normalizeAiSettings(settings = {}) {
  return {
    apiKey: cleanSetting(settings.apiKey, defaultAiSettings.apiKey),
    baseUrl: normalizeBaseUrl(settings.baseUrl),
    chatModel: cleanSetting(settings.chatModel, defaultAiSettings.chatModel),
    graphModel: cleanSetting(settings.graphModel, defaultAiSettings.graphModel),
    embeddingModel: cleanSetting(settings.embeddingModel, defaultAiSettings.embeddingModel),
    imageModel: cleanSetting(settings.imageModel, defaultAiSettings.imageModel),
    imageSize: cleanSetting(settings.imageSize, defaultAiSettings.imageSize),
    imageQuality: cleanSetting(settings.imageQuality, defaultAiSettings.imageQuality),
    imageBackground: cleanSetting(settings.imageBackground, defaultAiSettings.imageBackground),
    imageOutputFormat: cleanSetting(settings.imageOutputFormat, defaultAiSettings.imageOutputFormat),
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

module.exports = {
  configureAiSettings,
  defaultAiSettings,
  getAiSettings,
};
