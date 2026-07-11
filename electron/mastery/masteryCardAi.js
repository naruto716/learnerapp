const { z } = require("zod");
const { requestStructuredOutput } = require("../aiClient");
const { readDocumentFile } = require("../documentUtil");
const { extractDocumentGraph } = require("../graph/graphExtraction");
const { getDocumentGraph } = require("../graph/graphDb");
const { cardDifficulties, cardKinds } = require("./masteryScoring");

const generatedCardTargetSchema = z
  .object({
    conceptId: z.number().int().positive(),
    stage: z.number().int().min(2).max(6),
  })
  .strict();

const generatedCardSchema = z
  .object({
    answerMode: z.enum(["single_turn", "multi_turn"]),
    contextMarkdown: z.string().max(12_000),
    difficulty: z.enum(cardDifficulties),
    expectedAnswerMarkdown: z.string().trim().min(1),
    graphEdgeIds: z.array(z.number().int().positive()),
    kind: z.enum(cardKinds),
    promptMarkdown: z.string().trim().min(1),
    rubricMarkdown: z.string().trim().min(1),
    targetedWeaknessIds: z.array(z.number().int().positive()),
    targets: z.array(generatedCardTargetSchema).min(1).max(20),
    title: z.string().trim().min(1).max(120),
  })
  .strict();

const generatedCardsSchema = z.object({ cards: z.array(generatedCardSchema).min(1) }).strict();
const discussionResponseSchema = z
  .object({ replyMarkdown: z.string().trim().min(1), shouldEnd: z.boolean() })
  .strict();
const weaknessOutcomeSchema = z
  .object({
    conceptIds: z.array(z.number().int().positive()).min(1),
    description: z.string().trim().min(1),
    stages: z.array(z.number().int().min(2).max(6)).min(1),
    state: z.enum(["active", "resolved"]),
    title: z.string().trim().min(1),
    weaknessId: z.number().int().positive().nullable(),
  })
  .strict();
const cardEvaluationSchema = z
  .object({
    feedbackMarkdown: z.string().trim().min(1),
    score: z.number().int().min(0).max(100),
    weaknessOutcomes: z.array(weaknessOutcomeSchema),
  })
  .strict();

const expectedAnswerModes = {
  feynman: "single_turn",
  relationship: "single_turn",
  contrast: "single_turn",
  debugging: "single_turn",
  diagnostic: "single_turn",
  drill: "single_turn",
  quiz: "single_turn",
  scenario: "multi_turn",
};

function compact(value, maxLength = 48_000) {
  const content = String(value || "").trim();
  return content.length <= maxLength ? content : `${content.slice(0, maxLength)}\n\n[truncated]`;
}

function reportProgress(onProgress, progress) {
  if (typeof onProgress !== "function") return;
  onProgress({
    completed: Number(progress.completed || 0),
    label: String(progress.label || ""),
    phase: String(progress.phase || "planning"),
    total: Math.max(1, Number(progress.total || 1)),
  });
}

function formatConcepts(mastery) {
  return mastery.concepts
    .map((concept) =>
      [
        `ID: ${concept.id}`,
        `Name: ${concept.name}`,
        `Type: ${concept.type || "concept"}`,
        `Overall score: ${concept.overallScore}`,
        `Stage evidence: ${concept.stageStates.map((state) => `${state.stage}=${Math.round(state.score)}`).join(", ")}`,
        `Explanation:\n${concept.explanationMarkdown}`,
      ].join("\n"),
    )
    .join("\n\n---\n\n");
}

function formatWeaknesses(weaknesses) {
  const active = weaknesses.filter((weakness) => weakness.status === "active");
  if (active.length === 0) return "No active weaknesses.";
  return active
    .map((weakness) =>
      [
        `ID: ${weakness.id}`,
        `Title: ${weakness.title}`,
        `Description: ${weakness.description}`,
        `Targets: ${weakness.targets.map((target) => `${target.conceptName} (stage ${target.stage})`).join(", ")}`,
      ].join("\n"),
    )
    .join("\n\n");
}

