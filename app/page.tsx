"use client";

import { useDocumentSelection } from "@/components/DocumentContext";
import TiptapEditor from "@/components/editor/TiptapEditor";

export default function Home() {
  const { selectedDocumentPath } = useDocumentSelection();

  return <TiptapEditor documentPath={selectedDocumentPath} />;
}
