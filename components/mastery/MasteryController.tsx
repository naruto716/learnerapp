"use client";

import { SparkleIcon } from "@phosphor-icons/react";
import FloatingIconButton from "@/components/FloatingIconButton";
import type { CurrentDocumentAgentTools } from "@/components/editor/TiptapEditor";
import MasteryPanel from "./MasteryPanel";
import { useDocumentMastery } from "./useDocumentMastery";

type MasteryControllerProps = {
  activeDocumentPath: string | null;
  getCurrentDocumentTools: () => CurrentDocumentAgentTools | null;
  hidden?: boolean;
  isSidebarOpen: boolean;
  onOpenChange?: (open: boolean) => void;
};

export default function MasteryController({
  activeDocumentPath,
  getCurrentDocumentTools,
  hidden = false,
  isSidebarOpen,
  onOpenChange,
}: MasteryControllerProps) {
  const {
    clearMastery,
    closeMastery,
    error,
    generateMastery,
    generateMetaphor,
    isLoading,
    isMetaphorLoading,
    isOpen,
    mastery,
    metaphorProgress,
    openMastery,
    updateConceptMasteryLevel,
  } = useDocumentMastery({
    activeDocumentPath,
    getCurrentDocumentTools,
    onOpenChange,
  });

  return (
    <>
      {activeDocumentPath && !hidden && !isOpen && (
        <FloatingIconButton
          ariaLabel="Open mastery"
          className="right-16 top-15"
          disabled={isLoading}
          icon={<SparkleIcon size={16} className={isLoading ? "animate-pulse" : ""} />}
          onClick={() => {
            void openMastery();
          }}
          size={8}
          tooltip={isLoading ? "Building mastery" : "Mastery"}
        />
      )}
      <MasteryPanel
        error={error}
        isMetaphorLoading={isMetaphorLoading}
        isLoading={isLoading}
        isSidebarOpen={isSidebarOpen}
        mastery={mastery}
        metaphorProgress={metaphorProgress}
        onClear={clearMastery}
        onClose={closeMastery}
        onGenerateMetaphor={generateMetaphor}
        onMasteryLevelChange={updateConceptMasteryLevel}
        onGenerate={generateMastery}
        open={isOpen}
      />
    </>
  );
}
