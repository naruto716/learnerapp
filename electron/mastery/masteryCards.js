const { getDocumentMastery, normalizeDocumentPath } = require("./masteryConcepts");
const { answerModes, cardKinds, ensureMasteryCardSchema } = require("./masteryCardSchema");
const { normalizeMasteryScoringSettings } = require("./masteryScoring");
const {
  ensureGraphForCards,
  reportProgress,
  requestCardEvaluation,
  requestDiscussionResponse,
  requestGeneratedCards,
} = require("./masteryCardAi");
const { saveCardEvaluation, targetedWeaknesses } = require("./masteryCardProgress");
const {
  appendDiscussionTurn,
  clearDocumentMasteryCards,
  getCardContext,
  getDocumentCardPreferences,
  getDocumentMasteryCards,
  saveDocumentCardPreferences,
  saveGeneratedCards,
} = require("./masteryCardStore");

function cardConceptContext(card, mastery) {
  const conceptIds = new Set(card.targets.map((target) => target.conceptId));
  return mastery.concepts
    .filter((concept) => conceptIds.has(concept.id))
    .map((concept) => `## ${concept.name}\n\n${concept.explanationMarkdown}`)
    .join("\n\n");
}

async function generateDocumentMasteryCards({
  documentPath,
  generationPrompt,
  instruction,
  markdown = "",
  masterySettings = {},
  minimumReadyCards,
  onProgress,
  settings = {},
  targetProficiency,
}) {
  ensureMasteryCardSchema();
  const normalizedPath = normalizeDocumentPath(documentPath);
  if (!normalizedPath) throw new Error("Document path is required.");
  const normalizedMasterySettings = normalizeMasteryScoringSettings(masterySettings);
  const currentPreferences = getDocumentCardPreferences(normalizedPath);
  const preferences = saveDocumentCardPreferences(normalizedPath, {
    generationPrompt:
      generationPrompt !== undefined
        ? generationPrompt
        : instruction !== undefined
          ? instruction
          : currentPreferences.generationPrompt,
    targetProficiency: targetProficiency || currentPreferences.targetProficiency,
  });

  const mastery = getDocumentMastery(normalizedPath, markdown);
  if (mastery.concepts.length === 0) throw new Error("Extract mastery concepts before generating flashcards.");

  reportProgress(onProgress, { completed: 0, label: "Preparing card context", phase: "planning", total: 1 });
  const graph = await ensureGraphForCards({ documentPath: normalizedPath, markdown, onProgress, settings });
  const state = getDocumentMasteryCards(normalizedPath);
  const readyCardCount = state.cards.filter((card) => card.status === "active").length;
  const minimumNewCards = minimumReadyCards === undefined
    ? null
    : Math.max(0, Math.ceil(Number(minimumReadyCards) || 0) - readyCardCount);
  if (minimumNewCards === 0) return state;
  reportProgress(onProgress, {
    completed: 0,
    label: "Generating adaptive flashcards",
    phase: "planning",
    total: 1,
  });
  const generated = await requestGeneratedCards({
    documentPath: normalizedPath,
    generationPrompt: preferences.generationPrompt,
    graph,
    mastery,
    masterySettings: normalizedMasterySettings,
    minimumNewCards,
    settings,
    state,
    targetProficiency: preferences.targetProficiency,
  });
  if (minimumNewCards !== null && generated.cards.length < minimumNewCards) {
    throw new Error(`Card generation returned ${generated.cards.length}; ${minimumNewCards} are required for practice.`);
  }

  reportProgress(onProgress, {
    completed: 0,
    label: `Saving ${generated.cards.length} generated card${generated.cards.length === 1 ? "" : "s"}`,
    phase: "saving",
    total: 1,
  });
  saveGeneratedCards({
    cards: generated.cards,
    documentPath: normalizedPath,
    generationPrompt: preferences.generationPrompt,
    model: generated.model,
  });
  reportProgress(onProgress, { completed: 1, label: "Flashcards ready", phase: "done", total: 1 });
  return getDocumentMasteryCards(normalizedPath);
}

async function continueMasteryCardDiscussion({ cardId, documentPath, markdown = "", message, settings = {} }) {
  ensureMasteryCardSchema();
  const normalizedPath = normalizeDocumentPath(documentPath);
  const cleanMessage = String(message || "").trim();
  if (!cleanMessage) throw new Error("Write a response before continuing the discussion.");

  const { card } = getCardContext(cardId, normalizedPath);
  if (card.answerMode !== "multi_turn") throw new Error("This card does not use a multi-turn discussion.");
  if (card.status === "done") throw new Error("This card is already complete.");

  const mastery = getDocumentMastery(normalizedPath, markdown);
  const response = await requestDiscussionResponse({
    card,
    conceptContext: cardConceptContext(card, mastery),
    message: cleanMessage,
    priorMessages: card.messages,
    settings,
  });
  appendDiscussionTurn(card.id, cleanMessage, response.replyMarkdown);

  return {
    replyMarkdown: response.replyMarkdown,
    shouldEnd: response.shouldEnd,
    state: getDocumentMasteryCards(normalizedPath),
  };
}

function formatAttemptAnswer(card, answerMarkdown) {
  if (card.answerMode !== "multi_turn") return String(answerMarkdown || "").trim();
  return card.messages
    .map((message) => `${message.role === "assistant" ? "Drill" : "Learner"}: ${message.contentMarkdown}`)
    .join("\n\n");
}

async function evaluateMasteryCard({
  answerMarkdown = "",
  cardId,
  documentPath,
  markdown = "",
  masterySettings = {},
  settings = {},
}) {
  ensureMasteryCardSchema();
  const normalizedPath = normalizeDocumentPath(documentPath);
  const { card, state } = getCardContext(cardId, normalizedPath);
  if (card.status === "done") throw new Error("This card is already complete.");

  const finalAnswer = formatAttemptAnswer(card, answerMarkdown);
  if (!finalAnswer.trim()) throw new Error("Answer the card before requesting evaluation.");
  const normalizedMasterySettings = normalizeMasteryScoringSettings(masterySettings);
  const mastery = getDocumentMastery(normalizedPath, markdown);
  const evaluation = await requestCardEvaluation({
    answerMarkdown: finalAnswer,
    card,
    conceptContext: cardConceptContext(card, mastery),
    passingScore: normalizedMasterySettings.passingScore,
    settings,
    weaknesses: targetedWeaknesses(card, state),
  });
  saveCardEvaluation({
    answerMarkdown: finalAnswer,
    card,
    documentPath: normalizedPath,
    evaluation,
    mastery,
    masterySettings: normalizedMasterySettings,
    state,
  });
  return getDocumentMasteryCards(normalizedPath);
}

module.exports = {
  answerModes,
  cardKinds,
  clearDocumentMasteryCards,
  continueMasteryCardDiscussion,
  ensureMasteryCardSchema,
  evaluateMasteryCard,
  generateDocumentMasteryCards,
  getDocumentMasteryCards,
};
