"use client";

export type LearnerAiSettings = {
  apiKey: string;
  baseUrl: string;
  chatModel: string;
  graphModel: string;
  openAiApiKey: string;
  embeddingModel: string;
  imageModel: string;
  imageSize: string;
  imageQuality: string;
  imageBackground: string;
  imageOutputFormat: string;
  imageConcurrency: string;
  speechToTextApiKey: string;
  speechToTextLanguage: string;
  speechToTextModel: string;
  userProfile: string;
};

export const aiSettingsStorageKeys = {
  apiKey: "learner.ai.proxyKey.v1",
  baseUrl: "learner.ai.proxyBaseUrl.v1",
  chatModel: "learner.ai.model.v1",
  graphModel: "learner.ai.graphModel.v1",
  openAiApiKey: "learner.ai.openAiApiKey.v1",
  embeddingModel: "learner.ai.embeddingModel.v1",
  imageModel: "learner.ai.imageModel.v1",
  imageSize: "learner.ai.imageSize.v1",
  imageQuality: "learner.ai.imageQuality.v1",
  imageBackground: "learner.ai.imageBackground.v1",
  imageOutputFormat: "learner.ai.imageOutputFormat.v1",
  imageConcurrency: "learner.ai.imageConcurrency.v1",
  speechToTextApiKey: "learner.ai.speechToTextApiKey.v1",
  speechToTextLanguage: "learner.ai.speechToTextLanguage.v1",
  speechToTextModel: "learner.ai.speechToTextModel.v1",
  userProfile: "learner.ai.userProfile.v1",
} as const;

export const defaultAiSettings: LearnerAiSettings = {
  apiKey: "sk-cliproxy-michael-2026",
  baseUrl: "http://127.0.0.1:8317/v1",
  chatModel: "gpt-5.6-sol",
  graphModel: "gpt-5.3-codex-spark",
  openAiApiKey: "",
  embeddingModel: "text-embedding-3-small",
  imageModel: "gpt-image-2",
  imageSize: "1024x1024",
  imageQuality: "low",
  imageBackground: "opaque",
  imageOutputFormat: "png",
  imageConcurrency: "8",
  speechToTextApiKey: "",
  speechToTextLanguage: "eng",
  speechToTextModel: "scribe_v2",
  userProfile: "",
};

function readSetting(key: keyof LearnerAiSettings) {
  if (typeof window === "undefined") return defaultAiSettings[key];
  return localStorage.getItem(aiSettingsStorageKeys[key])?.trim() || defaultAiSettings[key];
}

export function readAiSettings(): LearnerAiSettings {
  return {
    apiKey: readSetting("apiKey"),
    baseUrl: readSetting("baseUrl"),
    chatModel: readSetting("chatModel"),
    graphModel: readSetting("graphModel"),
    openAiApiKey: readSetting("openAiApiKey"),
    embeddingModel: readSetting("embeddingModel"),
    imageModel: readSetting("imageModel"),
    imageSize: readSetting("imageSize"),
    imageQuality: readSetting("imageQuality"),
    imageBackground: readSetting("imageBackground"),
    imageOutputFormat: readSetting("imageOutputFormat"),
    imageConcurrency: readSetting("imageConcurrency"),
    speechToTextApiKey: readSetting("speechToTextApiKey"),
    speechToTextLanguage: readSetting("speechToTextLanguage"),
    speechToTextModel: readSetting("speechToTextModel"),
    userProfile: readSetting("userProfile"),
  };
}

export function writeAiSettings(settings: LearnerAiSettings) {
  if (typeof window === "undefined") return;

  for (const key of Object.keys(aiSettingsStorageKeys) as Array<keyof LearnerAiSettings>) {
    localStorage.setItem(aiSettingsStorageKeys[key], settings[key].trim());
  }
}

export function resetAiSettings() {
  writeAiSettings(defaultAiSettings);
  return defaultAiSettings;
}
