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
    };
  }
}