function formatExistingCards(cards) {
  if (cards.length === 0) return "No existing cards.";
  return cards
    .slice(0, 120)
    .map((card) =>
      [
        `Card ${card.id} [${card.status}]`,
        `Kind and difficulty: ${card.kind}, ${card.difficulty}`,
        `Targets: ${card.targets.map((target) => `${target.conceptName}/stage ${target.stage}`).join(", ")}`,
        `Prompt: ${compact(card.promptMarkdown, 500)}`,
      ].join("\n"),
    )
    .join("\n\n");
}

function formatGraph(graph) {
  if (!graph || graph.nodes.length === 0) return "No graph concepts or relations.";
  const nodeNames = new Map(graph.nodes.map((node) => [node.id, node.name]));
  return [
    "Concepts:",
    ...graph.nodes.map((node) => `- ${node.name}: ${node.summary || node.explanation || node.type || ""}`),
    "Relations:",
    ...graph.edges.map(
      (edge) =>
        `- Edge ${edge.id}: ${nodeNames.get(edge.source) || edge.source} --${edge.relation}--> ${nodeNames.get(edge.target) || edge.target}${edge.explanation ? `: ${edge.explanation}` : ""}`,
    ),
  ].join("\n");
}

function formatScoring(masterySettings) {
  return cardKinds
    .map(
      (kind) =>
        `${kind}: ${cardDifficulties.map((difficulty) => `${difficulty}=${masterySettings.points[kind][difficulty]}`).join(", ")}`,
    )
    .join("\n");
}

function selectedGraphContext(graph, edgeIds) {
  const nodeNames = new Map(graph.nodes.map((node) => [node.id, node.name]));
  const edgesById = new Map(graph.edges.map((edge) => [edge.id, edge]));

  return edgeIds
    .map((edgeId) => {
      const edge = edgesById.get(edgeId);
      if (!edge) return "";
      const relation = String(edge.relation || "relates to").replace(/_/g, " ");
      const explanation = String(edge.explanation || "").trim();
      return `- **${nodeNames.get(edge.source) || edge.source}** -> ${relation} -> **${nodeNames.get(edge.target) || edge.target}**${explanation ? `: ${explanation}` : ""}`;
    })
    .filter(Boolean)
    .join("\n");
}

async function ensureGraphForCards({ documentPath, markdown, onProgress, settings }) {
  let graph = getDocumentGraph(documentPath);
  if (graph.nodes.length > 0) return graph;

  reportProgress(onProgress, { completed: 0, label: "Building knowledge graph", phase: "graph", total: 1 });
  const result = await extractDocumentGraph(documentPath, await readDocumentFile(documentPath), markdown, settings);
  graph = result.graph;
  reportProgress(onProgress, { completed: 1, label: "Knowledge graph ready", phase: "graph", total: 1 });
  return graph;
}

