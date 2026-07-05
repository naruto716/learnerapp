// learnerapp/global.d.ts
export {};

declare global {
  interface Window {
    learner?: {
      platform: NodeJS.Platform;
    };
  }
}