const { getAiSettings } = require("./aiSettings");

const speechToTextUrl = "https://api.elevenlabs.io/v1/speech-to-text";

function extensionForMimeType(mimeType) {
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("wav")) return "wav";
  return "webm";
}

async function transcribeSpeech(request = {}) {
  const settings = getAiSettings(request.settings);
  const audioBytes = request.audio ? Buffer.from(request.audio) : null;
  const mimeType = String(request.mimeType || "audio/webm");

  if (!audioBytes?.length) {
    throw new Error("Recorded audio is empty.");
  }
  if (!settings.speechToTextApiKey) {
    throw new Error("Add an ElevenLabs API key in Settings before using speech to text.");
  }

  const form = new FormData();
  form.append("file", new Blob([audioBytes], { type: mimeType }), `answer.${extensionForMimeType(mimeType)}`);
  form.append("model_id", settings.speechToTextModel);
  form.append("tag_audio_events", "false");
  form.append("diarize", "false");
  form.append("timestamps_granularity", "none");
  if (settings.speechToTextModel === "scribe_v2") {
    form.append("no_verbatim", "true");
  }
  if (settings.speechToTextLanguage.toLowerCase() !== "auto") {
    form.append("language_code", settings.speechToTextLanguage);
  }

  const response = await fetch(speechToTextUrl, {
    body: form,
    headers: { "xi-api-key": settings.speechToTextApiKey },
    method: "POST",
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const detail = payload?.detail;
    const message = typeof detail === "string" ? detail : detail?.message || payload?.message;
    throw new Error(message || `ElevenLabs transcription failed (${response.status}).`);
  }

  const text = String(payload?.text || "").trim();
  if (!text) {
    throw new Error("ElevenLabs returned an empty transcript.");
  }

  return {
    languageCode: String(payload.language_code || ""),
    model: settings.speechToTextModel,
    text,
  };
}

module.exports = { transcribeSpeech };