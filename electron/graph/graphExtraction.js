const { z } = require("zod");
const {
  findConceptResolutionCandidates,
  getDocumentGraph,
  getExtractionRun,
  hashContent,
  saveConceptEmbedding,
  saveResolvedDocumentGraph,
} = require("./graphDb");
const {
  getGraphEmbeddingConfig,
  getGraphModelConfig,
  requestConceptEmbeddings,
  requestStructuredJson,
} = require("./graphModel");
const { graphDebug, graphError, graphLog, graphWarn, hashPreview, startTimer } = require("./graphLog");

const maxResolutionCandidates = 8;
const resolverConcurrency = 4;

const mentionTypes = ["definition", "example", "comparison", "problem", "application", "passing_reference"];

const candidateConceptSchema = z
  .object({
    aliases: z.array(z.string()),
    confidence: z.number().min(0).max(1),
    excerptMarkdown: z.string().trim().min(1),
    importance: z.number().min(0).max(1),
    mentionType: z.enum(mentionTypes),
    name: z.string().trim().min(1),
    noteContribution: z.string().trim().min(1),
    sectionTitle: z.string(),
    summary: z.string().trim().min(1),
    type: z.string().trim().min(1),
  })
  .strict();

const candidateExtractionSchema = z
  .object({
    concepts: z.array(candidateConceptSchema),
  })
  .strict();

const conceptResolutionSchema = z
  .object({
    absorbConceptIds: z.array(z.number().int()),
    aliases: z.array(z.string()),
    canonicalName: z.string().trim().min(1),
    confidence: z.number().min(0).max(1),
    contribution: z.string().trim().min(1),
    decision: z.enum(["use_existing", "promote_candidate", "create_broader", "create_new", "keep_separate"]),
    explanation: z.string().trim().min(1),
    reason: z.string().trim().min(1),
    reuseConceptId: z.number().int().nullable(),
    summary: z.string().trim().min(1),
    type: z.string().trim().min(1),
  })
  .strict();

const relationExtractionSchema = z
  .object({
    relations: z.array(
      z
        .object({
          confidence: z.number().min(0).max(1),
          excerptMarkdown: z.string().trim().min(1),
          explanation: z.string().trim().min(1),
          fromKey: z.string().trim().min(1),
          relation: z.string().trim().min(1),
          toKey: z.string().trim().min(1),
        })
        .strict(),
    ),
  })
  .strict();

function jsonSchemaFor(schema) {
  const jsonSchema = z.toJSONSchema(schema);
  delete jsonSchema.$schema;
  return jsonSchema;
}

const candidateExtractionJsonSchema = jsonSchemaFor(candidateExtractionSchema);
const conceptResolutionJsonSchema = jsonSchemaFor(conceptResolutionSchema);
const relationExtractionJsonSchema = jsonSchemaFor(relationExtractionSchema);

function parseWithSchema(schema, value, label) {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 8)
      .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
      .join("; ");
    throw new Error(`${label} did not match the expected schema. ${issues}`);
  }

  return result.data;
}

function parseGraphExtractionResponse(content) {
  const raw = String(content || "").trim();
  if (!raw) {
    throw new Error("Graph extraction returned an empty response.");
  }

  return parseWithSchema(candidateExtractionSchema, JSON.parse(raw), "Graph extraction response");
}