function prepareGeneratedCards(cards, mastery, graph, weaknesses, { skipInvalid = false } = {}) {
  const concepts = mastery.concepts;
  const conceptIds = new Set(concepts.map((concept) => concept.id));
  const conceptsById = new Map(concepts.map((concept) => [concept.id, concept]));
  const graphEdgeIds = new Set(graph.edges.map((edge) => edge.id));
  const activeWeaknessIds = new Set(
    weaknesses.filter((weakness) => weakness.status === "active").map((weakness) => weakness.id),
  );

  const prepared = [];
  cards.forEach((card, cardIndex) => {
    try {
      const targetKeys = new Set();
      card.targets.forEach((target) => {
        if (!conceptIds.has(target.conceptId)) {
          throw new Error(`Generated card ${cardIndex + 1} references unknown concept ${target.conceptId}.`);
        }
        const key = `${target.conceptId}:${target.stage}`;
        if (targetKeys.has(key)) throw new Error(`Generated card ${cardIndex + 1} repeats target ${key}.`);
        targetKeys.add(key);
      });

      const uniqueConceptIds = [...new Set(card.targets.map((target) => target.conceptId))];
      const assertConceptCount = (minimum, maximum) => {
        if (uniqueConceptIds.length < minimum || uniqueConceptIds.length > maximum) {
          const expected = minimum === maximum ? `${minimum}` : `${minimum}-${maximum}`;
          throw new Error(`Generated ${card.kind} card ${cardIndex + 1} must cover ${expected} concept${maximum === 1 ? "" : "s"}.`);
        }
      };

    if (card.answerMode !== expectedAnswerModes[card.kind]) {
      throw new Error(`Generated ${card.kind} card ${cardIndex + 1} has the wrong interaction mode.`);
    }

    if (card.kind === "feynman") {
      assertConceptCount(1, 1);
      if (!mastery.metaphor) throw new Error("Feynman cards require a generated metaphor.");
    } else if (card.kind === "relationship") {
      assertConceptCount(2, 5);
      if (card.graphEdgeIds.length === 0 || card.graphEdgeIds.length > 5) {
        throw new Error("Relationship cards must select one to five visible knowledge-graph edges.");
      }
    } else if (card.kind === "contrast") {
      assertConceptCount(2, 4);
    } else if (card.kind === "debugging") {
      assertConceptCount(1, 4);
      if (!card.contextMarkdown.trim()) throw new Error("Debugging cards must include the faulty artifact or incident.");
    } else if (card.kind === "diagnostic") {
      assertConceptCount(1, 1);
    } else if (card.kind === "drill") {
      assertConceptCount(1, 4);
    } else if (card.kind === "quiz") {
      assertConceptCount(1, 5);
    } else if (card.kind === "scenario") {
      assertConceptCount(1, 5);
      if (!card.contextMarkdown.trim()) throw new Error("Scenarios must include a concrete environment and starting state.");
    }

    const uniqueGraphEdgeIds = [...new Set(card.graphEdgeIds)];
    uniqueGraphEdgeIds.forEach((edgeId) => {
      if (!graphEdgeIds.has(edgeId)) throw new Error(`Generated card ${cardIndex + 1} references unknown graph edge ${edgeId}.`);
    });
    if (card.kind !== "relationship" && uniqueGraphEdgeIds.length > 0) {
      throw new Error(`Only relationship cards may present graph edges; card ${cardIndex + 1} must not select them.`);
    }

    card.targetedWeaknessIds.forEach((weaknessId) => {
      if (!activeWeaknessIds.has(weaknessId)) {
        throw new Error(`Generated card ${cardIndex + 1} references inactive weakness ${weaknessId}.`);
      }
    });

      const hasAuthoredContext = ["contrast", "debugging", "drill", "quiz", "scenario"].includes(card.kind);
      const primaryConcept = conceptsById.get(uniqueConceptIds[0]);
      prepared.push({
        ...card,
        conceptContextVisible: card.kind === "feynman",
        contextMarkdown:
          card.kind === "relationship"
            ? selectedGraphContext(graph, uniqueGraphEdgeIds)
            : hasAuthoredContext
              ? card.contextMarkdown.trim()
              : "",
        graphEdgeIds: uniqueGraphEdgeIds,
        metaphorContextVisible: card.kind === "feynman",
        promptMarkdown:
          card.kind === "feynman"
            ? "Teach this concept in your own words. Do not copy the concept card's wording."
            : card.promptMarkdown,
        title: card.kind === "feynman" && primaryConcept ? primaryConcept.name : card.title,
      });
    } catch (error) {
      if (!skipInvalid) throw error;
      console.warn("Skipping invalid generated mastery card:", error instanceof Error ? error.message : error);
    }
  });
  return prepared;
}

const networkFewShotRequest = [
  "Example input (illustrative IDs only):",
  "Concept 101: Idempotency keys prevent a repeated logical request from creating repeated effects.",
  "Concept 102: A lost acknowledgement can make a sender retry completed work.",
  "Graph edge 77: lost acknowledgement -> causes -> retry after successful processing.",
  "A metaphor is available. The learner needs explanation, relationship reasoning, and failure diagnosis.",
].join("\n");

