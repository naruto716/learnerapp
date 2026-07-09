const { getAiSettings } = require("./aiSettings");

function dataUrlForImage(b64Json, outputFormat) {
  const format = String(outputFormat || "png").replace(/^image\//i, "") || "png";
  return `data:image/${format};base64,${b64Json}`;
}

async function listAiModels(settings = {}) {
  const config = getAiSettings(settings);
  const response = await fetch(`${config.baseUrl}/models`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AI model list request failed (${response.status}): ${errorText.slice(0, 500)}`);
  }

  const body = await response.json();
  return Array.isArray(body.data) ? body.data : [];
}

async function generateImage({ prompt, settings = {} } = {}) {
  const cleanPrompt = String(prompt || "").trim();
  if (!cleanPrompt) {
    throw new Error("Image prompt is required.");
  }

  const config = getAiSettings(settings);
  const requestBody = {
    model: config.imageModel,
    prompt: cleanPrompt,
    size: config.imageSize,
    quality: config.imageQuality,
    n: 1,
  };

  if (config.imageBackground) {
    requestBody.background = config.imageBackground;
  }

  if (config.imageOutputFormat) {
    requestBody.output_format = config.imageOutputFormat;
  }

  const startedAt = Date.now();
  const response = await fetch(`${config.baseUrl}/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(180_000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Image generation failed (${response.status}): ${errorText.slice(0, 800)}`);
  }

  const body = await response.json();
  const firstImage = body?.data?.[0];
  const b64Json = firstImage?.b64_json;

  if (typeof b64Json !== "string" || !b64Json) {
    throw new Error("Image generation response did not include b64_json.");
  }

  const outputFormat = body.output_format || config.imageOutputFormat || "png";

  return {
    background: body.background || config.imageBackground,
    b64Json,
    dataUrl: dataUrlForImage(b64Json, outputFormat),
    durationMs: Date.now() - startedAt,
    model: body.model || config.imageModel,
    outputFormat,
    prompt: cleanPrompt,
    quality: body.quality || config.imageQuality,
    size: body.size || config.imageSize,
    usage: body.usage || null,
  };
}

module.exports = {
  generateImage,
  listAiModels,
};
