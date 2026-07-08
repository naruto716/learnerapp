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
      isFullScreen: () => Promise<boolean>;
      onFullScreenChange: (callback: (isFullScreen: boolean) => void) => () => void;
    };
  }
}
