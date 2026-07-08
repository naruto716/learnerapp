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

  type DocumentSemanticSearchResult = {
    chunkIndex: number;
    path: string;
    score: number;
    text: string;
    title: string;
  };

  type KnowledgeConceptMention = {
    confidence: number;
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
    summary: string | null;
    type: string | null;
  };

  type KnowledgeGraphEdge = {
    confidence: number;
    evidence: KnowledgeRelationEvidence[];
    explanation: string | null;
    id: number;
    relation: string;
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
      getDocumentEmbeddingStatus: () => Promise<DocumentEmbeddingStatus>;
      rebuildDocumentEmbeddings: () => Promise<DocumentEmbeddingStatus>;
      semanticSearchDocuments: (query: string, limit?: number) => Promise<DocumentSemanticSearchResult[]>;
      extractDocumentGraph: (filePath: string, markdown: string) => Promise<KnowledgeGraphExtractionResult>;
      getDocumentGraph: (filePath: string) => Promise<KnowledgeDocumentGraph>;
      deleteDocumentGraph: (filePath: string) => Promise<KnowledgeDocumentGraph>;
      isFullScreen: () => Promise<boolean>;
      onFullScreenChange: (callback: (isFullScreen: boolean) => void) => () => void;
    };
  }
}
