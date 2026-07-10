// learnerapp/global.d.ts
export {};

declare global {
  type TiptapDocument = {
    type: string;
    content?: unknown[];
    [key: string]: unknown;
  };

  type DocumentNode = {
    name: string;
    path: string;
    type: "file" | "folder";
    children?: DocumentNode[];
  };

  type DocumentReorderRequest = {
    sourcePath: string;
    targetPath: string;
    position: "before" | "after";
  };

  type DocumentSearchResult = {
    path: string;
    rank: number;
    snippet: string;
    title: string;
  };

  type DocumentEmbeddingStatus = {
    chunks: number;
    configured: boolean;
    embeddedChunks: number;
    lastError: string | null;
    model: string;
    queuedDocuments: number;
    running: boolean;
  };

  type LearnerAiSettings = {
    apiKey?: string;
    baseUrl?: string;
    chatModel?: string;
    graphModel?: string;
    embeddingModel?: string;
    imageModel?: string;
    imageSize?: string;
    imageQuality?: string;
    imageBackground?: string;
    imageOutputFormat?: string;
    userProfile?: string;
  };

  type LearnerAiModel = {
    created?: number;
    id: string;
    object?: string;
    owned_by?: string;
  };

  type LearnerImageGenerationRequest = {
    prompt: string;
    settings?: LearnerAiSettings;
  };

  type LearnerImageGenerationResult = {
    background: string;
    b64Json: string;
    dataUrl: string;
    durationMs: number;
    model: string;
    outputFormat: string;
    prompt: string;
    quality: string;
    size: string;
    usage: unknown;
  };

  type DocumentSemanticSearchResult = {
    chunkIndex: number;
    path: string;
    score: number;
    text: string;
    title: string;
  };

  type KnowledgeConceptMention = {
    confidence: number;
    contribution: string | null;
    documentPath: string;
    excerptMarkdown: string;
    mentionType: string | null;
    sectionTitle: string | null;
    updatedAt: number;
  };

  type KnowledgeRelationEvidence = {
    confidence: number;
    documentPath: string;
    excerptMarkdown: string;
    updatedAt: number;
  };

  type KnowledgeGraphNode = {
    id: number;
    inCurrentDocument: boolean;
    mentions: KnowledgeConceptMention[];
    name: string;
    explanation: string | null;
    summary: string | null;
    type: string | null;
  };

  type KnowledgeConceptSearchResult = {
    id: number;
    aliases?: string[];
    matchReason?: string;
    name: string;
    explanation: string | null;
    mentions?: KnowledgeConceptMention[];
    score?: number;
    summary: string | null;
    type: string | null;
  };

  type KnowledgeConceptSearchQuery = {
    aliases?: string[];
    name: string;
    summary?: string;
    type?: string;
  };

  type KnowledgeConceptUpdate = {
    conceptId: number;
    name: string;
    explanation?: string;
    summary?: string;
    type?: string;
  };

  type KnowledgeConceptMentionRequest = {
    conceptId?: number | null;
    concept?: {
      name: string;
      explanation?: string;
      summary?: string;
      type?: string;
    };
    contribution?: string;
    documentHash?: string | null;
    excerptMarkdown: string;
    mentionType?: string;
    sectionTitle?: string;
  };

  type KnowledgeRelationUpdate = {
    explanation?: string;
    relation: string;
    relationId: number;
  };

  type KnowledgeRelationCreateRequest = {
    documentHash?: string | null;
    evidenceMarkdown?: string;
    explanation?: string;
    fromConceptId: number;
    relation: string;
    targetConcept?: {
      explanation?: string;
      name: string;
      summary?: string;
      type?: string;
    };
    toConceptId?: number | null;
  };

  type KnowledgeGraphEdge = {
    confidence: number;
    evidence: KnowledgeRelationEvidence[];
    explanation: string | null;
    id: number;
    relation: string;
    sourceType: string | null;
    source: number;
    target: number;
  };

  type KnowledgeDocumentGraph = {
    documentHash: string | null;
    documentPath: string;
    edges: KnowledgeGraphEdge[];
    extractedAt: number | null;
    model: string | null;
    nodes: KnowledgeGraphNode[];
  };

  type KnowledgeGraphExtractionResult = {
    extracted: boolean;
    graph: KnowledgeDocumentGraph;
  };

  type KnowledgeGraphProgress = {
    completed: number;
    failed: number;
    label: string;
    total: number;
  };

  type MasteryLevel = "new" | "familiar" | "developing" | "proficient" | "advanced" | "mastered";

  type MasteryConcept = {
    explanationMarkdown: string;
    id: number;
    masteryLevel: MasteryLevel;
    masteryRationale: string;
    name: string;
    overallScore: number;
    sourceExcerptMarkdown: string;
    stageStates: MasteryStageState[];
    status: string;
    type: string;
    updatedAt: number;
  };

  type MasteryStage = 2 | 3 | 4 | 5 | 6;

  type MasteryStageState = {
    attemptCount: number;
    conceptId?: number;
    fsrsDifficulty?: number | null;
    fsrsRetrievability?: number | null;
    fsrsStability?: number | null;
    lastReviewedAt: number | null;
    lapseCount: number;
    nextDueAt: number | null;
    score: number;
    stage: MasteryStage;
    status: string;
  };

  type MasteryMetaphorConceptScene = {
    conceptId: number;
    conceptName: string;
    imagePath: string | null;
    imagePrompt: string;
    roleName: string;
    sceneMarkdown: string;
    visceralCueMarkdown: string;
  };

  type MasteryMetaphor = {
    conceptScenes: MasteryMetaphorConceptScene[];
    conceptSignature: string;
    documentHash: string;
    generatedAt: number;
    id: number;
    imageModel: string | null;
    imagePath: string | null;
    imagePrompt: string;
    memorySceneMarkdown: string;
    model: string | null;
    stale: boolean;
    title: string;
  };

  type MasteryMetaphorProgressPhase = "planning" | "images" | "saving" | "done" | "error";

  type MasteryMetaphorProgress = {
    completed: number;
    documentPath?: string;
    failed: number;
    label: string;
    phase: MasteryMetaphorProgressPhase;
    total: number;
  };

  type DocumentMastery = {
    concepts: MasteryConcept[];
    currentDocumentHash: string;
    documentHash: string;
    documentPath: string;
    generatedAt: number | null;
    metaphor: MasteryMetaphor | null;
    model: string | null;
    stale: boolean;
  };

  type DocumentMasteryGenerationRequest = {
    documentPath: string;
    force?: boolean;
    markdown: string;
    settings?: LearnerAiSettings;
  };

  type DocumentMasteryGenerationResult = {
    generated: boolean;
    mastery: DocumentMastery;
  };

  type DocumentMasteryLevelUpdateRequest = {
    conceptId: number;
    documentPath: string;
    markdown?: string;
    masterySettings?: MasteryScoringSettings;
    masteryLevel: MasteryLevel;
  };

  type DocumentMasteryMetaphorGenerationRequest = {
    documentPath: string;
    markdown: string;
    settings?: LearnerAiSettings;
  };

  type DocumentMasteryClearRequest = {
    documentPath: string;
    markdown?: string;
  };

  type MasteryCardKind =
    | "feynman"
    | "relationship"
    | "contrast"
    | "debugging"
    | "diagnostic"
    | "drill"
    | "quiz"
    | "scenario";
  type MasteryCardDifficulty = "introductory" | "standard" | "advanced" | "expert";
  type MasteryCardAnswerMode = "single_turn" | "multi_turn";
  type MasteryCardStatus = "active" | "delayed" | "done";
  type MasteryTargetProficiency = Exclude<MasteryLevel, "new">;

  type MasteryScoringSettings = {
    passingScore: number;
    points: Record<MasteryCardKind, Record<MasteryCardDifficulty, number>>;
    thresholds: Record<MasteryTargetProficiency, number>;
  };

  type MasteryCardPreferences = {
    generationPrompt: string;
    targetProficiency: MasteryTargetProficiency;
  };

  type MasteryCardTarget = {
    conceptId: number;
    conceptName: string;
    stage: MasteryStage;
  };

  type MasteryCardWeaknessLink = {
    relationship: "target" | "exposed";
    weaknessId: number;
  };

  type MasteryCardMessage = {
    contentMarkdown: string;
    id: number;
    role: "assistant" | "user";
  };

  type MasteryCardAttempt = {
    answerMarkdown: string;
    createdAt: number;
    feedbackMarkdown: string;
    id: number;
    score: number;
  };

  type MasteryCard = {
    answerMode: MasteryCardAnswerMode;
    conceptContextVisible: boolean;
    contextMarkdown: string;
    createdAt: number;
    difficulty: MasteryCardDifficulty;
    expectedAnswerMarkdown: string;
    id: number;
    graphEdgeIds: number[];
    kind: MasteryCardKind;
    latestAttempt: MasteryCardAttempt | null;
    messages: MasteryCardMessage[];
    metaphorContextVisible: boolean;
    promptMarkdown: string;
    retryAt: number | null;
    rubricMarkdown: string;
    status: MasteryCardStatus;
    targets: MasteryCardTarget[];
    title: string;
    updatedAt: number;
    weaknessLinks: MasteryCardWeaknessLink[];
  };

  type MasteryWeakness = {
    description: string;
    exposedAt: number;
    id: number;
    reopenedCount: number;
    resolvedAt: number | null;
    status: "active" | "resolved";
    targets: MasteryCardTarget[];
    title: string;
    updatedAt: number;
  };

  type DocumentMasteryCards = {
    cards: MasteryCard[];
    documentPath: string;
    preferences: MasteryCardPreferences;
    stageStates: MasteryStageState[];
    weaknesses: MasteryWeakness[];
  };

  type MasteryCardProgressPhase = "graph" | "planning" | "saving" | "done" | "error";

  type MasteryCardProgress = {
    completed: number;
    documentPath?: string;
    label: string;
    phase: MasteryCardProgressPhase;
    total: number;
  };

  type DocumentMasteryCardGenerationRequest = {
    documentPath: string;
    generationPrompt: string;
    markdown: string;
    masterySettings?: MasteryScoringSettings;
    settings?: LearnerAiSettings;
    targetProficiency: MasteryTargetProficiency;
  };

  type MasteryCardDiscussionRequest = {
    cardId: number;
    documentPath: string;
    markdown?: string;
    message: string;
    settings?: LearnerAiSettings;
  };

  type MasteryCardDiscussionResult = {
    replyMarkdown: string;
    shouldEnd: boolean;
    state: DocumentMasteryCards;
  };

  type MasteryCardEvaluationRequest = {
    answerMarkdown?: string;
    cardId: number;
    documentPath: string;
    markdown?: string;
    masterySettings?: MasteryScoringSettings;
    settings?: LearnerAiSettings;
  };

  type DocumentMasteryScoreUpdateRequest = {
    conceptId: number;
    documentPath: string;
    markdown?: string;
    masterySettings?: MasteryScoringSettings;
    score: number;
  };

  interface Window {
    learner?: {
      platform: NodeJS.Platform;
      listDocuments: () => Promise<{
        directory: string;
        tree: DocumentNode[];
      }>;
      readDocument: (filePath: string) => Promise<TiptapDocument>;
      saveDocument: (filePath: string, document: TiptapDocument) => Promise<void>;
      createDocumentFolder: (folderPath: string) => Promise<{
        directory: string;
        tree: DocumentNode[];
      }>;
      createDocumentFile: (filePath: string) => Promise<{
        directory: string;
        tree: DocumentNode[];
      }>;
      moveDocumentEntry: (sourcePath: string, targetFolderPath: string) => Promise<{
        directory: string;
        tree: DocumentNode[];
      }>;
      deleteDocumentEntry: (entryPath: string) => Promise<{
        directory: string;
        tree: DocumentNode[];
      }>;
      renameDocumentFile: (filePath: string, newTitle: string) => Promise<{
        directory: string;
        newPath: string;
        tree: DocumentNode[];
      }>;
      reorderDocumentEntry: (reorderRequest: DocumentReorderRequest) => Promise<{
        directory: string;
        tree: DocumentNode[];
      }>;
      saveDocumentImage: (fileName: string, data: Uint8Array) => Promise<string>;
      searchDocuments: (query: string, limit?: number) => Promise<DocumentSearchResult[]>;
      rebuildDocumentSearchIndex: () => Promise<void>;
      configureAi: (settings?: LearnerAiSettings) => Promise<LearnerAiSettings>;
      listAiModels: (settings?: LearnerAiSettings) => Promise<LearnerAiModel[]>;
      generateImage: (request: LearnerImageGenerationRequest) => Promise<LearnerImageGenerationResult>;
      getDocumentMastery: (filePath: string, markdown: string) => Promise<DocumentMastery>;
      generateDocumentMastery: (
        request: DocumentMasteryGenerationRequest,
      ) => Promise<DocumentMasteryGenerationResult>;
      updateDocumentMasteryConceptLevel: (
        request: DocumentMasteryLevelUpdateRequest,
      ) => Promise<DocumentMastery>;
      updateDocumentMasteryConceptScore: (
        request: DocumentMasteryScoreUpdateRequest,
      ) => Promise<DocumentMastery>;
      generateDocumentMasteryMetaphor: (
        request: DocumentMasteryMetaphorGenerationRequest,
      ) => Promise<DocumentMastery>;
      onMasteryMetaphorProgress: (callback: (progress: MasteryMetaphorProgress) => void) => () => void;
      clearDocumentMastery: (request: DocumentMasteryClearRequest) => Promise<DocumentMastery>;
      getDocumentMasteryCards: (documentPath: string) => Promise<DocumentMasteryCards>;
      generateDocumentMasteryCards: (
        request: DocumentMasteryCardGenerationRequest,
      ) => Promise<DocumentMasteryCards>;
      onMasteryCardProgress: (callback: (progress: MasteryCardProgress) => void) => () => void;
      continueMasteryCardDiscussion: (
        request: MasteryCardDiscussionRequest,
      ) => Promise<MasteryCardDiscussionResult>;
      evaluateMasteryCard: (request: MasteryCardEvaluationRequest) => Promise<DocumentMasteryCards>;
      clearDocumentMasteryCards: (
        request: { documentPath: string; resetProgress?: boolean },
      ) => Promise<DocumentMasteryCards>;
      getDocumentEmbeddingStatus: (settings?: LearnerAiSettings) => Promise<DocumentEmbeddingStatus>;
      rebuildDocumentEmbeddings: (settings?: LearnerAiSettings) => Promise<DocumentEmbeddingStatus>;
      semanticSearchDocuments: (
        query: string,
        limit?: number,
        settings?: LearnerAiSettings,
      ) => Promise<DocumentSemanticSearchResult[]>;
      extractDocumentGraph: (
        filePath: string,
        markdown: string,
        settings?: LearnerAiSettings,
      ) => Promise<KnowledgeGraphExtractionResult>;
      getDocumentGraph: (filePath: string) => Promise<KnowledgeDocumentGraph>;
      deleteDocumentGraph: (filePath: string) => Promise<KnowledgeDocumentGraph>;
      searchGraphConcepts: (query: string, limit?: number) => Promise<KnowledgeConceptSearchResult[]>;
      searchRelatedGraphConcepts: (
        concept: KnowledgeConceptSearchQuery,
        limit?: number,
        settings?: LearnerAiSettings,
      ) => Promise<KnowledgeConceptSearchResult[]>;
      updateGraphConcept: (filePath: string, conceptUpdate: KnowledgeConceptUpdate) => Promise<KnowledgeDocumentGraph>;
      addGraphConceptMention: (
        filePath: string,
        mentionRequest: KnowledgeConceptMentionRequest,
      ) => Promise<KnowledgeDocumentGraph>;
      deleteGraphConceptFromDocument: (filePath: string, conceptId: number) => Promise<KnowledgeDocumentGraph>;
      updateGraphRelation: (filePath: string, relationUpdate: KnowledgeRelationUpdate) => Promise<KnowledgeDocumentGraph>;
      addGraphRelation: (filePath: string, relationRequest: KnowledgeRelationCreateRequest) => Promise<KnowledgeDocumentGraph>;
      isFullScreen: () => Promise<boolean>;
      onFullScreenChange: (callback: (isFullScreen: boolean) => void) => () => void;
    };
  }
}