const networkFewShotResponse = JSON.stringify({
  cards: [
    {
      answerMode: "single_turn",
      contextMarkdown: "",
      difficulty: "standard",
      expectedAnswerMarkdown:
        "An idempotency key gives every logical request a stable identity. The receiver stores the result for that identity. If a timeout causes the same request to arrive again, the receiver returns the stored result instead of applying the business change again. For example, two deliveries of one payment request can still produce one charge.",
      graphEdgeIds: [],
      kind: "feynman",
      promptMarkdown: "Teach this concept in your own words. Do not copy the concept card's wording.",
      rubricMarkdown:
        "The explanation states what the stable key identifies, what the receiver remembers, why retries occur, and how repeated delivery becomes one visible effect. Equivalent plain-language explanations pass.",
      targetedWeaknessIds: [],
      targets: [
        { conceptId: 101, stage: 2 },
        { conceptId: 101, stage: 3 },
      ],
      title: "Idempotency keys",
    },
    {
      answerMode: "single_turn",
      contextMarkdown: "",
      difficulty: "advanced",
      expectedAnswerMarkdown:
        "The sender cannot distinguish a lost request from a lost acknowledgement. Retrying improves the chance of completion, but it can deliver work that already succeeded. A stable request identity lets the receiver recognize that both deliveries represent one operation and reuse the first result.",
      graphEdgeIds: [77],
      kind: "relationship",
      promptMarkdown:
        "Explain how the shown failure path creates duplicate work, then explain where an idempotency key changes that path.",
      rubricMarkdown:
        "The answer follows the actual edge, identifies the sender's uncertainty, distinguishes delivery from effect, and places duplicate detection at the receiver or operation boundary.",
      targetedWeaknessIds: [],
      targets: [
        { conceptId: 101, stage: 4 },
        { conceptId: 102, stage: 4 },
      ],
      title: "From a lost acknowledgement to a duplicate effect",
    },
    {
      answerMode: "single_turn",
      contextMarkdown:
        "A payment endpoint retries on timeout. It creates a new request ID on every retry. Logs show two successful charges followed by one client-visible success.",
      difficulty: "advanced",
      expectedAnswerMarkdown:
        "The retry identity is unstable, so the receiver cannot recognize the second delivery as the same logical payment. Reuse one idempotency key across retries and atomically store that key with the charge result. A repeated request can then return the recorded result without charging again.",
      graphEdgeIds: [],
      kind: "debugging",
      promptMarkdown: "Find the assumption that failed and propose the smallest fix that prevents the duplicate charge.",
      rubricMarkdown:
        "The answer identifies changing request identity as the defect and proposes stable identity plus durable, atomic result recording. Generic advice to retry less does not pass.",
      targetedWeaknessIds: [],
      targets: [
        { conceptId: 101, stage: 5 },
        { conceptId: 102, stage: 5 },
      ],
      title: "Two charges after one timeout",
    },
  ],
});

const proceduralFewShotRequest = [
  "Example input (illustrative ID only):",
  "Concept 201: The chain rule differentiates a composition by multiplying the outer and inner derivatives.",
  "The learner understands the statement but needs procedural practice and transfer. Generate useful additional cards.",
].join("\n");

