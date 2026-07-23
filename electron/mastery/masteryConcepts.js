const { app } = require("electron");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { z } = require("zod");
const { requestStructuredOutput } = require("../aiClient");
const { getAiSettings } = require("../aiSettings");
const { operationLog } = require("../operationLog");
const { resolveDocumentAssetPath, saveDocumentImage } = require("../documentUtil");
const { generateImage } = require("../imageGeneration");
const { normalizeMasteryScoringSettings } = require("./masteryScoring");

const databaseFileName = "learner.sqlite";
let masteryDatabase = null;

const masteryLevels = ["new", "familiar", "developing", "proficient", "advanced", "mastered"];
const masteryStages = [2, 3, 4, 5, 6];

const generatedConceptSchema = z
  .object({
    explanationMarkdown: z.string().trim().min(1),
    masteryLevel: z.enum(masteryLevels),
    masteryRationale: z.string().trim().min(1),
    name: z.string().trim().min(1),
    previousConceptId: z.number().int().nullable(),
    sourceExcerptMarkdown: z.string().trim().min(1),
    type: z.string().trim().min(1),
  })
  .strict();

const masteryExtractionSchema = z
  .object({
    concepts: z.array(generatedConceptSchema),
  })
  .strict();

const generatedMetaphorConceptSceneSchema = z
  .object({
    conceptId: z.number().int(),
    imagePrompt: z.string().trim().min(1),
    roleName: z.string().trim().min(1),
    sceneMarkdown: z.string().trim().min(1),
    visceralCueMarkdown: z.string().trim().min(1),
  })
  .strict();

const masteryMetaphorSchema = z
  .object({
    conceptScenes: z.array(generatedMetaphorConceptSceneSchema),
    imagePrompt: z.string().trim().min(1),
    memorySceneMarkdown: z.string().trim().min(1),
    title: z.string().trim().min(1),
  })
  .strict();

function getMasteryDatabasePath() {
  return path.join(app.getPath("userData"), databaseFileName);
}