function compactMarkdown(markdown, maxLength = 30_000) {
  const normalized = String(markdown || "").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}\n\n[truncated for graph extraction]`;
}

function hasInternalResolutionLanguage(text) {
  const raw = String(text || "");
  const internalPatterns = [
    /\b(candidate|existing concept|concept\s+\d+|reuse|reused|absorbed|absorb|provided candidate|provided candidates|retrieved candidate|retrieved candidates|resolution|resolve|decision|merge rationale|same abstraction|canonical)\b/i,
    /\b(use|using|keep|keeps)\s+(the\s+)?existing\b/i,
    /\b(the|this)\s+note\s+(describes|shows|discusses|provides|contributes|adds|fits|explains|states|says|mentions)\b/i,
    /\b(this|the)\s+(node|graph)\b/i,
    /\b(node|graph)\s+(can|could|should|will|keeps?|collects?|groups?|organizes?)\b/i,
    /\b(orderly teardown|graceful handling|broad abstraction|reusable umbrella|umbrella for|under (that|one|the same) umbrella|collects? examples|decision axis|organize[s]? notes|keeps one reusable|same umbrella|graph structure|graph organization|broad enough to include|protocol-specific instances?)\b/i,
  ];

  return internalPatterns.some((pattern) => pattern.test(raw));
}

function learnerFacingText(text, ...fallbacks) {
  const candidates = [text, ...fallbacks];

  for (const candidate of candidates) {
    const cleanText = String(candidate || "").trim();
    if (cleanText && !hasInternalResolutionLanguage(cleanText)) return cleanText;
  }

  return String(fallbacks.find((fallback) => String(fallback || "").trim()) || "").trim();
}

function stableConceptKey(name, index) {
  const normalized = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return normalized ? `${normalized}_${index + 1}` : `concept_${index + 1}`;
}

function conceptProfileText(concept) {
  return [
    `Name: ${concept.name}`,
    concept.aliases?.length ? `Aliases: ${concept.aliases.join(", ")}` : "",
    concept.type ? `Type: ${concept.type}` : "",
    concept.summary ? `Summary: ${concept.summary}` : "",
    concept.explanation ? `Explanation: ${concept.explanation}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function normalizeExtractedConcepts(concepts) {
  return concepts.map((concept, index) => ({
    ...concept,
    key: stableConceptKey(concept.name, index),
  }));
}

async function mapWithConcurrency(items, concurrency, callback) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await callback(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(Math.max(concurrency, 1), items.length) }, () => worker()),
  );
  return results;
}

async function requestCandidateConcepts({ documentPath, markdown, settings }) {
  const elapsed = startTimer();
  graphLog("candidate_extraction.start", {
    documentPath,
    markdownChars: markdown.length,
  });

  const response = await requestStructuredJson({
    schemaName: "knowledge_graph_candidate_concepts",
    jsonSchema: candidateExtractionJsonSchema,
    settings,
    temperature: 0.15,
    messages: [
      {
        role: "system",
        content: [
          "You extract high-level study concepts from one Markdown note.",
          "Return only valid JSON.",
          "Prefer reusable concepts that would be useful across multiple notes.",
          "Avoid one-off details, raw facts, individual packet names, and tiny phrases as top-level concepts unless the note is mainly about that concept.",
          "If a specific detail appears, fold it into the summary of a broader concept when possible.",
          "A good concept name is something a learner would search for or compare across notes, such as TCP reliability, UDP reliability tradeoff, transport checksums, handshake protocols, congestion control, or HTTP over transport protocols.",
          "A bad concept name is a raw implementation detail with no broader study value.",
          "Choose the number of concepts based on the note's length and density. Short focused notes may need only a few concepts; long dense notes may need many more.",
          "Do not pad the graph with weak concepts, but do not omit important high-level ideas just because there are many of them.",
          "Extract each underlying concept only once per note. If several sections discuss the same idea, combine them into one candidate with the clearest representative excerpt and one unified noteContribution.",
          "Example: a short note only defining TCP vs UDP might extract TCP reliability, UDP best-effort delivery, and reliability-latency tradeoff.",
          "Example: a long networking note covering TCP setup, reliability, flow control, congestion control, teardown, UDP, checksums, and HTTP should extract each of those reusable study topics when the note gives meaningful detail.",
          "Example: a long math note with definitions, theorems, proof techniques, worked examples, and applications should extract the reusable definitions, theorem ideas, proof methods, and application concepts that a learner would review or connect across notes.",
          "Each concept must include note-grounded excerptMarkdown and a concise learner-facing summary.",
          "summary must define the concept or explain its role in the note. Do not describe your extraction process.",
          "noteContribution is shown as study details under the source note.",
          "noteContribution must be 2-4 learner-facing sentences that teach the concrete mechanics, example, definition, or comparison found in the excerpt.",
          "noteContribution should help someone review this topic without opening the full original note.",
          "For comparison-heavy topics, noteContribution should name the tradeoff, contrast, or example the note contributes.",
          "Write summary and noteContribution as study material, not as graph construction commentary.",
          "Never mention graph nodes, reusable umbrellas, collecting examples, grouping notes, decision axes, merge choices, candidates, or extraction decisions in summary or noteContribution.",
          "Do not write noteContribution as a justification of why the note belongs to a concept.",
          "Do not start noteContribution with phrases like 'The note describes', 'The note states', 'This note says', 'This note shows', 'The note provides', or 'This note contributes'. Start with the concept itself.",
          "Use concrete, human language. Name mechanisms, steps, tradeoffs, and examples.",
          "Avoid vague academic phrases like orderly teardown, graceful handling, broad abstraction, reusable umbrella, or protocol-specific instance.",
          "Bad noteContribution: Keeps one reusable umbrella for protocol comparisons.",
          "Bad noteContribution: The note describes orderly teardown after communication ends.",
          "Good noteContribution: This note contrasts TCP's reliability and ordering guarantees with UDP's lower-latency best-effort delivery.",
          "Good noteContribution: TCP shutdown uses FIN and ACK messages in both directions: one side sends FIN, the other acknowledges it, then the other side sends its own FIN and receives an ACK. This matters because each direction of the connection closes separately, so neither endpoint silently drops the final data.",
          "Do not add facts unsupported by this note.",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `Document path: ${documentPath}`,
          "Extract high-level candidate concepts from this Markdown note:",
          "",
          compactMarkdown(markdown),
        ].join("\n"),
      },
    ],
  });

  const concepts = normalizeExtractedConcepts(
    parseWithSchema(candidateExtractionSchema, response, "Candidate concept extraction").concepts,
  );

  graphLog("candidate_extraction.done", {
    conceptCount: concepts.length,
    conceptNames: concepts.map((concept) => concept.name),
    documentPath,
    durationMs: elapsed(),
  });

  return concepts;
}