const proceduralFewShotResponse = JSON.stringify({
  cards: [
    {
      answerMode: "single_turn",
      contextMarkdown: "Differentiate `f(x) = (3x^2 + 1)^5`. Show each intermediate derivative before simplifying.",
      difficulty: "standard",
      expectedAnswerMarkdown:
        "Let `u = 3x^2 + 1`. Then `f = u^5`, so `df/du = 5u^4` and `du/dx = 6x`. Therefore `df/dx = 5(3x^2 + 1)^4(6x) = 30x(3x^2 + 1)^4`.",
      graphEdgeIds: [],
      kind: "drill",
      promptMarkdown: "Solve the problem and show where the outer and inner derivatives enter the product.",
      rubricMarkdown:
        "The substitution or equivalent composition is correct, both derivatives are correct, and the final multiplication includes the inner derivative.",
      targetedWeaknessIds: [],
      targets: [{ conceptId: 201, stage: 5 }],
      title: "Apply the chain rule without skipping the inner derivative",
    },
    {
      answerMode: "single_turn",
      contextMarkdown:
        "A model uses `y = sigmoid(w^T x)`. Derive the gradient with respect to `w`, then state what happens to its magnitude when the sigmoid output is very close to 0 or 1.",
      difficulty: "advanced",
      expectedAnswerMarkdown:
        "With `z = w^T x`, `dy/dz = y(1-y)` and `dz/dw = x`, so `dy/dw = y(1-y)x`. Near 0 or 1, `y(1-y)` is near zero, so the gradient passed through the sigmoid becomes small.",
      graphEdgeIds: [],
      kind: "quiz",
      promptMarkdown: "Derive the gradient and use the expression to reason about saturation.",
      rubricMarkdown:
        "The derivation applies the chain rule to both layers and the saturation explanation follows from the multiplicative derivative rather than a memorized claim.",
      targetedWeaknessIds: [],
      targets: [
        { conceptId: 201, stage: 5 },
        { conceptId: 201, stage: 6 },
      ],
      title: "Transfer the chain rule to a sigmoid model",
    },
  ],
});

