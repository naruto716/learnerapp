const { z } = require("zod");
const {
  getDocumentGraph,
  getExtractionRun,
  hashContent,
  saveExtractedDocumentGraph,
} = require("./graphDb");

const defaultGraphModel = "gpt-5.5";
const defaultGraphBaseUrl = "http://127.0.0.1:8317/v1";
const defaultProxyApiKey = "sk-cliproxy-michael-2026";

const graphExtractionSchema = z
  .object({
    concepts: z.array(
      z
        .object({
          aliases: z.array(z.string()),
          confidence: z.number().min(0).max(1),
          excerptMarkdown: z.string().trim().min(1),
          mentionType: z.enum(["definition", "example", "comparison", "problem", "application", "passing_reference"]),
          name: z.string().trim().min(1),
          sectionTitle: z.string(),
          summary: z.string().trim().min(1),
          type: z.string().trim().min(1),
        })
        .strict(),
    ),
    relations: z.array(
      z
        .object({
          confidence: z.number().min(0).max(1),
          excerptMarkdown: z.string().trim().min(1),
          explanation: z.string().trim().min(1),
          from: z.string().trim().min(1),
          relation: z.string().trim().min(1),
          to: z.string().trim().min(1),
        })
        .strict(),
    ),
  })
  .strict();
const graphExtractionJsonSchema = z.toJSONSchema(graphExtractionSchema);
delete graphExtractionJsonSchema.$schema;

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
    apiKey: String(apiKey).trim(),
    baseUrl,
    model: String(process.env.LEARNER_GRAPH_MODEL || process.env.LEARNER_AI_MODEL || defaultGraphModel).trim(),
  };
}

function parseGraphExtractionResponse(content) {
  const raw = String(content || "").trim();
  if (!raw) {
    throw new Error("Graph extraction returned an empty response.");
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Graph extraction response was not valid JSON.");
  }

  const result = graphExtractionSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 6)
      .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Graph extraction JSON did not match the expected schema. ${issues}`);
  }

  return result.data;
}

async function requestGraphExtraction({ documentPath, markdown }) {
  const config = getGraphModelConfig();

  if (!config.apiKey) {
    throw new Error("Graph extraction API key is not configured.");
  }

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
          name: "knowledge_graph_extraction",
          strict: true,
          schema: graphExtractionJsonSchema,
        },
      },
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content: [
            "You extract a study knowledge graph from a user's note.",
            "Return only valid JSON. Do not wrap the JSON in markdown.",
            "Extract important concepts and meaningful relations that are supported by this note.",
            "Do not add external facts that are not supported by the note.",
            "Prefer relationship labels that are short verb phrases such as uses, runs_over, depends_on, enables, mitigates, causes, stores, caches, routes_to, secures, contrasts_with, replaces, optimizes, part_of, example_of, prerequisite_for, often_confused_with.",
            "Use relation='related_to' only when no more specific relation fits.",
            "Every concept must include an excerptMarkdown copied from or tightly grounded in the note.",
            "Every relation must include an excerptMarkdown copied from or tightly grounded in the note.",
            "Keep excerpts concise but useful for later review.",
            "Use confidence from 0 to 1.",
            "JSON shape: {\"concepts\":[{\"name\":\"\",\"aliases\":[],\"type\":\"\",\"summary\":\"\",\"mentionType\":\"definition|example|comparison|problem|application|passing_reference\",\"sectionTitle\":\"\",\"excerptMarkdown\":\"\",\"confidence\":0.9}],\"relations\":[{\"from\":\"\",\"relation\":\"\",\"to\":\"\",\"explanation\":\"\",\"excerptMarkdown\":\"\",\"confidence\":0.9}]}",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            `Document path: ${documentPath}`,
            "Extract concepts and relations from this Markdown note:",
            "",
            markdown || "(empty note)",
          ].join("\n"),
        },
      ],
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Graph extraction failed (${response.status}): ${errorText.slice(0, 500)}`);
  }

  const body = await response.json();
  const content = body?.choices?.[0]?.message?.content;
  return parseGraphExtractionResponse(content);
}

async function extractDocumentGraph(documentPath, document, markdown) {
  const extractionMarkdown = String(markdown || "").trim();
  if (!extractionMarkdown) {
    throw new Error("Graph extraction requires Markdown exported by the active Tiptap editor.");
  }

  const documentHash = hashContent(JSON.stringify(document));
  const config = getGraphModelConfig();
  const existingRun = getExtractionRun(documentPath);

  if (existingRun?.document_hash === documentHash && existingRun?.model === config.model) {
    return {
      extracted: false,
      graph: getDocumentGraph(documentPath),
    };
  }

  const extraction = await requestGraphExtraction({ documentPath, markdown: extractionMarkdown });
  const graph = saveExtractedDocumentGraph({
    documentHash,
    documentPath,
    extraction,
    model: config.model,
  });

  return {
    extracted: true,
    graph,
  };
}

module.exports = {
  extractDocumentGraph,
  parseGraphExtractionResponse,
};