function getMasteryDatabase() {
  if (masteryDatabase) return masteryDatabase;

  const databasePath = getMasteryDatabasePath();
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });

  masteryDatabase = new DatabaseSync(databasePath);
  masteryDatabase.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS mastery_generation_runs (
      id INTEGER PRIMARY KEY,
      document_path TEXT NOT NULL,
      document_hash TEXT NOT NULL,
      model TEXT,
      generated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS mastery_generation_runs_document_index
      ON mastery_generation_runs(document_path, generated_at);

    CREATE TABLE IF NOT EXISTS mastery_concepts (
      id INTEGER PRIMARY KEY,
      document_path TEXT NOT NULL,
      run_id INTEGER,
      stable_key TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT,
      explanation_markdown TEXT,
      source_excerpt_markdown TEXT,
      mastery_level TEXT NOT NULL DEFAULT 'new',
      mastery_rationale TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(document_path, stable_key),
      FOREIGN KEY(run_id) REFERENCES mastery_generation_runs(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS mastery_concepts_document_index
      ON mastery_concepts(document_path, status, sort_order);

    CREATE TABLE IF NOT EXISTS mastery_stage_states (
      concept_id INTEGER NOT NULL,
      stage INTEGER NOT NULL CHECK(stage BETWEEN 2 AND 6),
      score REAL NOT NULL DEFAULT 0 CHECK(score BETWEEN 0 AND 100),
      attempt_count INTEGER NOT NULL DEFAULT 0,
      last_reviewed_at INTEGER,
      next_due_at INTEGER,
      fsrs_difficulty REAL,
      fsrs_stability REAL,
      fsrs_retrievability REAL,
      fsrs_state INTEGER NOT NULL DEFAULT 0,
      fsrs_scheduled_days INTEGER NOT NULL DEFAULT 0,
      fsrs_learning_steps INTEGER NOT NULL DEFAULT 0,
      lapse_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(concept_id, stage),
      FOREIGN KEY(concept_id) REFERENCES mastery_concepts(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS mastery_stage_states_due_index
      ON mastery_stage_states(status, next_due_at);

    CREATE TABLE IF NOT EXISTS mastery_metaphor_runs (
      id INTEGER PRIMARY KEY,
      document_path TEXT NOT NULL,
      document_hash TEXT NOT NULL,
      concept_signature TEXT NOT NULL,
      model TEXT,
      image_model TEXT,
      title TEXT NOT NULL,
      memory_scene_markdown TEXT NOT NULL,
      image_prompt TEXT NOT NULL,
      image_path TEXT,
      generated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS mastery_metaphor_runs_document_index
      ON mastery_metaphor_runs(document_path, generated_at);

    CREATE TABLE IF NOT EXISTS mastery_metaphor_concept_scenes (
      id INTEGER PRIMARY KEY,
      metaphor_run_id INTEGER NOT NULL,
      concept_id INTEGER NOT NULL,
      concept_name TEXT NOT NULL,
      role_name TEXT NOT NULL,
      scene_markdown TEXT NOT NULL,
      visceral_cue_markdown TEXT NOT NULL,
      image_prompt TEXT NOT NULL,
      image_path TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY(metaphor_run_id) REFERENCES mastery_metaphor_runs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS mastery_metaphor_concept_scenes_run_index
      ON mastery_metaphor_concept_scenes(metaphor_run_id, sort_order);
  `);
  migrateMasteryConceptsSchema(masteryDatabase);
  cleanStoredMasteryConceptExplanations(masteryDatabase);

  return masteryDatabase;
}

function closeMasteryDatabase() {
  if (!masteryDatabase) return;
  masteryDatabase.close();
  masteryDatabase = null;
}

function tableHasColumn(db, tableName, columnName) {
  return db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all()
    .some((column) => column.name === columnName);
}

function tableExists(db, tableName) {
  return Boolean(
    db
      .prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?")
      .get(tableName),
  );
}

function migrateMasteryConceptsSchema(db) {
  if (!tableHasColumn(db, "mastery_concepts", "summary_markdown")) return;

  db.exec("PRAGMA foreign_keys = OFF");
  try {
    db.exec(`
      BEGIN IMMEDIATE;

      CREATE TABLE mastery_concepts_next (
        id INTEGER PRIMARY KEY,
        document_path TEXT NOT NULL,
        run_id INTEGER,
        stable_key TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT,
        explanation_markdown TEXT,
        source_excerpt_markdown TEXT,
        mastery_level TEXT NOT NULL DEFAULT 'new',
        mastery_rationale TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(document_path, stable_key),
        FOREIGN KEY(run_id) REFERENCES mastery_generation_runs(id) ON DELETE SET NULL
      );

      INSERT INTO mastery_concepts_next(
        id,
        document_path,
        run_id,
        stable_key,
        name,
        type,
        explanation_markdown,
        source_excerpt_markdown,
        mastery_level,
        mastery_rationale,
        status,
        sort_order,
        created_at,
        updated_at
      )
      SELECT
        id,
        document_path,
        run_id,
        stable_key,
        name,
        type,
        explanation_markdown,
        source_excerpt_markdown,
        mastery_level,
        mastery_rationale,
        status,
        sort_order,
        created_at,
        updated_at
      FROM mastery_concepts;

      DROP TABLE mastery_concepts;
      ALTER TABLE mastery_concepts_next RENAME TO mastery_concepts;

      CREATE INDEX IF NOT EXISTS mastery_concepts_document_index
        ON mastery_concepts(document_path, status, sort_order);

      COMMIT;
    `);
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Ignore rollback errors; the original migration error is more useful.
    }
    throw error;
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}

function cleanExplanationMarkdown(value) {
  const original = String(value || "").trim();
  const cleaned = original
    .replace(/\s+To review this,?[\s\S]*$/i, "")
    .replace(/\s+To practice this,?[\s\S]*$/i, "")
    .trim();

  return cleaned || original;
}

function cleanStoredMasteryConceptExplanations(db) {
  const rows = db
    .prepare(
      `
        SELECT id, explanation_markdown
        FROM mastery_concepts
        WHERE explanation_markdown IS NOT NULL
      `,
    )
    .all();
  const update = db.prepare("UPDATE mastery_concepts SET explanation_markdown = ?, updated_at = ? WHERE id = ?");
  const now = Date.now();

  rows.forEach((row) => {
    const cleaned = cleanExplanationMarkdown(row.explanation_markdown);
    if (cleaned !== row.explanation_markdown) {
      update.run(cleaned, now, row.id);
    }
  });
}

function hashContent(content) {
  return crypto.createHash("sha256").update(String(content || "")).digest("hex");
}

function conceptSignature(concepts) {
  return hashContent(
    concepts
      .map((concept) =>
        [
          concept.id,
          concept.name,
          concept.type,
          concept.explanationMarkdown,
          concept.sourceExcerptMarkdown,
        ].join("\u001f"),
      )
      .join("\u001e"),
  );
}

function normalizeDocumentPath(documentPath) {
  const cleanPath = String(documentPath || "").trim().replace(/^\/+/, "").replace(/\\/g, "/");
  if (!cleanPath) return "";
  return cleanPath.toLowerCase().endsWith(".json") ? cleanPath : `${cleanPath}.json`;
}

function normalizeStableKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\u2019']/g, "")
    .replace(/[^a-z0-9/+.#-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function compactMarkdown(markdown, maxLength = 36_000) {
  const normalized = String(markdown || "").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}\n\n[truncated for mastery concept extraction]`;
}

function ensureMasteryStageStates(conceptIds) {
  const ids = [...new Set(conceptIds.map(Number).filter((conceptId) => Number.isInteger(conceptId) && conceptId > 0))];
  if (ids.length === 0) return;

  const insert = getMasteryDatabase().prepare(`
    INSERT OR IGNORE INTO mastery_stage_states(
      concept_id,
      stage,
      score,
      attempt_count,
      lapse_count,
      status,
      updated_at
    )
    VALUES (?, ?, 0, 0, 0, 'active', ?)
  `);
  const now = Date.now();

  ids.forEach((conceptId) => {
    masteryStages.forEach((stage) => insert.run(conceptId, stage, now));
  });
}

function getConceptStageStates(conceptId) {
  const rows = getMasteryDatabase()
    .prepare(
      `
        SELECT *
        FROM mastery_stage_states
        WHERE concept_id = ?
        ORDER BY stage ASC
      `,
    )
    .all(conceptId);
  const rowsByStage = new Map(rows.map((row) => [row.stage, row]));

  return masteryStages.map((stage) => {
    const row = rowsByStage.get(stage);
    return {
      attemptCount: row?.attempt_count ?? 0,
      fsrsDifficulty: row?.fsrs_difficulty ?? null,
      fsrsRetrievability: row?.fsrs_retrievability ?? null,
      fsrsStability: row?.fsrs_stability ?? null,
      lastReviewedAt: row?.last_reviewed_at ?? null,
      lapseCount: row?.lapse_count ?? 0,
      nextDueAt: row?.next_due_at ?? null,
      score: Number(row?.score ?? 0),
      stage,
      status: row?.status ?? "active",
    };
  });
}

function rowToConcept(row) {
  const stageStates = getConceptStageStates(row.id);
  const overallScore = Math.round(
    stageStates.reduce((total, state) => total + state.score, 0) / masteryStages.length,
  );

  return {
    explanationMarkdown: cleanExplanationMarkdown(row.explanation_markdown || ""),
    id: row.id,
    masteryLevel: row.mastery_level,
    masteryRationale: row.mastery_rationale || "",
    name: row.name,
    overallScore,
    sourceExcerptMarkdown: row.source_excerpt_markdown || "",
    stageStates,
    status: row.status,
    type: row.type || "",
    updatedAt: row.updated_at,
  };
}

function rowToMetaphor(row, conceptScenes, currentDocumentHash, currentConceptSignature) {
  if (!row) return null;

  return {
    conceptScenes,
    conceptSignature: row.concept_signature,
    documentHash: row.document_hash,
    generatedAt: row.generated_at,
    id: row.id,
    imageModel: row.image_model || null,
    imagePath: row.image_path || null,
    imagePrompt: row.image_prompt,
    memorySceneMarkdown: row.memory_scene_markdown,
    model: row.model || null,
    stale: Boolean(
      (currentDocumentHash && row.document_hash !== currentDocumentHash) ||
        (currentConceptSignature && row.concept_signature !== currentConceptSignature),
    ),
    title: row.title,
  };
}

function rowToMetaphorConceptScene(row) {
  return {
    conceptId: row.concept_id,
    conceptName: row.concept_name,
    imagePath: row.image_path || null,
    imagePrompt: row.image_prompt,
    roleName: row.role_name,
    sceneMarkdown: row.scene_markdown,
    visceralCueMarkdown: row.visceral_cue_markdown,
  };
}

function rowToRun(row, concepts, currentDocumentHash, metaphor = null) {
  if (!row) {
    return {
      concepts,
      currentDocumentHash,
      documentHash: currentDocumentHash,
      documentPath: "",
      generatedAt: null,
      metaphor,
      model: null,
      stale: false,
    };
  }

  return {
    concepts,
    currentDocumentHash,
    documentHash: row.document_hash,
    documentPath: row.document_path,
    generatedAt: row.generated_at,
    metaphor,
    model: row.model || null,
    stale: Boolean(currentDocumentHash && row.document_hash !== currentDocumentHash),
  };
}

function getLatestRun(documentPath) {
  return (
    getMasteryDatabase()
      .prepare(
        `
          SELECT *
          FROM mastery_generation_runs
          WHERE document_path = ?
          ORDER BY generated_at DESC, id DESC
          LIMIT 1
        `,
      )
      .get(documentPath) ?? null
  );
}

function getActiveConceptRows(documentPath) {
  const rows = getMasteryDatabase()
    .prepare(
      `
        SELECT *
        FROM mastery_concepts
        WHERE document_path = ? AND status = 'active'
        ORDER BY sort_order ASC, id ASC
      `,
    )
    .all(documentPath);
  ensureMasteryStageStates(rows.map((row) => row.id));
  return rows;
}

function getLatestMetaphorRun(documentPath) {
  return (
    getMasteryDatabase()
      .prepare(
        `
          SELECT *
          FROM mastery_metaphor_runs
          WHERE document_path = ?
          ORDER BY generated_at DESC, id DESC
          LIMIT 1
        `,
      )
      .get(documentPath) ?? null
  );
}

function getMetaphorConceptSceneRows(metaphorRunId) {
  return getMasteryDatabase()
    .prepare(
      `
        SELECT *
        FROM mastery_metaphor_concept_scenes
        WHERE metaphor_run_id = ?
        ORDER BY sort_order ASC, id ASC
      `,
    )
    .all(metaphorRunId);
}

function getDocumentMetaphor(documentPath, currentDocumentHash, currentConceptSignature) {
  const latestMetaphorRun = getLatestMetaphorRun(documentPath);
  if (!latestMetaphorRun) return null;

  const conceptScenes = getMetaphorConceptSceneRows(latestMetaphorRun.id).map(rowToMetaphorConceptScene);
  return rowToMetaphor(latestMetaphorRun, conceptScenes, currentDocumentHash, currentConceptSignature);
}

function getDocumentMastery(documentPath, markdown = "", { checkFreshness = true } = {}) {
  const normalizedPath = normalizeDocumentPath(documentPath);
  const currentDocumentHash = checkFreshness ? hashContent(markdown) : "";
  const latestRun = getLatestRun(normalizedPath);
  const concepts = getActiveConceptRows(normalizedPath).map(rowToConcept);
  const currentConceptSignature = conceptSignature(concepts);
  const metaphor = getDocumentMetaphor(normalizedPath, currentDocumentHash, currentConceptSignature);

  return rowToRun(latestRun, concepts, currentDocumentHash, metaphor);
}

function getDocumentMasteryImagePaths(documentPath) {
  const db = getMasteryDatabase();
  const rows = [
    ...db
      .prepare(
        `
          SELECT image_path
          FROM mastery_metaphor_runs
          WHERE document_path = ? AND image_path IS NOT NULL
        `,
      )
      .all(documentPath),
    ...db
      .prepare(
        `
          SELECT scenes.image_path
          FROM mastery_metaphor_concept_scenes scenes
          JOIN mastery_metaphor_runs runs ON runs.id = scenes.metaphor_run_id
          WHERE runs.document_path = ? AND scenes.image_path IS NOT NULL
        `,
      )
      .all(documentPath),
  ];

  return [...new Set(rows.map((row) => String(row.image_path || "").trim()).filter(Boolean))];
}

function deleteDocumentImageAssets(imagePaths) {
  imagePaths.forEach((imagePath) => {
    try {
      fs.unlinkSync(resolveDocumentAssetPath(imagePath));
    } catch {
      // Best effort cleanup; stale asset files should not block clearing mastery state.
    }
  });
}

function clearDocumentMastery({ documentPath, markdown = "" }) {
  const normalizedPath = normalizeDocumentPath(documentPath);
  if (!normalizedPath) {
    throw new Error("Document path is required.");
  }

  const db = getMasteryDatabase();
  const imagePaths = getDocumentMasteryImagePaths(normalizedPath);

  db.exec("BEGIN IMMEDIATE");
  try {
    if (tableExists(db, "mastery_cards")) {
      db.prepare("DELETE FROM mastery_cards WHERE document_path = ?").run(normalizedPath);
    }
    if (tableExists(db, "mastery_weaknesses")) {
      db.prepare("DELETE FROM mastery_weaknesses WHERE document_path = ?").run(normalizedPath);
    }
    db
      .prepare(
        `
          DELETE FROM mastery_metaphor_runs
          WHERE document_path = ?
        `,
      )
      .run(normalizedPath);
    db
      .prepare(
        `
          DELETE FROM mastery_concepts
          WHERE document_path = ?
        `,
      )
      .run(normalizedPath);
    db
      .prepare(
        `
          DELETE FROM mastery_generation_runs
          WHERE document_path = ?
        `,
      )
      .run(normalizedPath);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  deleteDocumentImageAssets(imagePaths);
  return getDocumentMastery(normalizedPath, markdown);
}

function formatExistingConceptsForPrompt(concepts) {
  if (concepts.length === 0) return "No existing mastery concepts.";

  return concepts
    .map((concept) =>
      [
        `ID: ${concept.id}`,
        `Name: ${concept.name}`,
        concept.type ? `Type: ${concept.type}` : "",
        concept.explanationMarkdown ? `Existing explanation: ${String(concept.explanationMarkdown).slice(0, 1200)}` : "",
        concept.sourceExcerptMarkdown ? `Existing source excerpt: ${String(concept.sourceExcerptMarkdown).slice(0, 500)}` : "",
        concept.masteryLevel ? `Current mastery level: ${concept.masteryLevel}` : "",
        concept.masteryRationale ? `Mastery rationale: ${concept.masteryRationale}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n---\n\n");
}

function existingConceptMaps(concepts) {
  const byId = new Map();
  const byStableKey = new Map();

  concepts.forEach((concept) => {
    byId.set(concept.id, concept);
    byStableKey.set(normalizeStableKey(concept.name), concept);
  });

  return { byId, byStableKey };
}

function resolveExistingConcept(concept, maps) {
  const existingById = concept.previousConceptId ? maps.byId.get(concept.previousConceptId) : null;
  if (existingById) return existingById;

  const normalizedName = normalizeStableKey(concept.name);
  const existingByName = maps.byStableKey.get(normalizedName);
  if (existingByName) return existingByName;

  return null;
}

function resolveStableKey(concept, maps) {
  const existingConcept = resolveExistingConcept(concept, maps);
  if (existingConcept) return normalizeStableKey(existingConcept.name);

  const normalizedName = normalizeStableKey(concept.name);
  return normalizedName || `concept_${hashContent(concept.name).slice(0, 12)}`;
}

async function requestMasteryConcepts({ documentPath, existingConcepts, markdown, settings }) {
  const response = await requestStructuredOutput({
    schema: masteryExtractionSchema,
    schemaName: "mastery_concepts",
    modelKey: "graphModel",
    settings,
    temperature: 0.25,
    timeoutMs: 150_000,
    messages: [
      {
        role: "system",
        content: [
          "You create detailed mastery concepts for a note-taking and study app.",
          "Return only valid JSON.",
          "The output is not a knowledge graph and not a summary. It is the learner's replacement study surface for the note.",
          "A learner should be able to understand the important content of the note from these concepts without reopening the note.",
          "Extract the number of concepts that the note naturally needs. Long notes should usually produce more concepts. Do not force a small fixed count, and do not pad with weak concepts.",
          "Each concept must be grounded in the note and include a source excerpt.",
          "Prefer concept names that are complete ideas or claims, not isolated terms.",
          "For each explanationMarkdown, teach the concept with enough detail to stand alone: define the idea, explain how it works, why it matters in this note, and any key conditions, contrast cases, mechanisms, examples, or consequences present in the note.",
          "Do not be lazy. Avoid one-sentence summaries unless the source concept is genuinely trivial.",
          "Use plain language. Avoid slogans, buzzwords, and unexplained terms.",
          "If a technical term is necessary, define it directly in the explanation before relying on it.",
          "explanationMarkdown must explain the concept itself. Do not include review instructions, practice tasks, quizzes, meta commentary, or phrases like 'To review this'.",
          "sourceExcerptMarkdown should contain the most relevant note excerpt for grounding. It is evidence, not the main teaching text.",
          "Keep sourceExcerptMarkdown as ordinary readable Markdown. Never wrap the source excerpt in triple-backtick code fences, even when the excerpt contains code or technical syntax.",
          "If existing concepts are supplied, decide whether each should stay, be updated, be merged into a better concept, or disappear.",
          "When a generated concept continues an existing concept, set previousConceptId to that existing ID.",
          "For new concepts, set masteryLevel to new because there is no practice evidence yet.",
          "For existing concepts, preserve the supplied mastery level unless the concept no longer means the same thing.",
          "Do not generate metaphors, images, flashcards, quizzes, or schedules yet.",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `Document path: ${documentPath}`,
          "",
          "Existing mastery concepts:",
          formatExistingConceptsForPrompt(existingConcepts),
          "",
          "Current note markdown:",
          compactMarkdown(markdown),
        ].join("\n"),
      },
    ],
  });

  const parsed = masteryExtractionSchema.safeParse(response.data);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 8)
      .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Mastery concept extraction did not match the expected schema. ${issues}`);
  }

  return {
    ...parsed.data,
    model: response.model,
  };
}

function formatConceptsForMetaphorPrompt(concepts) {
  return concepts
    .map((concept, index) =>
      [
        `Concept ${index + 1}`,
        `ID: ${concept.id}`,
        `Name: ${concept.name}`,
        concept.type ? `Type: ${concept.type}` : "",
        concept.explanationMarkdown ? `Explanation: ${concept.explanationMarkdown}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n---\n\n");
}

function validateMetaphorConceptCoverage(metaphor, concepts) {
  const expectedIds = new Set(concepts.map((concept) => concept.id));
  const seenIds = new Set();

  metaphor.conceptScenes.forEach((scene) => {
    if (!expectedIds.has(scene.conceptId)) {
      throw new Error(`Metaphor generation returned an unknown concept ID: ${scene.conceptId}.`);
    }
    if (seenIds.has(scene.conceptId)) {
      throw new Error(`Metaphor generation returned concept ID ${scene.conceptId} more than once.`);
    }
    seenIds.add(scene.conceptId);
  });

  const missingIds = [...expectedIds].filter((conceptId) => !seenIds.has(conceptId));
  if (missingIds.length > 0) {
    throw new Error(`Metaphor generation missed concept IDs: ${missingIds.join(", ")}.`);
  }
}

function reportMetaphorProgress(onProgress, progress) {
  if (typeof onProgress !== "function") return;

  onProgress({
    completed: Number.isFinite(progress.completed) ? progress.completed : 0,
    failed: Number.isFinite(progress.failed) ? progress.failed : 0,
    label: String(progress.label || ""),
    phase: progress.phase || "planning",
    total: Number.isFinite(progress.total) ? progress.total : 1,
  });
}

async function requestMasteryMetaphor({ concepts, documentPath, settings, onProgress }) {
  reportMetaphorProgress(onProgress, {
    completed: 0,
    failed: 0,
    label: "Planning shared metaphor",
    phase: "planning",
    total: 1,
  });

  const response = await requestStructuredOutput({
    schema: masteryMetaphorSchema,
    schemaName: "mastery_metaphor",
    modelKey: "graphModel",
    settings,
    temperature: 0.35,
    timeoutMs: 150_000,
    messages: [
      {
        role: "system",
        content: [
          "You create one coherent visual metaphor for study recall.",
          "Return only valid JSON.",
          "The metaphor must be one shared concrete scene, not separate unrelated metaphors.",
          "Every concept must appear as a distinct object, action, place, or force inside the same scene.",
          "Make the scene vivid enough to work as a memory image: exaggerated scale, force, motion, texture, sound, weight, sequence, and clear spatial layout.",
          "Use concrete physical objects and events. Avoid weak generic symbols such as floating icons, glowing networks, puzzle pieces, light bulbs, or vague abstract shapes.",
          "Avoid text labels, diagrams, UI screens, abstract icons, and generic symbolism.",
          "Avoid slogans and buzzwords. Use plain concrete language.",
          "imagePrompt is for the whole scene and must be a direct image-generation prompt, not a summary.",
          "The whole-scene imagePrompt must describe the setting, main objects, dramatic action, composition, material details, lighting, and mood.",
          "Each conceptScenes item must use the supplied conceptId and describe that concept's role in the shared scene.",
          "Each concept imagePrompt must keep the same visual world as the whole-scene prompt, focus on that one concept's role, and still be vivid enough to generate as a standalone image.",
          "Return exactly one conceptScenes item for every supplied concept ID.",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `Document path: ${documentPath}`,
          "",
          "Concepts to place in one metaphor:",
          formatConceptsForMetaphorPrompt(concepts),
        ].join("\n"),
      },
    ],
  });

  const parsed = masteryMetaphorSchema.safeParse(response.data);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 8)
      .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Mastery metaphor generation did not match the expected schema. ${issues}`);
  }

  validateMetaphorConceptCoverage(parsed.data, concepts);

  reportMetaphorProgress(onProgress, {
    completed: 1,
    failed: 0,
    label: "Shared metaphor planned",
    phase: "planning",
    total: 1,
  });

  return {
    ...parsed.data,
    model: response.model,
  };
}

function imageExtension(outputFormat) {
  const cleanFormat = String(outputFormat || "png").replace(/^image\//i, "").toLowerCase();
  if (cleanFormat === "jpeg") return "jpg";
  return ["avif", "gif", "jpg", "png", "svg", "webp"].includes(cleanFormat) ? cleanFormat : "png";
}

function cleanImageNamePart(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "mastery";
}

function vividMetaphorImagePrompt(prompt, scope) {
  const cleanPrompt = String(prompt || "").trim();
  const scopeInstruction =
    scope === "overview"
      ? "Show the whole shared metaphor world with all major objects readable in one coherent scene."
      : "Focus the composition on this concept's object, action, or force while preserving the same shared metaphor world.";

  return [
    cleanPrompt,
    "",
    "Image generation requirements:",
    scopeInstruction,
    "Make it a visceral memory image: exaggerated physical scale, clear motion, visible cause and effect, tactile materials, strong silhouettes, dramatic lighting, and readable foreground/midground/background.",
    "Use concrete objects and events instead of abstract symbolism.",
    "No text, captions, labels, UI, diagrams, charts, icons, logos, or generic stock-illustration style.",
  ].join("\n");
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  let firstError = null;
  const workerCount = Math.max(1, Math.min(limit, items.length));

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length && firstError === null) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        try {
          results[currentIndex] = await mapper(items[currentIndex], currentIndex);
        } catch (error) {
          firstError ??= error;
        }
      }
    }),
  );

  if (firstError) throw firstError;
  return results;
}

async function generateAndSaveMasteryImage({ documentPath, prompt, settings, suffix }) {
  const image = await generateImage({ prompt, settings });
  const extension = imageExtension(image.outputFormat);
  const documentName = cleanImageNamePart(path.basename(documentPath, ".json"));
  const fileName = `mastery-${documentName}-${suffix}-${Date.now()}.${extension}`;
  const imagePath = await saveDocumentImage(fileName, Buffer.from(image.b64Json, "base64"));

  return {
    image,
    imagePath,
  };
}

async function generateMetaphorImages({ concepts, documentPath, metaphor, settings, onProgress }) {
  const imageConcurrency = Number(getAiSettings(settings).imageConcurrency);
  const imageJobs = [
    {
      kind: "overview",
      label: "overview image",
      prompt: vividMetaphorImagePrompt(metaphor.imagePrompt, "overview"),
      suffix: "overview",
    },
    ...metaphor.conceptScenes.map((scene) => {
      const concept = concepts.find((candidate) => candidate.id === scene.conceptId);
      return {
        concept,
        kind: "scene",
        label: concept?.name || `concept ${scene.conceptId}`,
        prompt: vividMetaphorImagePrompt(scene.imagePrompt, "concept"),
        scene,
        suffix: cleanImageNamePart(concept?.name || `concept-${scene.conceptId}`),
      };
    }),
  ];
  const totalImages = imageJobs.length;
  let completedImages = 0;
  let failedImages = 0;

  reportMetaphorProgress(onProgress, {
    completed: 0,
    failed: 0,
    label: `Rendering ${totalImages} metaphor image${totalImages === 1 ? "" : "s"}`,
    phase: "images",
    total: totalImages,
  });

  const imageResults = await mapWithConcurrency(imageJobs, imageConcurrency, async (job, index) => {
    const startedAt = Date.now();
    operationLog("image.generation.started", {
      documentPath,
      index,
      kind: job.kind,
      label: job.label,
      prompt: job.prompt,
    }, { includePrompts: true });

    try {
      const generated = await generateAndSaveMasteryImage({
        documentPath,
        prompt: job.prompt,
        settings,
        suffix: job.suffix,
      });

      completedImages += 1;
      reportMetaphorProgress(onProgress, {
        completed: completedImages,
        failed: failedImages,
        label: `Rendered ${completedImages}/${totalImages}: ${job.label}`,
        phase: "images",
        total: totalImages,
      });
      operationLog("image.generation.completed", {
        documentPath,
        durationMs: Date.now() - startedAt,
        imagePath: generated.imagePath,
        index,
        kind: job.kind,
        label: job.label,
        model: generated.image.model,
      });

      return {
        ...job,
        generated,
      };
    } catch (error) {
      failedImages += 1;
      reportMetaphorProgress(onProgress, {
        completed: completedImages,
        failed: failedImages,
        label: `Failed image: ${job.label}`,
        phase: "images",
        total: totalImages,
      });
      operationLog("image.generation.failed", {
        documentPath,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
        index,
        kind: job.kind,
        label: job.label,
        prompt: job.prompt,
      }, { includePrompts: true });

      return {
        ...job,
        generated: null,
      };
    }
  });

  const overviewImage = imageResults[0].generated;
  const firstGeneratedImage = imageResults.find((imageResult) => imageResult.generated)?.generated ?? null;
  const scenes = metaphor.conceptScenes.map((scene, index) => {
    const imageResult = imageResults[index + 1];
    const concept = concepts.find((candidate) => candidate.id === scene.conceptId);

    return {
      ...scene,
      conceptName: concept?.name || "",
      imagePath: imageResult.generated?.imagePath ?? null,
      imagePrompt: imageResult.prompt,
    };
  });

  operationLog("image.generation.batch_completed", {
    documentPath,
    failed: failedImages,
    succeeded: completedImages,
    total: totalImages,
  });

  return {
    failedImages,
    imageModel: firstGeneratedImage?.image.model ?? null,
    imagePath: overviewImage?.imagePath ?? null,
    imagePrompt: imageResults[0].prompt,
    scenes,
  };
}

function saveMasteryRun({ concepts, documentHash, documentPath, model }) {
  const db = getMasteryDatabase();
  const now = Date.now();
  const initialRevisionDueAt = now + 24 * 60 * 60 * 1000;
  const existingConcepts = getActiveConceptRows(documentPath).map(rowToConcept);
  const maps = existingConceptMaps(existingConcepts);
  const activeStableKeys = new Set();

  db.exec("BEGIN IMMEDIATE");
  try {
    const runResult = db
      .prepare(
        `
          INSERT INTO mastery_generation_runs(
            document_path,
            document_hash,
            model,
            generated_at
          )
          VALUES (?, ?, ?, ?)
        `,
      )
      .run(
        documentPath,
        documentHash,
        model,
        now,
      );
    const runId = runResult.lastInsertRowid;

    const upsertConcept = db.prepare(`
      INSERT INTO mastery_concepts(
        document_path,
        run_id,
        stable_key,
        name,
        type,
        explanation_markdown,
        source_excerpt_markdown,
        mastery_level,
        mastery_rationale,
        status,
        sort_order,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
      ON CONFLICT(document_path, stable_key) DO UPDATE SET
        run_id = excluded.run_id,
        name = excluded.name,
        type = excluded.type,
        explanation_markdown = excluded.explanation_markdown,
        source_excerpt_markdown = excluded.source_excerpt_markdown,
        mastery_level = excluded.mastery_level,
        mastery_rationale = excluded.mastery_rationale,
        status = 'active',
        sort_order = excluded.sort_order,
        updated_at = excluded.updated_at
    `);
    const findConcept = db.prepare(
      "SELECT id FROM mastery_concepts WHERE document_path = ? AND stable_key = ?",
    );
    const enrollConcept = db.prepare(`
      INSERT OR IGNORE INTO mastery_stage_states(
        concept_id, stage, score, attempt_count, last_reviewed_at, next_due_at,
        lapse_count, status, updated_at
      ) VALUES (?, 2, 0, 0, NULL, ?, 0, 'active', ?)
    `);

    concepts.forEach((concept, index) => {
      const stableKey = resolveStableKey(concept, maps);
      const existingConcept = resolveExistingConcept(concept, maps);
      const masteryLevel = existingConcept?.masteryLevel || "new";
      const masteryRationale = existingConcept?.masteryRationale || "Captured from the note; no practice evidence yet.";
      const explanationMarkdown = cleanExplanationMarkdown(concept.explanationMarkdown);
      activeStableKeys.add(stableKey);
      upsertConcept.run(
        documentPath,
        runId,
        stableKey,
        concept.name,
        concept.type,
        explanationMarkdown,
        concept.sourceExcerptMarkdown,
        masteryLevel,
        masteryRationale,
        index,
        now,
        now,
      );
      const savedConcept = findConcept.get(documentPath, stableKey);
      if (savedConcept) enrollConcept.run(savedConcept.id, initialRevisionDueAt, now);
    });

    const archiveConcept = db.prepare(`
      UPDATE mastery_concepts
      SET status = 'archived', updated_at = ?
      WHERE document_path = ? AND status = 'active' AND stable_key = ?
    `);

    existingConcepts.forEach((concept) => {
      const stableKey = normalizeStableKey(concept.name);
      if (!activeStableKeys.has(stableKey)) {
        archiveConcept.run(now, documentPath, stableKey);
      }
    });

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function saveMetaphorRun({
  conceptSignature: savedConceptSignature,
  documentHash,
  documentPath,
  imageModel,
  imagePath,
  metaphor,
  model,
  scenes,
}) {
  const db = getMasteryDatabase();
  const now = Date.now();

  db.exec("BEGIN IMMEDIATE");
  try {
    const runResult = db
      .prepare(
        `
          INSERT INTO mastery_metaphor_runs(
            document_path,
            document_hash,
            concept_signature,
            model,
            image_model,
            title,
            memory_scene_markdown,
            image_prompt,
            image_path,
            generated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        documentPath,
        documentHash,
        savedConceptSignature,
        model,
        imageModel,
        metaphor.title,
        metaphor.memorySceneMarkdown,
        metaphor.imagePrompt,
        imagePath,
        now,
      );
    const metaphorRunId = runResult.lastInsertRowid;

    const insertScene = db.prepare(`
      INSERT INTO mastery_metaphor_concept_scenes(
        metaphor_run_id,
        concept_id,
        concept_name,
        role_name,
        scene_markdown,
        visceral_cue_markdown,
        image_prompt,
        image_path,
        sort_order
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    scenes.forEach((scene, index) => {
      insertScene.run(
        metaphorRunId,
        scene.conceptId,
        scene.conceptName,
        scene.roleName,
        scene.sceneMarkdown,
        scene.visceralCueMarkdown,
        scene.imagePrompt,
        scene.imagePath,
        index,
      );
    });

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

async function generateDocumentMastery({ documentPath, force = false, markdown, settings = {} }) {
  const normalizedPath = normalizeDocumentPath(documentPath);
  const cleanMarkdown = String(markdown || "").trim();
  if (!normalizedPath) {
    throw new Error("Document path is required.");
  }
  if (!cleanMarkdown) {
    throw new Error("This document is empty, so there is nothing to extract yet.");
  }

  const current = getDocumentMastery(normalizedPath, cleanMarkdown);
  const documentHash = hashContent(cleanMarkdown);

  if (!force && current.concepts.length > 0 && !current.stale) {
    return {
      generated: false,
      mastery: current,
    };
  }

  const existingConcepts = current.concepts;
  const generated = await requestMasteryConcepts({
    documentPath: normalizedPath,
    existingConcepts,
    markdown: cleanMarkdown,
    settings,
  });

  saveMasteryRun({
    concepts: generated.concepts,
    documentHash,
    documentPath: normalizedPath,
    model: generated.model,
  });

  return {
    generated: true,
    mastery: getDocumentMastery(normalizedPath, cleanMarkdown),
  };
}

async function generateDocumentMasteryMetaphor({ documentPath, markdown = "", settings = {}, onProgress }) {
  const normalizedPath = normalizeDocumentPath(documentPath);
  if (!normalizedPath) {
    throw new Error("Document path is required.");
  }

  reportMetaphorProgress(onProgress, {
    completed: 0,
    failed: 0,
    label: "Preparing metaphor inputs",
    phase: "planning",
    total: 1,
  });

  const cleanMarkdown = String(markdown || "").trim();
  const documentHash = hashContent(cleanMarkdown);
  const concepts = getActiveConceptRows(normalizedPath).map(rowToConcept);
  if (concepts.length === 0) {
    throw new Error("Extract mastery concepts before generating a metaphor.");
  }

  const currentConceptSignature = conceptSignature(concepts);
  const metaphor = await requestMasteryMetaphor({
    concepts,
    documentPath: normalizedPath,
    onProgress,
    settings,
  });
  const images = await generateMetaphorImages({
    concepts,
    documentPath: normalizedPath,
    metaphor,
    onProgress,
    settings,
  });

  reportMetaphorProgress(onProgress, {
    completed: 0,
    failed: images.failedImages,
    label: "Saving metaphor",
    phase: "saving",
    total: 1,
  });

  saveMetaphorRun({
    conceptSignature: currentConceptSignature,
    documentHash,
    documentPath: normalizedPath,
    imageModel: images.imageModel,
    imagePath: images.imagePath,
    metaphor: {
      ...metaphor,
      imagePrompt: images.imagePrompt,
    },
    model: metaphor.model,
    scenes: images.scenes,
  });

  reportMetaphorProgress(onProgress, {
    completed: 1,
    failed: images.failedImages,
    label: images.failedImages > 0
      ? `Metaphor ready with ${images.failedImages} omitted image${images.failedImages === 1 ? "" : "s"}`
      : "Metaphor ready",
    phase: "done",
    total: 1,
  });

  return getDocumentMastery(normalizedPath, cleanMarkdown);
}

function updateMasteryConceptLevel({ conceptId, documentPath, markdown = "", masteryLevel, masterySettings = {} }) {
  if (!masteryLevels.includes(masteryLevel)) {
    throw new Error("Invalid mastery level.");
  }

  const thresholds = normalizeMasteryScoringSettings(masterySettings).thresholds;
  const scoresByLevel = { new: 0, ...thresholds };

  return updateMasteryConceptScore({
    conceptId,
    documentPath,
    markdown,
    masterySettings,
    score: scoresByLevel[masteryLevel],
  });
}

function masteryLevelForStageStates(stageStates, masterySettings = {}) {
  const thresholds = normalizeMasteryScoringSettings(masterySettings).thresholds;
  const scores = stageStates.map((state) => Number(state.score || 0));
  const attemptCount = stageStates.reduce((total, state) => total + Number(state.attemptCount ?? state.attempt_count ?? 0), 0);
  const overall = scores.reduce((total, score) => total + score, 0) / Math.max(1, scores.length);

  if (attemptCount === 0 && overall === 0) return "new";
  if (overall >= thresholds.mastered) return "mastered";
  if (overall >= thresholds.advanced) return "advanced";
  if (overall >= thresholds.proficient) return "proficient";
  if (overall >= thresholds.developing) return "developing";
  if (overall >= thresholds.familiar) return "familiar";
  return "new";
}

function updateMasteryConceptScore({ conceptId, documentPath, markdown = "", masterySettings = {}, score }) {
  const normalizedPath = normalizeDocumentPath(documentPath);
  const numericConceptId = Number(conceptId);
  const numericScore = Math.max(0, Math.min(100, Number(score)));
  if (!normalizedPath) {
    throw new Error("Document path is required.");
  }
  if (!Number.isInteger(numericConceptId) || numericConceptId <= 0) {
    throw new Error("Concept ID is required.");
  }
  if (!Number.isFinite(numericScore)) {
    throw new Error("Mastery score must be a number between 0 and 100.");
  }

  const db = getMasteryDatabase();
  const concept = db
    .prepare("SELECT id FROM mastery_concepts WHERE id = ? AND document_path = ? AND status = 'active'")
    .get(numericConceptId, normalizedPath);
  if (!concept) {
    throw new Error("Mastery concept was not found.");
  }

  ensureMasteryStageStates([numericConceptId]);
  const now = Date.now();
  const stageStates = masteryStages.map((stage) => ({ attemptCount: 0, score: numericScore, stage }));
  const masteryLevel = numericScore === 0 ? "new" : masteryLevelForStageStates(stageStates, masterySettings);

  db.exec("BEGIN IMMEDIATE");
  try {
    db
      .prepare(
        `
          UPDATE mastery_stage_states
          SET score = ?, updated_at = ?
          WHERE concept_id = ?
        `,
      )
      .run(numericScore, now, numericConceptId);
    db
      .prepare(
        `
          UPDATE mastery_concepts
          SET mastery_level = ?,
              mastery_rationale = ?,
              updated_at = ?
          WHERE id = ? AND document_path = ? AND status = 'active'
        `,
      )
      .run(masteryLevel, "Set manually by you.", now, numericConceptId, normalizedPath);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return getDocumentMastery(normalizedPath, markdown);
}

module.exports = {
  clearDocumentMastery,
  closeMasteryDatabase,
  ensureMasteryStageStates,
  generateDocumentMastery,
  generateDocumentMasteryMetaphor,
  getMasteryDatabase,
  getMasteryDatabasePath,
  getDocumentMastery,
  masteryLevelForStageStates,
  masteryLevels,
  masteryStages,
  normalizeDocumentPath,
  tableExists,
  updateMasteryConceptLevel,
  updateMasteryConceptScore,
};
