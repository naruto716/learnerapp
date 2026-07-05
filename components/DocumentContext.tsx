"use client";

import { createContext, useContext } from "react";

type DocumentContextValue = {
  selectedDocumentPath: string | null;
  setSelectedDocumentPath: (path: string) => void;
};

const DocumentContext = createContext<DocumentContextValue | null>(null);

export function DocumentProvider({
  children,
  value,
}: {
  children: React.ReactNode;
  value: DocumentContextValue;
}) {
  return <DocumentContext.Provider value={value}>{children}</DocumentContext.Provider>;
}

export function useDocumentSelection() {
  const context = useContext(DocumentContext);

  if (!context) {
    throw new Error("useDocumentSelection must be used inside DocumentProvider.");
  }

  return context;
}
