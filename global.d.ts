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