async function requestGeneratedCards({
  documentPath,
  generationPrompt,
  graph,
  mastery,
  masterySettings,
  minimumNewCards,
  settings,
  state,
  targetProficiency,
}) {
  const targetScore = masterySettings.thresholds[targetProficiency];
  const response = await requestStructuredOutput({
    schema: generatedCardsSchema,
    schemaName: "mastery_flashcards",
    modelKey: "chatModel",
    settings,
    temperature: 0.2,
    timeoutMs: 180_000,
    messages: [
      {
        role: "system",
        content: [
          "You design additional adaptive study cards from detailed mastery concepts.",
          "Choose the number and mix that best advances the learner toward the note's target proficiency. Do not force equal counts or coverage.",
          "Card kind and mastery stage are independent. Never select a kind because of a stage number.",
          "Stages are evidence tags only: 2=plain comprehension, 3=connections and usable mental models, 4=relationships and distinctions, 5=fault finding and reliable execution, 6=transfer to difficult new situations.",
          "A card may target several concept-stage pairs only when a successful answer directly demonstrates every pair. Do not attach unrelated targets to gain credit.",
          "Concept-count rules use unique concept IDs, not the number of concept-stage target pairs:",
          "- feynman: exactly 1 concept.",
          "- diagnostic: exactly 1 concept.",
          "- relationship: 2-5 concepts.",
          "- contrast: 2-4 concepts.",
          "- debugging: 1-4 concepts.",
          "- drill: 1-4 concepts.",
          "- quiz: 1-5 concepts.",
          "- scenario: 1-5 concepts.",
          "Select card kinds by the learning operation the material needs:",
          "- feynman: show exactly one concept card and its metaphor, then ask the learner to teach it in their own words. The app supplies the prompt. This is not a quiz or checklist.",
          "- relationship: show one to five actual supplied graph edges and ask one focused question about why the relationship matters or how effects propagate.",
          "- contrast: isolate a consequential distinction the learner may confuse. Do not turn Feynman cards into comparisons.",
          "- debugging: provide a concrete faulty claim, proof, trace, design, code fragment, or incident in contextMarkdown and ask the learner to diagnose and repair it.",
          "- diagnostic: hide the concept and ask for a focused explanation from memory so the evaluator can locate a specific gap. Do not write a multi-part answer checklist.",
          "- drill: one focused procedural or reasoning exercise, including mathematics, algorithms, proofs, or repeated technical practice. Require intermediate work when it is diagnostic.",
          "- quiz: one coherent, demanding problem that tests independent reasoning. Never bundle unrelated questions.",
          "- scenario: a bounded multi-turn work or project simulation with role, constraints, and a concrete starting state.",
          "Do not generate passive review cards, metaphor-recall cards, scene-reconstruction cards, or generic definition quizzes.",
          "Feynman cards require an available metaphor, use one concept, single_turn, contextMarkdown='', graphEdgeIds=[], and the exact prompt: Teach this concept in your own words. Do not copy the concept card's wording.",
          "Relationship cards use 2-5 concepts, single_turn, and graphEdgeIds from the supplied graph. The app replaces contextMarkdown with those exact visible edges.",
          "If the supplied graph has no edges, do not generate a relationship card.",
          "Contrast cards use 2-4 concepts and single_turn. Debugging, diagnostic, drill, and quiz cards use single_turn. Scenario cards use multi_turn.",
          "All non-relationship cards use graphEdgeIds=[]. Debugging and scenario cards require concrete contextMarkdown.",
          "Before answering, only Feynman cards reveal concept and metaphor content. Other cards may reveal concepts after evaluation.",
          "Difficulty describes cognitive demand: introductory=direct supported use, standard=independent routine use, advanced=multi-step or unfamiliar transfer, expert=ambiguous or synthesis-heavy work.",
          "Write detailed expectedAnswerMarkdown that can teach the learner after reveal. Do not use buzzwords as substitutes for mechanisms or reasoning.",
          "rubricMarkdown must state observable evidence for the configured pass score without requiring the sample answer's exact wording.",
          "When a card directly works on an active weakness, include that weakness ID. Do not keep targeting resolved weaknesses.",
          "The note-level generation prompt is a learner preference. Follow it unless it conflicts with these card contracts.",
          "Before returning JSON, verify every card against its interaction mode, unique concept-count rule, graph-edge rule, and required context rule. Remove or repair any card that violates a rule.",
          "The examples that follow demonstrate card shape, not card-type-to-stage mappings.",
        ].join("\n"),
      },
      { role: "user", content: networkFewShotRequest },
      { role: "assistant", content: networkFewShotResponse },
      { role: "user", content: proceduralFewShotRequest },
      { role: "assistant", content: proceduralFewShotResponse },
      {
        role: "user",
        content: [
          `Document: ${documentPath}`,
          `Learner profile: ${settings?.userProfile || "No learner profile supplied."}`,
          `Target proficiency: ${targetProficiency} (${targetScore}/100 overall).`,
          `Persistent generation prompt: ${String(generationPrompt || "").trim() || "No additional preference."}`,
          `Evaluation pass score: ${masterySettings.passingScore}/100.`,
          minimumNewCards === null
            ? "Choose the number of useful new cards based on the learning needs."
            : `Generate at least ${minimumNewCards + 2} useful new cards. At least ${minimumNewCards} must remain valid after contract checks so the learner can start the requested practice set.`,
          "Points awarded to every targeted concept-stage pair after a pass:",
          formatScoring(masterySettings),
          "",
          "Mastery concepts:",
          formatConcepts(mastery),
          "",
          "Active weaknesses:",
          formatWeaknesses(state.weaknesses),
          "",
          "Existing cards to avoid repeating:",
          formatExistingCards(state.cards),
          "",
          "Knowledge graph:",
          compact(formatGraph(graph), 30_000),
          "",
          "Shared metaphor:",
          mastery.metaphor
            ? compact(
                `${mastery.metaphor.title}\n${mastery.metaphor.memorySceneMarkdown}\n${mastery.metaphor.conceptScenes
                  .map((scene) => `${scene.conceptId}: ${scene.roleName} - ${scene.sceneMarkdown}`)
                  .join("\n")}`,
                16_000,
              )
            : "No metaphor generated. Do not generate Feynman cards in this batch.",
        ].join("\n"),
      },
    ],
  });

  const parsed = generatedCardsSchema.safeParse(response.data);
  if (!parsed.success) {
    throw new Error(`Flashcard generation failed validation: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
  }
  const cards = prepareGeneratedCards(parsed.data.cards, mastery, graph, state.weaknesses, { skipInvalid: true });
  if (cards.length === 0) {
    throw new Error("Generated cards did not satisfy the mastery card contracts. Try generating again.");
  }
  return {
    cards,
    model: response.model,
  };
}

async function requestDiscussionResponse({ card, conceptContext, message, priorMessages, settings }) {
  const response = await requestStructuredOutput({
    schema: discussionResponseSchema,
    schemaName: "mastery_drill_turn",
    modelKey: "chatModel",
    settings,
    temperature: 0.2,
    timeoutMs: 120_000,
    messages: [
      {
        role: "system",
        content: [
          "Conduct the bounded card interaction. Do not turn it into a lecture.",
          `Card kind: ${card.kind}`,
          `Difficulty: ${card.difficulty}`,
          "Ask one useful follow-up at a time when the learner's decision or reasoning is incomplete.",
          "Do not reveal the sample answer during the interaction.",
          "Set shouldEnd=true when there is enough evidence to evaluate the rubric or the learner explicitly asks to end.",
          "For a scenario, play the environment consistently and introduce only constraints relevant to the task.",
          `Prompt:\n${card.promptMarkdown}`,
          card.contextMarkdown ? `Visible context:\n${card.contextMarkdown}` : "",
          `Rubric:\n${card.rubricMarkdown}`,
          `Learner profile: ${settings?.userProfile || "Not supplied."}`,
          card.conceptContextVisible ? `Visible concept context:\n${conceptContext}` : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
      ...priorMessages.map((entry) => ({ role: entry.role, content: entry.contentMarkdown })),
      { role: "user", content: message },
    ],
  });
  const parsed = discussionResponseSchema.safeParse(response.data);
  if (!parsed.success) throw new Error("The card response did not match the expected structure.");
  return parsed.data;
}

async function requestCardEvaluation({ answerMarkdown, card, conceptContext, passingScore, settings, weaknesses }) {
  const response = await requestStructuredOutput({
    schema: cardEvaluationSchema,
    schemaName: "mastery_card_evaluation",
    modelKey: "chatModel",
    settings,
    temperature: 0.1,
    timeoutMs: 150_000,
    messages: [
      {
        role: "system",
        content: [
          "Evaluate the learner's demonstrated reasoning against the task and rubric.",
          `Return a score from 0 to 100. The configured pass score is ${passingScore}.`,
          "The sample answer is one good answer, not wording the learner must reproduce.",
          "feedbackMarkdown must say what worked, identify the most important gap in plain language, and explain how to improve it.",
          "For Feynman and diagnostic answers, reward a correct plain-language causal explanation. Do not demand a quiz-style checklist that the prompt did not ask for.",
          "Return an outcome for every supplied targeted weakness.",
          `Resolve a targeted weakness only when the answer directly demonstrates that it is absent and the total score is at least ${passingScore}.`,
          "Record only material, reusable misconceptions or reasoning gaps as new weaknesses. Do not turn minor wording issues into weaknesses.",
          "Use only the supplied concept IDs and stages.",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `Card kind: ${card.kind}`,
          `Difficulty: ${card.difficulty}`,
          `Targets: ${card.targets.map((target) => `${target.conceptName} (ID ${target.conceptId}, stage ${target.stage})`).join(", ")}`,
          `Prompt:\n${card.promptMarkdown}`,
          card.contextMarkdown ? `Visible context:\n${card.contextMarkdown}` : "",
          `Sample answer:\n${card.expectedAnswerMarkdown}`,
          `Rubric:\n${card.rubricMarkdown}`,
          `Targeted weaknesses:\n${formatWeaknesses(weaknesses)}`,
          `Concept source context:\n${conceptContext}`,
          `Learner answer:\n${answerMarkdown}`,
        ].join("\n\n"),
      },
    ],
  });
  const parsed = cardEvaluationSchema.safeParse(response.data);
  if (!parsed.success) {
    throw new Error(`Card evaluation failed validation: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
  }
  return { ...parsed.data, model: response.model };
}

module.exports = {
  ensureGraphForCards,
  prepareGeneratedCards,
  reportProgress,
  requestCardEvaluation,
  requestDiscussionResponse,
  requestGeneratedCards,
};
