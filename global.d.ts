// learnerapp/global.d.ts
export {};

declare global {
  type MarkdownNode = {
    name: string;
    path: string;
    type: "file" | "folder";
    children?: MarkdownNode[];
  };

  interface Window {
    learner?: {
      platform: NodeJS.Platform;
      listMarkdownFiles: () => Promise<{
        directory: string;
        tree: MarkdownNode[];
      }>;
      readMarkdownFile: (filePath: string) => Promise<string>;
      createMarkdownFolder: (folderPath: string) => Promise<{
        directory: string;
        tree: MarkdownNode[];
      }>;
      createMarkdownFile: (filePath: string) => Promise<{
        directory: string;
        tree: MarkdownNode[];
      }>;
    };
  }
}