function formatResolutionCandidates(candidates, currentDocumentPath) {
  if (candidates.length === 0) return "No existing concept candidates were retrieved.";

  return candidates
    .map((candidate) => {
      const priorMentions = (candidate.mentions || []).filter(
        (mention) => mention.documentPath !== currentDocumentPath,
      );

      return [
        `ID: ${candidate.id}`,
        `Name: ${candidate.name}`,
        candidate.aliases?.length ? `Aliases: ${candidate.aliases.join(", ")}` : "",
        candidate.type ? `Type: ${candidate.type}` : "",
        candidate.summary ? `Summary: ${candidate.summary}` : "",
        candidate.explanation ? `Explanation: ${candidate.explanation}` : "",
        priorMentions.length
          ? [
              "Existing note perspectives:",
              priorMentions
                .map((mention) => {
                  const perspective = String(mention.contribution || "").trim()
                    || compactMarkdown(mention.excerptMarkdown, 500);
                  return `- ${mention.documentPath}: ${perspective}`;
                })
                .join("\n"),
            ].join("\n")
          : "",
        `Match: ${candidate.matchReason}, score ${Number(candidate.score ?? 0).toFixed(3)}`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n---\n\n");
}

function defaultResolutionForNewConcept(candidate) {
  return {
    absorbConceptIds: [],
    aliases: candidate.aliases,
    candidateKey: candidate.key,
    confidence: candidate.confidence,
    contribution: learnerFacingText(candidate.noteContribution, candidate.summary),
    decision: "create_new",
    explanation: learnerFacingText(candidate.summary, candidate.noteContribution),
    excerptMarkdown: candidate.excerptMarkdown,
    mentionType: candidate.mentionType,
    name: candidate.name,
    reason: "No similar existing concept was retrieved.",
    sectionTitle: candidate.sectionTitle,
    summary: learnerFacingText(candidate.summary, candidate.noteContribution),
    type: candidate.type,
  };
}

async function resolveConcept({ candidate, candidates, documentPath, settings }) {
  const elapsed = startTimer();

  if (candidates.length === 0) {
    const resolution = defaultResolutionForNewConcept(candidate);
    graphLog("concept_resolution.default_new", {
      candidate: candidate.name,
      canonicalName: resolution.name,
      decision: resolution.decision,
      durationMs: elapsed(),
    });
    return resolution;
  }

  graphLog("concept_resolution.start", {
    candidate: candidate.name,
    candidateCount: candidates.length,
    retrievedCandidates: candidates.map((concept) => ({
      id: concept.id,
      matchReason: concept.matchReason,
      name: concept.name,
      score: Number(concept.score ?? 0).toFixed(3),
    })),
  });

  const allowedConceptIds = new Set(candidates.map((concept) => concept.id));
  const response = await requestStructuredJson({
    schemaName: "knowledge_graph_concept_resolution",
    jsonSchema: conceptResolutionJsonSchema,
    settings,
    temperature: 0.1,
    messages: [
      {
        role: "system",
        content: [
          "You resolve one proposed study concept against existing canonical concepts.",
          "Choose the most useful high-level study node.",
          "If an existing concept already covers the candidate, reuse it.",
          "If the candidate is a better broader abstraction, promote it and absorb narrower existing concepts.",
          "If candidate and existing concepts imply a better abstraction, create that broader concept and absorb the covered concepts.",
          "If concepts are merely related but not the same abstraction, keep them separate by creating or reusing only the candidate's best node.",
          "Only put IDs from the provided candidates in reuseConceptId or absorbConceptIds.",
          "Do not preserve overly specific nodes when a stronger reusable abstraction is available.",
          "",
          "Important field rules:",
          "reason is private logging only: keep it short.",
          "summary, explanation, and contribution are learner-facing: they are displayed directly in the app.",
          "Never mention candidate, existing concept, Concept ID, reuse, absorb, resolution, retrieved candidates, or your decision process in summary, explanation, or contribution.",
          "Never mention graph nodes, node organization, reusable umbrellas, collecting examples, decision axes, merge choices, or how you grouped notes in summary, explanation, or contribution.",
          "summary should be a concise definition or role of the canonical concept.",
          "explanation should be a stable concept profile, not a current-note fit explanation.",
          "explanation should help study: define the concept, compare/contrast related ideas, explain examples, and call out useful distinctions.",
          "If existing concept profiles are provided, preserve the broader concept meaning instead of replacing it with only the current note's angle.",
          "contribution is displayed under the source note as study details.",
          "If existing note perspectives are provided, contribution should be 1-3 plain-language sentences comparing the current note with them: state what overlaps, then what the current note adds, changes, or applies differently.",
          "When comparing notes, do not repeat the full generic definition. Focus on the specific difference in framing, example, rule, or tradeoff.",
          "If there are no existing note perspectives, contribution should be 2-4 concrete sentences teaching the current note's definition, mechanism, example, or comparison.",
          "Define unavoidable technical terms in ordinary language when they first appear. Do not compress several unexplained labels into one sentence.",
          "Prefer a concrete sentence such as 'Embed an address when it belongs only to one customer record; reference a product when many orders share it' over abstract phrases such as 'lifecycle-coupled data' or 'independently evolving entities'.",
          "Do not write contribution as a justification of why the note belongs to a concept.",
          "Do not start contribution with phrases like 'The note describes', 'The note states', 'This note says', 'This note shows', 'The note provides', or 'This note contributes'. Start with the concept itself.",
          "If the note provides a definition, say what the definition is. If it provides an example, say what the example demonstrates. If it compares ideas, state the comparison.",
          "If two notes cover the same concept from different angles, explicitly explain that difference instead of listing both notes' terminology.",
          "Use concrete, human language. Prefer named steps, packets, components, failure modes, and tradeoffs over abstract labels.",
          "Avoid vague academic phrases like orderly teardown, graceful handling, broad abstraction, reusable umbrella, or protocol-specific instance.",
          "Bad contribution: This node can collect examples from many contexts under one decision axis.",
          "Bad contribution: The note describes orderly teardown after communication ends.",
          "Good contribution: This note compares TCP and UDP as a reliability-versus-latency tradeoff: TCP adds ordering and retransmission, while UDP avoids those guarantees for lower overhead.",
          "Good contribution: TCP shutdown uses FIN and ACK messages in both directions: one side sends FIN, the peer acknowledges it, then the peer sends its own FIN and receives an ACK. The useful takeaway is that closing a TCP connection is a negotiated exchange, not a single instant cutoff.",
          "Do not add facts unsupported by the current note or provided concept profiles.",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          "Candidate concept from current note:",
          JSON.stringify(candidate, null, 2),
          "",
          "Existing concept candidates:",
          formatResolutionCandidates(candidates, documentPath),
          "",
          "Resolve the candidate to the best canonical concept.",
        ].join("\n"),
      },
    ],
  });
  const resolution = parseWithSchema(conceptResolutionSchema, response, "Concept resolution");
  const reuseConceptId = allowedConceptIds.has(resolution.reuseConceptId) ? resolution.reuseConceptId : null;
  const absorbConceptIds = resolution.absorbConceptIds.filter((conceptId) => allowedConceptIds.has(conceptId));
  const fallbackConceptId = reuseConceptId ?? (resolution.decision === "use_existing" ? absorbConceptIds[0] : null);
  const sanitizedResolution = {
    absorbConceptIds,
    candidate: candidate.name,
    canonicalName: resolution.canonicalName,
    decision: resolution.decision,
    durationMs: elapsed(),
    reuseConceptId,
  };

  if (resolution.absorbConceptIds.length !== absorbConceptIds.length || resolution.reuseConceptId !== reuseConceptId) {
    graphWarn("concept_resolution.dropped_invalid_ids", {
      ...sanitizedResolution,
      rawAbsorbConceptIds: resolution.absorbConceptIds,
      rawReuseConceptId: resolution.reuseConceptId,
      validCandidateIds: [...allowedConceptIds],
    });
  }

  graphLog("concept_resolution.done", sanitizedResolution);
  graphDebug("concept_resolution.reason", {
    candidate: candidate.name,
    reason: resolution.reason,
  });

  return {
    absorbConceptIds,
    aliases: [...new Set([...(resolution.aliases || []), ...(candidate.aliases || []), candidate.name])],
    candidateKey: candidate.key,
    conceptId: fallbackConceptId,
    confidence: resolution.confidence,
    contribution: learnerFacingText(
      resolution.contribution,
      candidate.noteContribution,
      candidate.summary,
    ),
    decision: resolution.decision,
    explanation: learnerFacingText(resolution.explanation, candidate.summary, candidate.noteContribution),
    excerptMarkdown: candidate.excerptMarkdown,
    mentionType: candidate.mentionType,
    name: resolution.canonicalName,
    reason: resolution.reason,
    sectionTitle: candidate.sectionTitle,
    summary: learnerFacingText(resolution.summary, candidate.summary, candidate.noteContribution),
    type: resolution.type,
  };
}

async function resolveCandidateConcepts(candidates, documentPath, settings) {
  const embeddingConfig = getGraphEmbeddingConfig(settings);
  const elapsed = startTimer();
  graphLog("concept_resolution.batch_start", {
    candidateCount: candidates.length,
    embeddingModel: embeddingConfig.model,
    resolverConcurrency,
  });
  const candidateEmbeddings = await requestConceptEmbeddings(candidates.map(conceptProfileText), settings);

  const resolvedConcepts = await mapWithConcurrency(candidates, resolverConcurrency, async (candidate, index) => {
    const resolutionCandidates = findConceptResolutionCandidates({
      aliases: candidate.aliases,
      embedding: candidateEmbeddings[index],
      embeddingModel: embeddingConfig.model,
      limit: maxResolutionCandidates,
      name: candidate.name,
    });

    return resolveConcept({
      candidate,
      candidates: resolutionCandidates,
      documentPath,
      settings,
    });
  });

  graphLog("concept_resolution.batch_done", {
    durationMs: elapsed(),
    resolvedConceptCount: resolvedConcepts.length,
    resolvedConcepts: resolvedConcepts.map((concept) => ({
      absorbConceptIds: concept.absorbConceptIds,
      canonicalName: concept.name,
      decision: concept.decision,
      reuseConceptId: concept.conceptId,
    })),
  });

  return resolvedConcepts;
}

function collapseResolvedConcepts(concepts) {
  const conceptsByTarget = new Map();

  for (const concept of concepts) {
    const conceptId = Number(concept.conceptId);
    const targetKey = Number.isFinite(conceptId)
      ? `id:${conceptId}`
      : `name:${String(concept.name || "").trim().toLowerCase()}`;
    const existing = conceptsByTarget.get(targetKey);

    if (!existing) {
      conceptsByTarget.set(targetKey, {
        ...concept,
        absorbConceptIds: [...new Set(concept.absorbConceptIds || [])],
        aliases: [...new Set(concept.aliases || [])],
        candidateKeys: [concept.candidateKey].filter(Boolean),
      });
      continue;
    }

    const useCurrent = Number(concept.confidence || 0) > Number(existing.confidence || 0);
    const primary = useCurrent ? concept : existing;
    conceptsByTarget.set(targetKey, {
      ...existing,
      ...primary,
      absorbConceptIds: [...new Set([...(existing.absorbConceptIds || []), ...(concept.absorbConceptIds || [])])],
      aliases: [...new Set([...(existing.aliases || []), ...(concept.aliases || [])])],
      candidateKeys: [...new Set([...(existing.candidateKeys || []), concept.candidateKey].filter(Boolean))],
    });
  }

  return [...conceptsByTarget.values()];
}

async function searchRelatedConcepts({ aliases = [], name, summary = "", type = "" }, limit = maxResolutionCandidates, settings) {
  const cleanName = String(name || "").trim();
  if (!cleanName) {
    throw new Error("Concept name is required.");
  }

  const embeddingConfig = getGraphEmbeddingConfig(settings);
  const elapsed = startTimer();
  graphLog("concept_related_search.start", {
    limit,
    name: cleanName,
  });

  const [embedding] = await requestConceptEmbeddings(
    [
      conceptProfileText({
        aliases,
        name: cleanName,
        summary,
        type,
      }),
    ],
    settings,
  );
  const concepts = findConceptResolutionCandidates({
    aliases,
    embedding,
    embeddingModel: embeddingConfig.model,
    limit,
    name: cleanName,
  });

  graphLog("concept_related_search.done", {
    durationMs: elapsed(),
    name: cleanName,
    resultCount: concepts.length,
  });

  return concepts;
}

async function requestResolvedRelations({ concepts, documentPath, markdown, settings }) {
  if (concepts.length < 2) return [];

  const elapsed = startTimer();
  graphLog("relation_extraction.start", {
    conceptCount: concepts.length,
    documentPath,
  });

  const response = await requestStructuredJson({
    schemaName: "knowledge_graph_local_relations",
    jsonSchema: relationExtractionJsonSchema,
    settings,
    temperature: 0.1,
    messages: [
      {
        role: "system",
        content: [
          "You extract meaningful local relations from one note between already resolved canonical concepts.",
          "Return only relations supported by the note.",
          "Relation endpoints must use fromKey/toKey from the provided concept list exactly.",
          "Prefer high-signal study relationships such as uses, runs_over, enables, depends_on, contrasts_with, replaces, optimizes, part_of, example_of, causes, mitigates, prerequisite_for.",
          "Do not create relations just because two concepts appear near each other.",
          "Each relation must include a concise learner-facing explanation and note-grounded excerptMarkdown.",
          "The relation explanation should explain why the relationship matters for understanding or comparing concepts.",
          "Do not mention extraction, candidates, concept IDs, or internal graph decisions in relation explanations.",
          "Do not mention graph nodes, node organization, reusable umbrellas, grouping notes, or merge decisions in relation explanations.",
          "Write explanations as study guidance. Example: TCP uses acknowledgements to detect missing data and trigger retransmission, which supports reliable delivery.",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `Document path: ${documentPath}`,
          "Resolved concepts:",
          JSON.stringify(
            concepts.map((concept) => ({
              key: concept.candidateKey,
              name: concept.name,
              type: concept.type,
              summary: concept.summary,
            })),
            null,
            2,
          ),
          "",
          "Markdown note:",
          compactMarkdown(markdown),
        ].join("\n"),
      },
    ],
  });
  const relationResult = parseWithSchema(relationExtractionSchema, response, "Relation extraction");
  const validKeys = new Set(concepts.map((concept) => concept.candidateKey));
  const rejectedRelations = relationResult.relations.filter(
    (relation) => !validKeys.has(relation.fromKey) || !validKeys.has(relation.toKey) || relation.fromKey === relation.toKey,
  );
  if (rejectedRelations.length > 0) {
    graphWarn("relation_extraction.rejected_invalid_endpoints", {
      count: rejectedRelations.length,
      documentPath,
      validKeys: [...validKeys],
    });
  }

  const relations = relationResult.relations
    .filter((relation) => validKeys.has(relation.fromKey) && validKeys.has(relation.toKey) && relation.fromKey !== relation.toKey)
    .map((relation) => ({
      ...relation,
      explanation: learnerFacingText(relation.explanation, relation.excerptMarkdown),
      source: "local",
    }));

  graphLog("relation_extraction.done", {
    documentPath,
    durationMs: elapsed(),
    relationCount: relations.length,
    rejectedCount: rejectedRelations.length,
    relations: relations.map((relation) => ({
      fromKey: relation.fromKey,
      relation: relation.relation,
      toKey: relation.toKey,
    })),
  });

  return relations;
}

async function saveConceptProfileEmbeddings(conceptProfiles, settings) {
  if (!conceptProfiles.length) return;

  const embeddingConfig = getGraphEmbeddingConfig(settings);
  const elapsed = startTimer();
  graphLog("concept_profile_embedding.start", {
    conceptCount: conceptProfiles.length,
    model: embeddingConfig.model,
  });
  const profilesToEmbed = conceptProfiles.map((concept) => concept.profile);
  const embeddings = await requestConceptEmbeddings(profilesToEmbed, settings);

  conceptProfiles.forEach((concept, index) => {
    saveConceptEmbedding({
      conceptId: concept.id,
      embedding: embeddings[index],
      model: embeddingConfig.model,
      profileHash: hashContent(concept.profile),
    });
  });

  graphLog("concept_profile_embedding.done", {
    conceptCount: conceptProfiles.length,
    durationMs: elapsed(),
    model: embeddingConfig.model,
  });
}

async function extractDocumentGraph(documentPath, document, markdown, settings) {
  const elapsed = startTimer();
  const extractionMarkdown = String(markdown || "").trim();
  if (!extractionMarkdown) {
    throw new Error("Graph extraction requires Markdown exported by the active Tiptap editor.");
  }

  const documentHash = hashContent(extractionMarkdown);
  const config = getGraphModelConfig(settings);
  const existingRun = getExtractionRun(documentPath);

  graphLog("pipeline.start", {
    cacheModel: config.cacheModel,
    documentHash: hashPreview(documentHash),
    documentPath,
    markdownChars: extractionMarkdown.length,
    model: config.model,
  });

  if (existingRun?.document_hash === documentHash && existingRun?.model === config.cacheModel) {
    const cachedGraph = getDocumentGraph(documentPath);

    if (cachedGraph.nodes.length > 0) {
      graphLog("pipeline.cache_hit", {
        documentHash: hashPreview(documentHash),
        documentPath,
        durationMs: elapsed(),
        edgeCount: cachedGraph.edges.length,
        model: config.cacheModel,
        nodeCount: cachedGraph.nodes.length,
      });
      return {
        extracted: false,
        graph: cachedGraph,
      };
    }

    graphWarn("pipeline.cache_empty_rebuild", {
      documentHash: hashPreview(documentHash),
      documentPath,
      durationMs: elapsed(),
      model: config.cacheModel,
      reason: "Cached extraction had no renderable document nodes.",
    });
  }

  graphLog("pipeline.cache_miss", {
    existingHash: hashPreview(existingRun?.document_hash),
    existingModel: existingRun?.model ?? null,
    nextHash: hashPreview(documentHash),
    nextModel: config.cacheModel,
    documentPath,
  });

  try {
    const candidates = await requestCandidateConcepts({ documentPath, markdown: extractionMarkdown, settings });
    const resolvedCandidates = await resolveCandidateConcepts(candidates, documentPath, settings);
    const resolvedConcepts = collapseResolvedConcepts(resolvedCandidates);
    if (resolvedConcepts.length !== resolvedCandidates.length) {
      graphLog("concept_resolution.collapsed_duplicates", {
        documentPath,
        inputCount: resolvedCandidates.length,
        outputCount: resolvedConcepts.length,
      });
    }
    const relations = await requestResolvedRelations({
      concepts: resolvedConcepts,
      documentPath,
      markdown: extractionMarkdown,
      settings,
    });
    const saveElapsed = startTimer();
    const { conceptProfiles, graph } = saveResolvedDocumentGraph({
      documentHash,
      documentPath,
      graphBuild: {
        concepts: resolvedConcepts,
        relations,
      },
      model: config.cacheModel,
    });

    graphLog("pipeline.save_done", {
      conceptProfilesToEmbed: conceptProfiles.length,
      documentPath,
      durationMs: saveElapsed(),
      edgeCount: graph.edges.length,
      nodeCount: graph.nodes.length,
    });

    await saveConceptProfileEmbeddings(conceptProfiles, settings);

    graphLog("pipeline.done", {
      candidateCount: candidates.length,
      documentPath,
      durationMs: elapsed(),
      edgeCount: graph.edges.length,
      extracted: true,
      nodeCount: graph.nodes.length,
      relationCount: relations.length,
      resolvedConceptCount: resolvedConcepts.length,
    });

    return {
      extracted: true,
      graph,
    };
  } catch (error) {
    graphError("pipeline.failed", error, {
      documentHash: hashPreview(documentHash),
      documentPath,
      durationMs: elapsed(),
      model: config.cacheModel,
    });
    throw error;
  }
}

module.exports = {
  extractDocumentGraph,
  parseGraphExtractionResponse,
  searchRelatedConcepts,
};
